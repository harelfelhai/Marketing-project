"""
app/api/v1/endpoints/actions.py — Domain B: Action Dispatch & Audit Log.

Endpoints:
    POST /api/v1/actions/trigger           — Manual operator action dispatch.
    POST /api/v1/actions/retry-now/{log_id} — Force-retry a specific action log row.
    GET  /api/v1/actions/logs              — Paginated audit log with status filter.

FILTER-AS-VIEW PATTERN (ActionLog)
------------------------------------
`GET /api/v1/actions/logs` is the single unified audit log. Sub-views that
operators need (failures, retry queue, delivered) are reached by passing the
appropriate `?status=` value — no dedicated endpoints for each status. This
matches the same filter-as-view design used for `/phones`.

This means the frontend can bookmark `?status=failed&min_retry_count=3` to get
a "choked actions" view with no new API surface required.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select as sa_select
from sqlmodel import Session, select

from app.api.deps import (
    get_action_dispatcher,
    get_retry_engine,
    get_user_action_service,
    require_authenticated_user,
)
from app.schemas.api_contracts import ActionLogListResponse, ActionLogResponse, RetryNowRequest
from app.schemas.api_contracts import ManualActionTriggerRequest
from database import get_session
from exceptions import PhoneNumberNotFoundError
from models.action_log import ActionLog
from models.user import User
from services.dispatcher import ActionDispatcher, RetryEngine, UserActionService

router = APIRouter()

# Terminal statuses that can never be meaningfully retried.
_NON_RETRYABLE_TERMINAL_STATUSES = {"sent", "delivered"}


@router.post(
    "/trigger",
    response_model=ActionLogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger a manual operator action",
    description=(
        "Dispatches a named action against a specific phone number on behalf of "
        "a human operator. The `operator_id` is stamped into `ActionLog.extra_data` "
        "atomically alongside the dispatch result — it can never be separated from "
        "its audit row. "
        "\n\n"
        "Returns 404 if the phone_id does not exist. "
        "Returns 422 if the action_type has no registered handler and no default "
        "handler is configured."
    ),
)
def trigger_manual_action(
    body: ManualActionTriggerRequest,
    current_user: User = Depends(require_authenticated_user),
    service: UserActionService = Depends(get_user_action_service),
) -> ActionLogResponse:
    """
    Phase AUTH-B: operator_id removed from the body — the
    operator's username comes from the session
    (`Depends(require_authenticated_user)`).
    """
    try:
        log = service.trigger_manual_action(
            phone_id=body.phone_id,
            action_type=body.action_type,
            operator_id=current_user.username,
        )
    except PhoneNumberNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return ActionLogResponse.model_validate(log)


@router.post(
    "/retry-now/{log_id}",
    response_model=ActionLogResponse,
    summary="Force-retry a specific action log row immediately",
    description=(
        "Bypasses the `retry_after` backoff window and immediately re-executes "
        "the handler for the specified ActionLog row. Intended for maintenance "
        "operations — e.g. flushing isolated stuck rows after an external vendor "
        "outage is resolved. For bulk queue flushing, use `POST /system/workers/run?worker_name=retry`. "
        "\n\n"
        "Returns 404 if `log_id` does not exist. "
        "Returns 422 if the row is in a terminal non-retryable state ('sent' or 'delivered')."
    ),
)
def retry_now(
    log_id: str,
    body: RetryNowRequest = RetryNowRequest(),
    current_user: User = Depends(require_authenticated_user),
    dispatcher: ActionDispatcher = Depends(get_action_dispatcher),
    session: Session = Depends(get_session),
) -> ActionLogResponse:
    """
    Force-retry a specific ActionLog row, bypassing its retry_after window.

    Validation:
        - Row must exist (404 otherwise).
        - Row must NOT be in a successfully-terminal state ('sent', 'delivered').
          These rows represent completed actions and must not be re-executed.

    Execution:
        The dispatcher's `execute_pending()` is called directly. It runs the
        registered handler and commits the final state (which may be 'sent',
        'failed', or 'scheduled_retry' depending on the handler outcome).

    Attribution:
        If `body.operator_id` is provided, it is merged into `extra_data` after
        the dispatch so the manual override is recorded in the audit trail.

    Args:
        log_id     (int):             PK of the ActionLog row to retry.
        body       (RetryNowRequest): Optional operator attribution body.
        dispatcher (ActionDispatcher): Injected via FastAPI Depends.
        session    (Session):         Injected DB session.

    Returns:
        ActionLogResponse: The ActionLog row after the retry attempt completes.

    Raises:
        HTTPException 404: log_id not found.
        HTTPException 422: Row is in a non-retryable terminal state.
    """
    log = session.get(ActionLog, log_id)
    if log is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ActionLog with id={log_id} not found.",
        )

    if log.status in _NON_RETRYABLE_TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"ActionLog {log_id} is in terminal status '{log.status}' and cannot be retried. "
                "Only rows in 'failed' or 'scheduled_retry' status are eligible."
            ),
        )

    try:
        completed = dispatcher.execute_pending(log)
    except PhoneNumberNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # Phase AUTH-B — attribute the manual retry from the session.
    merged = dict(completed.extra_data or {})
    merged["force_retried_by_operator"] = current_user.username
    completed.extra_data = merged
    session.add(completed)
    session.commit()
    session.refresh(completed)

    return ActionLogResponse.model_validate(completed)


@router.get(
    "/logs",
    response_model=ActionLogListResponse,
    summary="List action log rows with filters",
    description=(
        "Returns a paginated, filterable view of the ActionLog table. "
        "This is the single unified audit log — sub-views are reached via query params:"
        "\n\n"
        "- `?status=failed` — all terminal failures.\n"
        "- `?status=scheduled_retry` — the full retry queue.\n"
        "- `?status=scheduled_retry&min_retry_count=3` — deeply choked actions.\n"
        "- `?phone_id=42` — the dispatch history for one number.\n"
        "\n"
        "All filters are additive (AND). Omit a filter to include all values."
    ),
)
def list_action_logs(
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        description=(
            "Filter by execution state. "
            "Values: 'pending', 'sent', 'failed', 'delivered', 'scheduled_retry', 'retrying'. "
            "Omit to return logs across all statuses."
        ),
    ),
    action_type: Optional[str] = Query(
        default=None,
        description="Filter by the action type token (e.g. 'advertisement_type_a').",
    ),
    phone_id: Optional[str] = Query(
        default=None,
        description="Filter to the dispatch history of a single phone number.",
    ),
    min_retry_count: Optional[int] = Query(
        default=None,
        ge=0,
        description=(
            "Include only rows where retry_count >= this value. "
            "Use to find choked actions (e.g. ?min_retry_count=3)."
        ),
    ),
    page: int = Query(default=1, ge=1, description="1-based page index."),
    page_size: int = Query(default=20, ge=1, le=500, description="Records per page (max 500)."),
    session: Session = Depends(get_session),
) -> ActionLogListResponse:
    """
    Paginated ActionLog listing with composable status-based filtering.

    Because status is a query parameter rather than a path segment, a single
    implementation serves every operational sub-view (failures, retry queue,
    delivery confirmations). The filter is applied in SQL — no in-process
    filtering or post-fetch slicing.

    Args:
        status_filter   (Optional[str]): Filter on ActionLog.status.
        action_type     (Optional[str]): Filter on ActionLog.action_type.
        phone_id        (Optional[int]): Filter on ActionLog.phone_id.
        min_retry_count (Optional[int]): Lower bound on ActionLog.retry_count.
        page            (int):           1-based page number.
        page_size       (int):           Records per page.
        session         (Session):       Injected DB session.

    Returns:
        ActionLogListResponse: Paginated rows with total count.
    """
    base = sa_select(ActionLog)
    count_base = sa_select(func.count(ActionLog.id))

    filters = []
    if status_filter is not None:
        filters.append(ActionLog.status == status_filter)
    if action_type is not None:
        filters.append(ActionLog.action_type == action_type)
    if phone_id is not None:
        filters.append(ActionLog.phone_id == phone_id)
    if min_retry_count is not None:
        filters.append(ActionLog.retry_count >= min_retry_count)

    for f in filters:
        base = base.where(f)
        count_base = count_base.where(f)

    total: int = session.execute(count_base).scalar_one()

    offset = (page - 1) * page_size
    rows = session.execute(
        base.order_by(ActionLog.requested_at.desc()).offset(offset).limit(page_size)
    ).scalars().all()

    return ActionLogListResponse(
        items=[ActionLogResponse.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )
