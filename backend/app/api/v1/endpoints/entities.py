"""
app/api/v1/endpoints/entities.py — Phase E2: Entity Ingestion Channels.

Endpoints:
    POST /api/v1/entities                — Single-entry (E2-A) "+ Add Person" Tab 1
    POST /api/v1/entities/bulk-text      — Two-Step grid (E2-B) Tab 3
    POST /api/v1/entities/bulk-upload    — Excel/CSV upload (E2-B) Tab 2
    GET  /api/v1/entities/bulk-template  — Template download for Tab 2

PURPOSE
-------
The entity-centric ingestion path complements the phone-centric path:
operators discover an individual (family member, colleague, etc.) who
matters to a Target Client BEFORE finding their phone number, and need
a way to persist that person so the system's scraping and framing
layers can hunt for their numbers asynchronously.

This router only handles HTTP concerns: request validation, dependency
injection, exception translation, and response serialization. All
business logic lives in `EntityIngestionService`.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status

from app.api.deps import get_current_user, get_entity_ingestion_service
from app.schemas.api_contracts import BulkIngestSummary
from exceptions import TargetNotFoundError
from models.user import User
from schemas.entity_ingestion import (
    EntityBulkTextIn,
    EntitySingleCreateIn,
    EntitySingleCreateOut,
)
from services.entity_ingestion import EntityIngestionService

router = APIRouter()


# ===========================================================================
# Phase E2-B — Excel template download
# ===========================================================================
#
# Registered BEFORE any path that could capture "bulk-template" as a path
# param (e.g. a hypothetical GET /{entity_id}). FastAPI matches routes in
# declaration order — listing the static path first keeps the dynamic
# route from shadowing it.

_TEMPLATE_FILENAME = "bulk_entities_template.xlsx"
_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

# 5 MB upload cap, matching the phone-side bulk-upload endpoint. The
# service-layer row cap (5,000) is the tighter operational bound; the
# byte cap protects against a 50 MB CRM export uploaded by accident.
_UPLOAD_MAX_BYTES = 5 * 1024 * 1024


@router.get(
    "/bulk-template",
    summary="Download the Excel entity-upload template",
    description=(
        "Returns a freshly-generated `.xlsx` workbook containing three "
        "sheets: `data` (header row + 2 example rows), `valid_targets` "
        "(a live snapshot of every current root target's "
        "`target_entity_id` + `client_id`, so operators can look up the "
        "correct integer FK to put in the data sheet), and "
        "`instructions` (Hebrew operator notes describing each column)."
        "\n\n"
        "The `valid_targets` sheet is computed on every download — it "
        "always reflects the current target list."
    ),
    responses={
        200: {
            "content": {_XLSX_MEDIA_TYPE: {}},
            "description": "The generated .xlsx workbook bytes.",
        }
    },
)
def bulk_upload_template(
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> Response:
    """
    Generate the template fresh on every request. Cost is small (~8 KB
    + one Entity query) and centralizing the template definition in the
    service keeps the column contract in one place.

    Returns:
        Response: The .xlsx workbook bytes with download headers.
    """
    payload = service.generate_template_xlsx()
    return Response(
        content=payload,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{_TEMPLATE_FILENAME}"',
        },
    )


@router.post(
    "",
    response_model=EntitySingleCreateOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a single named Entity associated with a root target",
    description=(
        "Creates one Entity row representing a named individual (family "
        "member, friend, colleague, or spouse of a root target). The "
        "row's `client_id` is INHERITED from the target — it is not "
        "accepted on the request — which prevents partition drift "
        "between a target and its associated entities."
        "\n\n"
        "Names (`first_name`, `last_name`) are stored inside the opaque "
        "`Entity.extra_data` JSON blob per the Secrets-Free Mandate; "
        "they never land on schema-level columns. The response echoes "
        "the names back so the operator-facing success panel can "
        "render the confirmation chip and seed the follow-on phone "
        "ingestion modal without a second round-trip."
        "\n\n"
        "**Validation errors → 422:**\n"
        "- `target_entity_id` does not exist.\n"
        "- `target_entity_id` points at a non-root entity (its own "
        "`target_entity_id` is non-NULL).\n"
        "- `relation_type` is outside the operator-creatable subset "
        "(`family`, `friend`, `colleague`, `spouse`).\n"
        "- `first_name` is empty or longer than 80 characters."
    ),
)
def create_single_entity(
    payload: EntitySingleCreateIn,
    current_user: Optional[User] = Depends(get_current_user),
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> EntitySingleCreateOut:
    """
    Translate the request payload, delegate to the service, and shape
    the response for the friction-free UX chain.

    The response carries everything the frontend needs to immediately
    open the phone-ingestion modal pre-filled with the new person's
    target and relation context: `id`, `client_id`, `target_entity_id`,
    and `relation_type`. Names are echoed for the success chip.

    Args:
        payload (EntitySingleCreateIn): Validated request body.
        service (EntityIngestionService): Injected via FastAPI Depends.

    Returns:
        EntitySingleCreateOut: The newly created entity, shaped for the
        friction-free UX chain.

    Raises:
        HTTPException 422: target validation failed (see endpoint
        description for the exact triggers).
    """
    try:
        new_entity = service.create_single(
            first_name=payload.first_name,
            last_name=payload.last_name,
            # `relation_type` is the AssociatedRelationType enum on the
            # Pydantic model. Pass `.value` so the service receives a
            # plain string (the same shape `Entity.entity_type` stores).
            relation_type=payload.relation_type.value,
            target_entity_id=payload.target_entity_id,
            extra_data=payload.extra_data,
            created_by_user_id=current_user.id if current_user else None,
        )
    except TargetNotFoundError as exc:
        # Target missing OR target is not a root — both map to 422 per
        # the Phase E1 / E2 contract that request-shape errors return
        # 422, not 404 (the legacy /ingest endpoint returns 404 here,
        # but that contract predates the bulk family).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # The service merged the names into extra_data; pull them back out
    # for the response so the frontend doesn't have to dig into the
    # opaque blob. `extra_data` is guaranteed to be a dict here because
    # the service always merges at least the first_name key in.
    extra = new_entity.extra_data or {}
    return EntitySingleCreateOut(
        id=new_entity.id,
        client_id=new_entity.client_id,
        relation_type=new_entity.entity_type,
        target_entity_id=new_entity.target_entity_id,
        first_name=extra.get("first_name", payload.first_name),
        last_name=extra.get("last_name"),
        created_at=new_entity.created_at,
    )


# ===========================================================================
# Phase E2-B — Bulk-text (Two-Step grid) ingestion
# ===========================================================================


@router.post(
    "/bulk-text",
    response_model=BulkIngestSummary,
    summary="Bulk-create Entity rows from a client-tokenized inline grid",
    description=(
        "Accepts the curated row list produced by the operator's Two-Step "
        "grid (Step 1: paste raw names; Step 2: edit inline). Each row "
        "becomes one new Entity row associated with either the request-"
        "level default target or a per-row override."
        "\n\n"
        "Naming note: the endpoint is called 'bulk-text' for symmetry "
        "with the operator-facing modal tab strip, but the wire "
        "contract is a structured row list, NOT raw text. The "
        "tokenization step happens entirely on the client; the server "
        "sees pre-typed records."
        "\n\n"
        "**Resilience contract:** per-row failures land in `failed_rows` "
        "alongside a 200 response. Only the request-level "
        "`default_target_entity_id` validation raises 4xx (422 when the "
        "default target is missing or not a root). Per-row target "
        "OVERRIDES that don't resolve are per-row failures, not aborts."
        "\n\n"
        "Every created Entity is stamped with `bulk_submission_id` "
        "(uuid4) in its `extra_data` for batch-correlation searches."
    ),
)
def bulk_text_ingest(
    body: EntityBulkTextIn,
    current_user: Optional[User] = Depends(get_current_user),
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> BulkIngestSummary:
    """
    Translate the typed Pydantic body into the dict shape the service
    expects, delegate, and surface request-level target errors as 422.

    Args:
        body    (EntityBulkTextIn):       Validated request payload.
        service (EntityIngestionService): Injected via FastAPI Depends.

    Returns:
        BulkIngestSummary: success counts + per-row failures + new ids.
        `phone_ids` is always empty for entity endpoints.

    Raises:
        HTTPException 422: request-level `default_target_entity_id`
            does not exist OR is not a root target.
    """
    # The service signature accepts plain dicts so it can be exercised
    # without constructing the Pydantic models in tests. Convert the
    # validated model -> plain dicts here. `relation_type` is the enum
    # value on the model — pull `.value` so the service sees a string.
    rows = [
        {
            "row_token":        r.row_token,
            "first_name":       r.first_name,
            "last_name":        r.last_name,
            "relation_type":    r.relation_type.value if r.relation_type else None,
            "target_entity_id": r.target_entity_id,
        }
        for r in body.rows
    ]
    try:
        summary = service.ingest_bulk_text(
            rows=rows,
            default_relation_type=body.default_relation_type.value,
            default_target_entity_id=body.default_target_entity_id,
            created_by_user_id=current_user.id if current_user else None,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return BulkIngestSummary.model_validate(summary)


# ===========================================================================
# Phase E2-B — Excel / CSV bulk upload
# ===========================================================================


@router.post(
    "/bulk-upload",
    response_model=BulkIngestSummary,
    summary="Bulk-create Entity rows from an Excel (.xlsx) or CSV file",
    description=(
        "Accepts a multipart/form-data upload containing one row per "
        "Entity. Required columns: `first_name`, `relation_type`, "
        "`target_entity_id`. Optional: `last_name`."
        "\n\n"
        "Unlike `/bulk-text` (which applies modal-level defaults to "
        "rows that don't override them), `/bulk-upload` requires every "
        "row to fully specify its own `relation_type` and "
        "`target_entity_id` — each row is its own ingestion context."
        "\n\n"
        "**Resilience contract:** per-row failures (missing first_name, "
        "invalid relation_type, missing or non-root target_entity_id) "
        "land in `failed_rows` alongside a 200 response. File-shape "
        "errors (wrong extension, missing required columns, >5,000 "
        "rows, malformed workbook) raise 422."
    ),
)
async def bulk_upload_ingest(
    file: UploadFile = File(..., description="The .xlsx or .csv file to ingest."),
    current_user: Optional[User] = Depends(get_current_user),
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> BulkIngestSummary:
    """
    Buffer the upload, validate size, delegate to the service, translate
    file-shape errors (ValueError) to 422.

    Args:
        file    (UploadFile):             Multipart upload.
        service (EntityIngestionService): Injected via FastAPI Depends.

    Returns:
        BulkIngestSummary: counts + per-row failures + new ids.

    Raises:
        HTTPException 413: file exceeds the 5 MB cap.
        HTTPException 422: malformed file, wrong extension, missing
            required columns, or row cap exceeded.
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
            created_by_user_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return BulkIngestSummary.model_validate(summary)
