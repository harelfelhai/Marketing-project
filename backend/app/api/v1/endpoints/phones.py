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

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, nullslast, or_, select as sa_select
from sqlalchemy.orm import aliased
from sqlmodel import Session, select

from app.api.deps import (
    get_action_data_trigger_service,
    get_bulk_ingestion_service,
    get_current_user,
    get_data_admin_service,
    get_export_service,
    get_scoring_service,
    require_admin,
)
from services.data_admin import DataAdminService
from models.user import User
from app.schemas.api_contracts import (
    ActionLogResponse,
    BulkIngestSummary,
    BulkTextIngestRequest,
    EntitySummary,
    IngestionResponse,
    PhoneDetailsResponse,
    PhoneListResponse,
    PhoneSummary,
    PhoneUpdateRequest,
    PhoneUpdateResponse,
    TableExportRequest,
)
from database import get_session
from exceptions import PhoneNumberNotFoundError, TargetNotFoundError
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import utc_now
from services.bulk_ingestion import BulkIngestionService
from services.dispatcher import ActionDataTriggerService
from services.export import ExportService
from services.scoring import ScoringService

router = APIRouter()


# Excel MIME — used by both the Phase EXP table export and the Phase E1-B
# template download below. Declared up here so both endpoints share one
# string literal.
_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


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
            "Filter by single integer client partition identifier. "
            "Matches against Entity.client_id. "
            "Example: pass 1 to return only phones for the first client partition."
        ),
    ),
    client_ids: Optional[list[int]] = Query(
        default=None,
        description=(
            "Phase AUTH-C — multi-value client filter for the "
            "personalization view. When present, restricts results "
            "to phones whose entity's client_id is in this list. "
            "Frontend builds this from the logged-in user's "
            "managed_client_ids. Mutually compatible with `client_id`: "
            "if both are set, both filters AND together (operator "
            "drilled into one specific client within their personalized "
            "subset)."
        ),
    ),
    sort_by: str = Query(
        default="priority",
        pattern="^(priority|ingested_at)$",
        description=(
            "Ordering key. 'priority' (default, Phase DY) sorts by "
            "priority_score DESC with NULLS LAST and `id DESC` as a "
            "tiebreaker so paginated cursors stay stable across requests. "
            "'ingested_at' preserves the legacy chronological ordering."
        ),
    ),
    q: Optional[str] = Query(
        default=None,
        max_length=200,
        description=(
            "Free-text substring search across phone_number, entity_id "
            "(stringified), and client_id (stringified). Match is "
            "case-insensitive. Lets the PhoneGrid search bar push the "
            "same intent through to the .xlsx export endpoint. "
            "Frontend-resolved client names are NOT matched server-side "
            "— filter by client_id directly for that."
        ),
    ),
    page: int = Query(default=1, ge=1, description="1-based page index."),
    page_size: int = Query(default=20, ge=1, le=200, description="Records per page (max 200)."),
    session: Session = Depends(get_session),
) -> PhoneListResponse:
    """
    Paginated phone number listing with JOIN-based entity_type filter and
    Phase DY priority sorting.

    Constructs a JOIN graph:
        PhoneNumber  ⟕  Entity (immediate owner)
                     LEFT-OUTER-⟕  Entity AS RootEntity (parent target,
                                    NULL when the immediate entity IS
                                    the root primary target).

    This lets the response builder extract `customer_tier` server-side
    from whichever entity is the root (immediate when target_entity_id
    is None; parent otherwise), avoiding a per-row second round-trip.

    The count query mirrors the data query's WHERE clauses exactly so
    `total` always matches the returned items.

    Args:
        verification_status (Optional[str]): Filter on PhoneNumber.verification_status.
        ingestion_source    (Optional[str]): Filter on PhoneNumber.ingestion_source.
        entity_type         (Optional[str]): Filter on Entity.entity_type (requires JOIN).
        classification_type (Optional[str]): Filter on PhoneNumber.classification_type.
        client_id           (Optional[int]): Filter on Entity.client_id (requires JOIN).
        sort_by             (str):           'priority' (default) or 'ingested_at'.
        page                (int):           1-based page number.
        page_size           (int):           Records per page.
        session             (Session):       Injected DB session.

    Returns:
        PhoneListResponse: Paginated items with total count.
    """
    # Alias for the root-entity self-join (Phase DY).
    RootEntity = aliased(Entity)

    base = (
        sa_select(
            PhoneNumber,
            Entity.entity_type,
            Entity.client_id,
            Entity.extra_data.label("immediate_extra"),
            RootEntity.extra_data.label("root_extra"),
        )
        .join(Entity, PhoneNumber.entity_id == Entity.id)
        .outerjoin(RootEntity, Entity.target_entity_id == RootEntity.id)
    )
    count_base = (
        sa_select(func.count(PhoneNumber.id))
        .join(Entity, PhoneNumber.entity_id == Entity.id)
    )

    # Apply filters symmetrically to both queries.
    # UAT round-3: hide soft-deleted rows. List endpoints never surface
    # tombstones; the admin tab queries via DataAdminService with
    # include_deleted=True explicitly.
    filters = [
        PhoneNumber.deleted_at.is_(None),
        Entity.deleted_at.is_(None),
    ]
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
    if client_ids:
        # Phase AUTH-C — multi-value personalization filter.
        filters.append(Entity.client_id.in_(client_ids))
    if q:
        like = f"%{q}%"
        # Substring across the operator-visible text in PhoneGrid. The
        # client display name lives only in the frontend's
        # clientRegistry; we match the integer client_id stringified
        # so a search for "1" still hits Client Alpha rows.
        filters.append(or_(
            PhoneNumber.phone_number.ilike(like),
            func.cast(PhoneNumber.entity_id, type_=PhoneNumber.phone_number.type).ilike(like),
            func.cast(Entity.client_id, type_=PhoneNumber.phone_number.type).ilike(like),
        ))

    for f in filters:
        base = base.where(f)
        count_base = count_base.where(f)

    # Ordering — Phase DY default is priority DESC with NULLS LAST and an
    # `id DESC` tiebreaker so pagination stays deterministic when many
    # rows share the same priority (common when scores are coarse).
    # `nullslast()` is the SQLAlchemy portable form: emits NULLS LAST on
    # Postgres natively and synthesises the equivalent CASE on SQLite.
    if sort_by == "priority":
        ordering = [nullslast(PhoneNumber.priority_score.desc()), PhoneNumber.id.desc()]
    else:  # 'ingested_at'
        ordering = [PhoneNumber.ingested_at.desc(), PhoneNumber.id.desc()]

    total: int = session.execute(count_base).scalar_one()

    offset = (page - 1) * page_size
    rows = session.execute(
        base.order_by(*ordering).offset(offset).limit(page_size)
    ).all()

    items = []
    for phone, etype, cid, immediate_extra, root_extra in rows:
        # Root entity's extra_data — falls back to the immediate entity
        # when the LEFT JOIN produced NULL (i.e. the immediate entity
        # IS the root). Tier is extracted into a structured int field.
        effective_extra = root_extra if root_extra is not None else immediate_extra
        customer_tier = None
        if effective_extra is not None:
            raw_tier = effective_extra.get("customer_tier")
            if raw_tier is not None:
                try:
                    customer_tier = int(raw_tier)
                except (TypeError, ValueError):
                    customer_tier = None

        items.append(
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
                confidence_score=phone.confidence_score,
                confidence_updated_at=phone.confidence_updated_at,
                priority_score=phone.priority_score,
                priority_updated_at=phone.priority_updated_at,
                customer_tier=customer_tier,
            )
        )

    return PhoneListResponse(items=items, total=total, page=page, page_size=page_size)


