"""
app/api/v1/endpoints/phones.py — Domain B/D: Phone Number Queries & Updates.

Endpoints:
    GET  /api/v1/phones              — Paginated phone list with multi-column filtering.
    GET  /api/v1/phones/{phone_id}   — Full detail view (phone + entity + action timeline).
    PATCH /api/v1/phones/{phone_id}  — Partial update with automatic re-dispatch trigger.

FILTER-AS-VIEW PATTERN
-----------------------
`GET /api/v1/phones` doubles as the operator task queue by accepting
`?verification_status=pending`. No dedicated "review queue" endpoint is needed;
the status filter is expressive enough to isolate any sub-view the UI requires.

This means adding a new "stage" to the operator workflow requires only a new
status value in the DB, not a new API endpoint — the contract stays stable.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select as sa_select
from sqlmodel import Session, select

from app.api.deps import get_action_data_trigger_service
from app.schemas.api_contracts import (
    ActionLogResponse,
    EntitySummary,
    IngestionResponse,
    PhoneDetailsResponse,
    PhoneListResponse,
    PhoneSummary,
    PhoneUpdateRequest,
    PhoneUpdateResponse,
)
from database import get_session
from exceptions import PhoneNumberNotFoundError
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from services.dispatcher import ActionDataTriggerService

router = APIRouter()


@router.get(
    "",
    response_model=PhoneListResponse,
    summary="List phone numbers with optional filters",
    description=(
        "Returns a paginated list of PhoneNumber records joined with their owning "
        "Entity. Supports filtering by verification_status, ingestion_source, "
        "entity_type, and classification_type. "
        "\n\n"
        "**Task-queue pattern**: Pass `?verification_status=pending` to use this "
        "endpoint as the operator task queue — it returns exactly the numbers that "
        "have been ingested and are awaiting Phase 3 quality review after Phase 2 "
        "action history has accumulated."
        "\n\n"
        "**Filter semantics**: All filters are additive (AND). Omit a filter to "
        "include all values of that dimension."
    ),
)
def list_phones(
    verification_status: Optional[str] = Query(
        default=None,
        description=(
            "Filter by Phase 3 quality state. "
            "Pass 'pending' to display the operator task queue. "
            "Pass 'verified_good' or 'verified_bad' to review completed evaluations."
        ),
    ),
    ingestion_source: Optional[str] = Query(
        default=None,
        description=(
            "Filter by ingestion origin channel. "
            "Example values: 'manual', 'automated'."
        ),
    ),
    entity_type: Optional[str] = Query(
        default=None,
        description=(
            "Filter by the relationship classification of the owning Entity. "
            "Example values: 'family', 'friend'. Requires a JOIN with the Entity table."
        ),
    ),
    classification_type: Optional[str] = Query(
        default=None,
        description="Filter by the system classification label on the PhoneNumber row.",
    ),
    client_id: Optional[int] = Query(
        default=None,
        description=(
            "Filter by integer client partition identifier. "
            "Matches against Entity.client_id. "
            "Example: pass 1 to return only phones for the first client partition."
        ),
    ),
    page: int = Query(default=1, ge=1, description="1-based page index."),
    page_size: int = Query(default=20, ge=1, le=200, description="Records per page (max 200)."),
    session: Session = Depends(get_session),
) -> PhoneListResponse:
    """
    Paginated phone number listing with JOIN-based entity_type filter.

    Constructs a single JOIN query (PhoneNumber ⟕ Entity) so that:
        - `entity_type` filtering is applied in SQL without a second round-trip.
        - The `PhoneSummary.entity_type` field is populated from the JOIN result.

    The count query mirrors the data query's WHERE clauses exactly to ensure
    the `total` figure is always consistent with the returned items.

    Args:
        verification_status (Optional[str]): Filter on PhoneNumber.verification_status.
        ingestion_source    (Optional[str]): Filter on PhoneNumber.ingestion_source.
        entity_type         (Optional[str]): Filter on Entity.entity_type (requires JOIN).
        classification_type (Optional[str]): Filter on PhoneNumber.classification_type.
        client_id           (Optional[int]): Filter on Entity.client_id (requires JOIN).
        page                (int):           1-based page number.
        page_size           (int):           Records per page.
        session             (Session):       Injected DB session.

    Returns:
        PhoneListResponse: Paginated items with total count.
    """
    # Build the base JOIN. We always join Entity so entity_type and client_id
    # are available in the result set without conditional logic in the response builder.
    base = (
        sa_select(PhoneNumber, Entity.entity_type, Entity.client_id)
        .join(Entity, PhoneNumber.entity_id == Entity.id)
    )
    count_base = (
        sa_select(func.count(PhoneNumber.id))
        .join(Entity, PhoneNumber.entity_id == Entity.id)
    )

    # Apply filters symmetrically to both queries.
    filters = []
    if verification_status is not None:
        filters.append(PhoneNumber.verification_status == verification_status)
    if ingestion_source is not None:
        filters.append(PhoneNumber.ingestion_source == ingestion_source)
    if entity_type is not None:
        filters.append(Entity.entity_type == entity_type)
    if classification_type is not None:
        filters.append(PhoneNumber.classification_type == classification_type)
    if client_id is not None:
        filters.append(Entity.client_id == client_id)

    for f in filters:
        base = base.where(f)
        count_base = count_base.where(f)

    total: int = session.execute(count_base).scalar_one()

    offset = (page - 1) * page_size
    rows = session.execute(base.order_by(PhoneNumber.ingested_at.desc()).offset(offset).limit(page_size)).all()

    items = [
        PhoneSummary(
            id=phone.id,
            phone_number=phone.phone_number,
            entity_id=phone.entity_id,
            client_id=cid,
            entity_type=etype,
            classification_type=phone.classification_type,
            verification_status=phone.verification_status,
            verification_source=phone.verification_source,
            ingestion_source=phone.ingestion_source,
            ingested_at=phone.ingested_at,
            created_at=phone.created_at,
        )
        for phone, etype, cid in rows
    ]

    return PhoneListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get(
    "/{phone_id}",
    response_model=PhoneDetailsResponse,
    summary="Get full detail for a single phone number",
    description=(
        "Returns the complete lifecycle picture for one PhoneNumber: "
        "all three phase blocks (ingestion, verification, action history) plus "
        "the nested Entity summary. The `action_timeline` list is ordered "
        "most-recent-first, matching the natural audit reading order."
    ),
)
def get_phone_detail(
    phone_id: int,
    session: Session = Depends(get_session),
) -> PhoneDetailsResponse:
    """
    Fetch a PhoneNumber row and join its Entity + ActionLog history.

    Three sequential queries:
        1. PhoneNumber by PK — raises 404 if not found.
        2. Entity by phone.entity_id — always exists due to FK constraint.
        3. ActionLog rows for phone_id, ordered most-recent-first.

    Args:
        phone_id (int):     PK of the PhoneNumber row.
        session  (Session): Injected DB session.

    Returns:
        PhoneDetailsResponse: Full detail with nested entity and action timeline.

    Raises:
        HTTPException 404: No PhoneNumber with that PK.
    """
    phone = session.get(PhoneNumber, phone_id)
    if phone is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PhoneNumber with id={phone_id} not found.",
        )

    entity = session.get(Entity, phone.entity_id)

    action_logs = session.exec(
        select(ActionLog)
        .where(ActionLog.phone_id == phone_id)
        .order_by(ActionLog.requested_at.desc())
    ).all()

    return PhoneDetailsResponse(
        id=phone.id,
        phone_number=phone.phone_number,
        entity_id=phone.entity_id,
        classification_type=phone.classification_type,
        ingestion_source=phone.ingestion_source,
        ingestion_reason=phone.ingestion_reason,
        ingested_at=phone.ingested_at,
        verification_status=phone.verification_status,
        verification_source=phone.verification_source,
        verification_reason=phone.verification_reason,
        verified_at=phone.verified_at,
        extra_data=phone.extra_data,
        created_at=phone.created_at,
        updated_at=phone.updated_at,
        entity=EntitySummary.model_validate(entity),
        action_timeline=[ActionLogResponse.model_validate(log) for log in action_logs],
    )


@router.patch(
    "/{phone_id}",
    response_model=PhoneUpdateResponse,
    summary="Partially update a phone number's mutable fields",
    description=(
        "Applies a partial update to the mutable fields of a PhoneNumber row "
        "(`classification_type`, `extra_data`). Phase 3 verification fields are "
        "intentionally excluded — those are written exclusively by VerificationService. "
        "\n\n"
        "After persisting the update, the endpoint calls "
        "`ActionDataTriggerService.evaluate_data_change_trigger()` with the names "
        "of the changed fields. If the trigger condition is met (a previously failed "
        "action exists and the changed fields intersect the trigger allowlist), "
        "a fresh re-dispatch is initiated and the new ActionLog is returned in "
        "`triggered_action`."
    ),
)
def update_phone(
    phone_id: int,
    body: PhoneUpdateRequest,
    session: Session = Depends(get_session),
    trigger_service: ActionDataTriggerService = Depends(get_action_data_trigger_service),
) -> PhoneUpdateResponse:
    """
    Partially update mutable PhoneNumber fields and evaluate re-dispatch trigger.

    Update semantics:
        - Only non-None fields in `body` are applied.
        - `extra_data` is replaced (not merged) when provided.
        - The list of actually-changed field names is passed to
          `ActionDataTriggerService` for trigger evaluation.

    Args:
        phone_id        (int):                    PK of the PhoneNumber to update.
        body            (PhoneUpdateRequest):     Partial update payload.
        session         (Session):               Injected DB session.
        trigger_service (ActionDataTriggerService): Injected trigger evaluator.

    Returns:
        PhoneUpdateResponse: Updated phone + optional triggered ActionLog.

    Raises:
        HTTPException 404: No PhoneNumber with that PK.
    """
    phone = session.get(PhoneNumber, phone_id)
    if phone is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PhoneNumber with id={phone_id} not found.",
        )

    # Track which fields actually change so the trigger service can apply
    # its allowlist gate accurately.
    changed_fields: list[str] = []

    if body.classification_type is not None and body.classification_type != phone.classification_type:
        phone.classification_type = body.classification_type
        changed_fields.append("classification_type")

    if body.extra_data is not None:
        phone.extra_data = body.extra_data
        changed_fields.append("extra_data")

    if changed_fields:
        phone.updated_at = datetime.utcnow()
        session.add(phone)
        session.commit()
        session.refresh(phone)

    # Evaluate whether any of the changed fields warrant a re-dispatch.
    triggered_log = None
    if changed_fields:
        try:
            triggered_log = trigger_service.evaluate_data_change_trigger(
                phone_id=phone_id,
                updated_fields=changed_fields,
            )
        except PhoneNumberNotFoundError:
            # Phone was confirmed to exist above; this path is unreachable
            # under normal operation — skip silently.
            pass

    return PhoneUpdateResponse(
        phone=IngestionResponse.model_validate(phone),
        triggered_action=ActionLogResponse.model_validate(triggered_log) if triggered_log else None,
    )
