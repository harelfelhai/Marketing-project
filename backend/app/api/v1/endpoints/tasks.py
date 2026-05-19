"""
app/api/v1/endpoints/tasks.py — Domain E: Operations Task Queue (Phase DX).

Endpoints:
    GET  /api/v1/tasks                — Paginated task list with filter-as-view.
    GET  /api/v1/tasks/{task_id}      — Single-task detail (same shape as list item).
    POST /api/v1/tasks                — Open a new pending task.
    POST /api/v1/tasks/{task_id}/resolve  — Terminally settle a task.

FILTER-AS-VIEW PATTERN
-----------------------
Same convention as `/phones` and `/actions/logs`. The OperationsQueue UI
reaches its sub-views by query param:

    ?status=pending                       → Senior Admin work queue.
    ?status=resolved                      → Closed-task audit view.
    ?task_type=remediation_failure        → Automated-hand-off backlog.
    ?task_type=approval_required          → Operator authorization queue.
    ?phone_id=42                          → Task history for one phone.

All filters are additive (AND). New status / task_type values can be
introduced without API changes.

AUTH DEFERRAL
-------------
`requested_by` (on POST /tasks) and `operator_id` (on POST /tasks/{id}/resolve)
are explicit request-body fields. Permission gating is the frontend's job
via `MockAuthContext`. Phase G replaces the body fields with a
`get_current_operator` FastAPI dependency in a single swap.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import (
    get_current_user,
    get_export_service,
    get_pipeline_task_service,
    require_admin,
)
from models.user import User
from typing import Optional as _Optional
from app.schemas.api_contracts import (
    BulkResolveTaskRequest,
    BulkResolveTaskResponse,
    OpenTaskRequest,
    PipelineTaskListResponse,
    PipelineTaskResponse,
    ResolveTaskRequest,
    TableExportRequest,
)
from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from services.export import ExportService
from services.tasks import PipelineTaskService, TaskJoinRow


_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


router = APIRouter()


# ---------------------------------------------------------------------------
# Internal: JOIN-row → response flattener
# ---------------------------------------------------------------------------

def _row_to_response(row: TaskJoinRow) -> PipelineTaskResponse:
    """
    Flatten a (task, phone_number, entity_id, entity_type, client_id) JOIN
    tuple from PipelineTaskService into the PipelineTaskResponse shape.

    Keeps the convenience-field assembly in one place so list and detail
    endpoints stay symmetrical.
    """
    task, phone_number, entity_id, entity_type, client_id = row
    return PipelineTaskResponse(
        id=task.id,
        phone_id=task.phone_id,
        source_action_log_id=task.source_action_log_id,
        task_type=task.task_type,
        status=task.status,
        requested_by=task.requested_by,
        resolved_by=task.resolved_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
        resolved_at=task.resolved_at,
        extra_data=task.extra_data,
        phone_number=phone_number,
        entity_id=entity_id,
        entity_type=entity_type,
        client_id=client_id,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=PipelineTaskListResponse,
    summary="List pipeline tasks with optional filters",
    description=(
        "Returns a paginated, filterable view of the `pipeline_task` table "
        "joined with PhoneNumber + Entity so each row carries phone_number, "
        "entity_id, entity_type, and client_id without a secondary lookup."
        "\n\n"
        "**Operations Cockpit sub-views (filter-as-view):**\n"
        "- `?status=pending` — Senior Admin work queue.\n"
        "- `?status=resolved` — Closed-task audit.\n"
        "- `?task_type=remediation_failure` — Automated failure backlog.\n"
        "- `?phone_id=42` — Task history for one phone.\n"
        "\n"
        "All filters are additive (AND)."
    ),
)
def list_tasks(
    # // PHASE AUTH guardrail — Task Center is Admin-only. The
    # // unused `_admin` arg invokes the dep solely for its 401/403
    # // side effect.
    _admin: User = Depends(require_admin),
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        description=(
            "Filter by lifecycle state. "
            "Vocabulary: 'pending' | 'assigned' | 'resolved' | 'rejected'. "
            "Omit to return tasks across all statuses."
        ),
    ),
    task_type: Optional[str] = Query(
        default=None,
        description=(
            "Filter by task classification token. "
            "Vocabulary: 'remediation_failure' | 'approval_required' | "
            "'manual_recommendation'."
        ),
    ),
    phone_id: Optional[int] = Query(
        default=None,
        description="Filter to tasks attached to a single PhoneNumber.",
    ),
    exclude_terminal: bool = Query(
        default=False,
        description=(
            "When true, excludes terminal-status rows (resolved / "
            "rejected) from the result set. Used by the Task Center "
            "default view to surface only active work to managers. "
            "Has no effect when `status` is set explicitly — explicit "
            "filter intent wins (e.g., the closed-task audit view "
            "passes `?status=resolved` and expects to see them)."
        ),
    ),
    q: Optional[str] = Query(
        default=None,
        max_length=200,
        description=(
            "Free-text substring search across phone_number, "
            "requested_by, resolved_by, and client_id (stringified). "
            "Match is case-insensitive. Used by the Task Center search "
            "bar so the same intent applies to both the live list and "
            "the .xlsx export. Frontend-resolved client names are NOT "
            "matched — filter by the client_id dropdown for that."
        ),
    ),
    page: int = Query(default=1, ge=1, description="1-based page index."),
    page_size: int = Query(
        default=20,
        ge=1,
        le=500,
        description="Records per page (max 500, matches /actions/logs).",
    ),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskListResponse:
    """
    Paginated PipelineTask listing.

    Args:
        status_filter (Optional[str]): Filter on `pipeline_task.status`.
        task_type     (Optional[str]): Filter on `pipeline_task.task_type`.
        phone_id      (Optional[int]): Filter on `pipeline_task.phone_id`.
        page          (int):           1-based page number.
        page_size     (int):           Records per page.
        service       (PipelineTaskService): Injected via FastAPI Depends.

    Returns:
        PipelineTaskListResponse: Paginated rows with total count.
    """
    rows, total = service.list_tasks_with_join(
        status_filter=status_filter,
        task_type_filter=task_type,
        phone_id_filter=phone_id,
        exclude_terminal=exclude_terminal,
        q=q,
        page=page,
        page_size=page_size,
    )
    return PipelineTaskListResponse(
        items=[_row_to_response(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{task_id}",
    response_model=PipelineTaskResponse,
    summary="Get a single pipeline task by id",
    description=(
        "Returns one PipelineTask row joined with PhoneNumber + Entity. "
        "Used by the OperationsQueue drawer to render full task context "
        "including the proprietary `extra_data` payload."
    ),
)
def get_task(
    task_id: int,
    _admin: User = Depends(require_admin),     # Task Center guardrail
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskResponse:
    """
    Args:
        task_id (int):                       PK of the task to fetch.
        service (PipelineTaskService):       Injected via FastAPI Depends.

    Returns:
        PipelineTaskResponse: Single task row with JOIN convenience fields.

    Raises:
        HTTPException 404: `task_id` does not exist.
    """
    try:
        row = service.get_task_with_join(task_id=task_id)
    except PipelineTaskNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return _row_to_response(row)


@router.post(
    "",
    response_model=PipelineTaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Open a new pipeline task",
    description=(
        "Creates a new task in `pending` status. Used by:\n"
        "- Automation (dispatcher / retry engine policy) to hand off "
        "  unresolvable failures for human review.\n"
        "- Low-tier operators who lack execution privilege and need a "
        "  Senior Admin to authorize an action.\n"
        "\n"
        "Returns 404 if `phone_id` does not exist. "
        "Returns 422 if `source_action_log_id` references a log that "
        "does not belong to `phone_id`."
    ),
)
def open_task(
    body: OpenTaskRequest,
    current_user: _Optional[User] = Depends(get_current_user),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskResponse:
    """
    POST /tasks is the SOLE ungated task endpoint — automation +
    lower-tier operators both call it. Attribution semantics
    (Phase AUTH-B):

      * Logged-in operator → `requested_by = current_user.username`.
        The body's `requested_by` is IGNORED — no spoofing.
      * No session (automation) → `requested_by = body.requested_by`.
        If both are absent, we 422 (an unattributed task is meaningless).
    """
    if current_user is not None:
        attribution = current_user.username
    elif body.requested_by:
        attribution = body.requested_by
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Anonymous callers must supply `requested_by` "
                "(e.g. 'automation:retry_engine')."
            ),
        )

    try:
        task = service.open_task(
            phone_id=body.phone_id,
            task_type=body.task_type,
            requested_by=attribution,
            source_action_log_id=body.source_action_log_id,
            extra_data=body.extra_data,
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

    return _row_to_response(service.get_task_with_join(task_id=task.id))


@router.post(
    "/export",
    summary="Export the /tasks table to Excel (.xlsx)",
    description=(
        "Streams an .xlsx workbook containing the rows matching "
        "`filters` (same shape as the GET /tasks query params), "
        "projected onto the operator-supplied `columns`."
        "\n\n"
        "**Privacy gate:** every column `key` is validated against "
        "`ALLOWED_EXPORT_COLUMNS_TASKS` server-side. Out-of-allowlist "
        "keys (including arbitrary `extra_data.*` subkeys) are "
        "rejected with 422."
        "\n\n"
        "**Row cap:** 10,000. Requests yielding more rows return 422 "
        "with the actual count so the operator can narrow filters."
        "\n\n"
        "Registered BEFORE `/{task_id}/resolve` so the literal "
        "`/export` segment isn't captured by the dynamic param."
    ),
    responses={
        200: {
            "content": {_XLSX_MEDIA_TYPE: {}},
            "description": "The .xlsx workbook bytes.",
        }
    },
)
def export_tasks(
    body: TableExportRequest,
    _admin: User = Depends(require_admin),     # Task Center guardrail
    service: ExportService = Depends(get_export_service),
) -> Response:
    """
    Delegate to `ExportService.export_tasks` and stream the .xlsx
    bytes with download headers.

    Raises:
        HTTPException 422: column key outside allowlist OR row count
            exceeds MAX_EXPORT_ROWS.
    """
    try:
        xlsx_bytes, filename = service.export_tasks(
            filters=body.filters,
            columns=[c.model_dump() for c in body.columns],
            filename_hint=body.filename_hint,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return Response(
        content=xlsx_bytes,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/bulk-status",
    response_model=BulkResolveTaskResponse,
    summary="Bulk-settle many tasks to a terminal status in one request",
    description=(
        "Settles every task in `task_ids` to the requested `outcome` "
        "('resolved' or 'rejected'). Per-task failures (task missing, "
        "task already terminal) land in `failed_rows` alongside a 200 "
        "response — the resilience contract mirrors Phase E1's bulk-"
        "ingestion summary shape."
        "\n\n"
        "**Use case:** A manager who has executed operational decisions "
        "on N tasks offline marks all of them resolved in one click "
        "instead of N drawer-opens. The route is registered BEFORE "
        "`/{task_id}/resolve` because FastAPI matches in declaration "
        "order — listing it first prevents the dynamic `{task_id}` "
        "param from capturing the literal `bulk-status` segment."
        "\n\n"
        "**Request-level errors → 422:** invalid `outcome` token "
        "(not 'resolved' or 'rejected'), empty `task_ids` list, or "
        "more than 200 ids per request."
        "\n\n"
        "**Per-task failures → 200 body:** each non-settling task "
        "lands in `failed_rows` with a human-readable reason."
    ),
)
def bulk_resolve_tasks(
    body: BulkResolveTaskRequest,
    admin: User = Depends(require_admin),     # Task Center guardrail
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> BulkResolveTaskResponse:
    """
    Delegate to `PipelineTaskService.bulk_resolve_tasks` and shape the
    response. Phase AUTH-B: `operator_id` is taken from the
    authenticated session (admin only — enforced by require_admin)
    rather than the request body.
    """
    summary = service.bulk_resolve_tasks(
        task_ids=body.task_ids,
        operator_id=admin.username,
        outcome=body.outcome,
        resolution_note=body.resolution_note,
    )
    return BulkResolveTaskResponse.model_validate(summary)


@router.post(
    "/{task_id}/resolve",
    response_model=PipelineTaskResponse,
    summary="Terminally settle a pipeline task",
    description=(
        "Writes a terminal status ('resolved' or 'rejected'), the resolving "
        "operator_id, and the resolution timestamp atomically. The optional "
        "`resolution_note` is merged into `extra_data` rather than stored "
        "in a structured column (privacy contract)."
        "\n\n"
        "Returns 404 if the task does not exist. "
        "Returns 422 if the task is already in a terminal state."
    ),
)
def resolve_task(
    task_id: int,
    body: ResolveTaskRequest,
    admin: User = Depends(require_admin),     # Task Center guardrail
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskResponse:
    """
    Phase AUTH-B: `operator_id` removed from the body — admin's
    username comes from the session.
    """
    try:
        service.resolve_task(
            task_id=task_id,
            operator_id=admin.username,
            outcome=body.outcome,
            resolution_note=body.resolution_note,
        )
    except PipelineTaskNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except TaskStateTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return _row_to_response(service.get_task_with_join(task_id=task_id))