# ===========================================================================
# Phase EXP — Table export to .xlsx
# ===========================================================================
#
# Registered BEFORE `/{phone_id}` GET so the literal "/export" segment
# isn't captured as a path parameter and forced through int() (→ 422).


@router.post(
    "/export",
    summary="Export the /phones table to Excel (.xlsx)",
    description=(
        "Streams an .xlsx workbook containing the rows matching "
        "`filters` (same shape as the GET /phones query params), "
        "projected onto the operator-supplied `columns`."
        "\n\n"
        "**Privacy gate:** every column `key` is validated against "
        "`ALLOWED_EXPORT_COLUMNS_PHONES` server-side. Out-of-allowlist "
        "keys (including arbitrary `extra_data.*` subkeys) are "
        "rejected with 422."
        "\n\n"
        "**Row cap:** 10,000. Requests yielding more rows return 422 "
        "with the actual count so the operator can narrow filters."
    ),
    responses={
        200: {
            "content": {_XLSX_MEDIA_TYPE: {}},
            "description": "The .xlsx workbook bytes.",
        }
    },
)
def export_phones(
    body: TableExportRequest,
    service: ExportService = Depends(get_export_service),
) -> Response:
    """
    Delegate to `ExportService.export_phones` and stream the .xlsx
    bytes with download headers.

    Raises:
        HTTPException 422: column key outside allowlist OR row count
            exceeds MAX_EXPORT_ROWS.
    """
    try:
        xlsx_bytes, filename = service.export_phones(
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


# ===========================================================================
# Phase E1-B — Excel template download
# ===========================================================================
#
# Registered BEFORE GET /{phone_id} on purpose: FastAPI matches routes in
# declaration order, and "bulk-template" would otherwise be captured by
# the {phone_id} path param and fail int conversion (→ 422).

_TEMPLATE_FILENAME = "bulk_phones_template.xlsx"
# _XLSX_MEDIA_TYPE is declared at the top of the module — shared with
# the Phase EXP `/export` endpoint above.


@router.get(
    "/bulk-template",
    summary="Download the Excel upload template",
    description=(
        "Returns a freshly-generated `.xlsx` workbook containing two "
        "sheets: `data` (header row + 3 example rows) and `instructions` "
        "(Hebrew operator notes describing each column). The column names "
        "in the `data` sheet are the API contract — renaming them breaks "
        "the `/bulk-upload` endpoint."
    ),
    responses={
        200: {
            "content": {_XLSX_MEDIA_TYPE: {}},
            "description": "The generated .xlsx workbook bytes.",
        }
    },
)
def bulk_upload_template() -> Response:
    """
    Generate the template fresh on every request — the file is small
    (~6 KB) and this keeps the template definition in one place
    (`BulkIngestionService.generate_template_xlsx`) instead of also
    shipping a checked-in binary asset.

    Returns:
        Response: The .xlsx workbook bytes with appropriate headers.
    """
    payload = BulkIngestionService.generate_template_xlsx()
    return Response(
        content=payload,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{_TEMPLATE_FILENAME}"',
        },
    )


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

    Four sequential queries:
        1. PhoneNumber by PK — raises 404 if not found.
        2. Entity by phone.entity_id — always exists due to FK constraint.
        3. Optional root Entity via target_entity_id (Phase DY) — for the
           customer_tier extraction.
        4. ActionLog rows for phone_id, ordered most-recent-first.

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

    # Phase DY — resolve the root target Entity (one hop up) and extract
    # customer_tier. When the immediate entity IS the root, use its own
    # extra_data.
    root_entity = entity
    if entity is not None and entity.target_entity_id is not None:
        candidate = session.get(Entity, entity.target_entity_id)
        if candidate is not None:
            root_entity = candidate
    customer_tier: Optional[int] = None
    if root_entity is not None and root_entity.extra_data is not None:
        raw_tier = root_entity.extra_data.get("customer_tier")
        if raw_tier is not None:
            try:
                customer_tier = int(raw_tier)
            except (TypeError, ValueError):
                customer_tier = None

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
        confidence_score=phone.confidence_score,
        confidence_updated_at=phone.confidence_updated_at,
        priority_score=phone.priority_score,
        priority_updated_at=phone.priority_updated_at,
        customer_tier=customer_tier,
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
    scoring_service: ScoringService = Depends(get_scoring_service),
) -> PhoneUpdateResponse:
    """
    Partially update mutable PhoneNumber fields, run the Phase DY scoring
    recalc, and evaluate the Phase 2 re-dispatch trigger.

    Update semantics:
        - Only non-None fields in `body` are applied.
        - `extra_data` is replaced (not merged) when provided.
        - `confidence_score` updates also bump `confidence_updated_at`
          and trigger a `priority_score` recompute — all four columns
          land in one transaction (Phase DY atomic contract).
        - The list of actually-changed field names is passed to
          `ActionDataTriggerService` for trigger evaluation AFTER the
          atomic write commits.

    Args:
        phone_id        (int):                      PK of the PhoneNumber to update.
        body            (PhoneUpdateRequest):       Partial update payload.
        session         (Session):                 Injected DB session.
        trigger_service (ActionDataTriggerService): Injected trigger evaluator.
        scoring_service (ScoringService):           Phase DY scoring hook.

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

    # Phase DY — confidence_score is a mutable audit field. The scoring
    # service writes confidence + priority + both timestamps in one
    # session pass; we then commit ONCE for the whole PATCH.
    confidence_changed = (
        body.confidence_score is not None
        and float(body.confidence_score) != float(phone.confidence_score)
    )
    if confidence_changed:
        scoring_service.update_confidence_and_recalc(
            phone_id=phone_id,
            new_confidence=float(body.confidence_score),
            commit=False,
        )
        changed_fields.append("confidence_score")

    if changed_fields:
        phone.updated_at = utc_now()
        session.add(phone)
        session.commit()
        session.refresh(phone)

    # Evaluate whether any of the changed fields warrant a re-dispatch.
    # ActionDataTriggerService runs in its own session/transaction.
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


# ===========================================================================
# Phase E1 — Bulk text ingestion
# ===========================================================================


@router.post(
    "/bulk-text",
    response_model=BulkIngestSummary,
    summary="Bulk-ingest phone numbers under a shared envelope context",
    description=(
        "Tokenizes `phone_numbers_raw` (delimiters: comma, semicolon, "
        "any whitespace), normalizes each token, deduplicates within "
        "the batch, and inserts one new Entity (the shared envelope) "
        "plus one PhoneNumber per surviving token."
        "\n\n"
        "**Resilience contract:** per-row failures are collected into "
        "`failed_rows` and returned alongside a 200 response. Only "
        "request-shape errors (invalid `target_entity_id`, empty input, "
        "etc.) raise 4xx."
        "\n\n"
        "Every ingested phone is stamped with `bulk_submission_id` "
        "(uuid4) in its `extra_data`, allowing later filtering of "
        "everything from one batch."
    ),
)
def bulk_text_ingest(
    body: BulkTextIngestRequest,
    current_user: Optional[User] = Depends(get_current_user),
    service: BulkIngestionService = Depends(get_bulk_ingestion_service),
) -> BulkIngestSummary:
    """
    Args:
        body    (BulkTextIngestRequest): Validated request payload.
        service (BulkIngestionService):  Injected via FastAPI Depends.

    Returns:
        BulkIngestSummary: Counts + per-row failures + new IDs.

    Raises:
        HTTPException 422: `target_entity_id` was provided but does not
            exist in the database. Per-row failures do NOT raise — they
            land inside the 200 response body.
    """
    try:
        summary = service.ingest_bulk_text(
            phone_numbers_raw=body.phone_numbers_raw,
            client_id=body.client_id,
            entity_type=body.entity_type,
            ingestion_source=body.ingestion_source,
            target_entity_id=body.target_entity_id,
            ingestion_reason=body.ingestion_reason,
            entity_extra=body.entity_extra,
            phone_extra_shared=body.phone_extra_shared,
            uploaded_by_user_id=current_user.id if current_user else None,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return BulkIngestSummary.model_validate(summary)


# ===========================================================================
# Phase E1-B — Excel / CSV bulk upload
# ===========================================================================

# 5 MB hard cap on uploaded files. Operators uploading >5MB of phone-number
# rows are almost always doing something wrong (re-uploading their whole
# CRM export by mistake); the service-layer row cap of 5,000 is a much
# tighter bound for normal use. Keeping the byte cap loose enough that a
# legitimate 5,000-row sheet always fits.
_UPLOAD_MAX_BYTES = 5 * 1024 * 1024


@router.post(
    "/bulk-upload",
    response_model=BulkIngestSummary,
    summary="Bulk-ingest phone numbers from an Excel (.xlsx) or CSV file",
    description=(
        "Accepts a multipart/form-data upload containing one row per "
        "phone number. The required columns are: `phone_number`, "
        "`client_id`, `entity_type`, `ingestion_source`. Optional: "
        "`target_entity_id`, `ingestion_reason`."
        "\n\n"
        "Unlike `/bulk-text` (which collapses all rows under a single "
        "shared envelope), `/bulk-upload` creates one Entity per row — "
        "each row is its own ingestion context."
        "\n\n"
        "**Resilience contract:** per-row failures land in `failed_rows` "
        "alongside a 200 response. File-shape errors (wrong extension, "
        "malformed workbook, missing required columns, >5,000 rows) "
        "raise 422."
    ),
)
async def bulk_upload_ingest(
    file: UploadFile = File(..., description="The .xlsx or .csv file to ingest."),
    current_user: Optional[User] = Depends(get_current_user),
    service: BulkIngestionService = Depends(get_bulk_ingestion_service),
) -> BulkIngestSummary:
    """
    Read the upload into memory, hand it to the service, and translate
    file-shape errors (ValueError) to 422.

    Args:
        file    (UploadFile):           Uploaded file from multipart/form-data.
        service (BulkIngestionService): Injected via FastAPI Depends.

    Returns:
        BulkIngestSummary: Counts + per-row failures + new IDs.

    Raises:
        HTTPException 413: Uploaded file exceeds the 5 MB cap.
        HTTPException 422: File is malformed, has the wrong extension,
            is missing required columns, or exceeds the row cap.
    """
    file_bytes = await file.read()
    if len(file_bytes) > _UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Uploaded file is {len(file_bytes)} bytes; max allowed is "
                f"{_UPLOAD_MAX_BYTES}."
            ),
        )
    try:
        summary = service.ingest_bulk_upload(
            file_bytes=file_bytes,
            filename=file.filename or "",
            uploaded_by_user_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return BulkIngestSummary.model_validate(summary)


# ===========================================================================
# UAT round-3 — Admin patch / soft-delete / restore for phones
# ===========================================================================


from pydantic import BaseModel as _AdminBaseModel, Field as _AdminField  # noqa: E402


def _phone_to_dict(ph) -> dict:
    return {
        "id":                  ph.id,
        "entity_id":           ph.entity_id,
        "phone_number":        ph.phone_number,
        "classification_type": ph.classification_type,
        "ingestion_source":    ph.ingestion_source,
        "verification_status": ph.verification_status,
        "priority_score":      ph.priority_score,
        "customer_tier":       ph.customer_tier,
        "ingested_at":         ph.ingested_at,
        "created_at":          ph.created_at,
        "updated_at":          ph.updated_at,
        "deleted_at":          ph.deleted_at,
        "extra_data":          ph.extra_data,
    }


class _PhonePatchIn(_AdminBaseModel):
    phone_number:        Optional[str] = _AdminField(default=None, max_length=40)
    classification_type: Optional[str] = _AdminField(default=None, max_length=40)
    verification_status: Optional[str] = _AdminField(default=None, max_length=40)


@router.patch(
    "/{phone_id}/admin",
    summary="Admin edit a phone row (UAT round-3)",
    description=(
        "Partial update for the data-admin tab. Distinct from the "
        "verification-flow PATCH `/phones/{id}` (which only flips the "
        "verification axis): this endpoint accepts arbitrary phone "
        "edits and is role-gated to admins. Tombstones are NOT editable "
        "— restore the row first."
    ),
)
def admin_patch_phone(
    phone_id: int,
    body: _PhonePatchIn,
    _admin_user: User = Depends(require_admin),
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ph = admin.patch_phone(
            phone_id,
            phone_number=body.phone_number,
            classification_type=body.classification_type,
            verification_status=body.verification_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _phone_to_dict(ph)


@router.delete(
    "/{phone_id}",
    summary="Soft-delete a phone (admin, UAT round-3)",
)
def soft_delete_phone(
    phone_id: int,
    _admin_user: User = Depends(require_admin),
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ph = admin.soft_delete_phone(phone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _phone_to_dict(ph)


@router.post(
    "/{phone_id}/restore",
    summary="Restore a soft-deleted phone (admin, UAT round-3)",
)
def restore_phone(
    phone_id: int,
    _admin_user: User = Depends(require_admin),
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ph = admin.restore_phone(phone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _phone_to_dict(ph)
