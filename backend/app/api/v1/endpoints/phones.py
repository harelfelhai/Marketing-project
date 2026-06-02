"""
app/api/v1/endpoints/phones.py — Phone Number Queries & Updates.

Endpoints:
    GET  /api/v1/phones              — Paginated phone list with multi-column filtering.
    GET  /api/v1/phones/{phone_id}   — Full detail view (phone + entity).
    PATCH /api/v1/phones/{phone_id}/admin  — Admin partial update.
    DELETE /api/v1/phones/{phone_id} — Soft-delete.
    POST /api/v1/phones/{phone_id}/restore — Restore.
    POST /api/v1/phones/quick        — Attach a phone to an existing entity.
    POST /api/v1/phones/bulk-text    — Bulk-ingest phone numbers.
    POST /api/v1/phones/bulk-upload  — Excel/CSV bulk upload.
    GET  /api/v1/phones/bulk-template — Template download.
    POST /api/v1/phones/export       — Export to .xlsx.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel as _BaseModel, Field as _Field
from sqlmodel import Session

from app.api.deps import (
    get_bulk_ingestion_service,
    get_current_user,
    get_data_admin_service,
    get_export_service,
    get_ingestion_service,
    get_storage,
    require_admin,
)
from services.data_admin import DataAdminService
from models.user import User
from app.schemas.api_contracts import (
    BulkIngestSummary,
    EntitySummary,
    IngestionResponse,
    PhoneDetailsResponse,
    PhoneListResponse,
    PhoneSummary,
    PhoneUpdateResponse,
    TableExportRequest,
)
from database import get_session
from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import SOFT_DELETE_SENTINEL
from services.bulk_ingestion import BulkIngestionService
from services.export import ExportService
from services.ingestion import IngestionService
from services.read_model.manager import read_model_manager

router = APIRouter()


_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


@router.get(
    "",
    response_model=PhoneListResponse,
    summary="List phone numbers with optional filters",
)
def list_phones(
    verification_status: Optional[str] = Query(default=None),
    ingestion_source: Optional[str] = Query(default=None),
    phone_type: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    include_deleted: bool = Query(default=False),
    storage=Depends(get_storage),
) -> PhoneListResponse:
    """
    Paginated phone number listing joined with owning Entity.

    Fast path (production): served from the in-memory ReadModelStore,
    zero DB queries per request.
    Fallback path (tests / startup failure): two DB queries as before.
    """
    mgr = read_model_manager
    if mgr.started:
        # ── Memory path ──────────────────────────────────────────────
        phones   = list(mgr.store.all_phones)
        entities = mgr.store.entities_by_id
        if not include_deleted:
            phones = [
                p for p in phones
                if p.deleted_at == SOFT_DELETE_SENTINEL
                and entities.get(p.entity_id) is not None
                and entities[p.entity_id].deleted_at == SOFT_DELETE_SENTINEL
            ]
        if verification_status is not None:
            phones = [p for p in phones if p.verification_status == verification_status]
        if ingestion_source is not None:
            phones = [p for p in phones if p.ingestion_source == ingestion_source]
        if phone_type is not None:
            phones = [p for p in phones if p.phone_type == phone_type]
    else:
        # ── DB fallback ───────────────────────────────────────────────
        phone_where: dict = {}
        if not include_deleted:
            phone_where["deleted_at"] = SOFT_DELETE_SENTINEL
        if verification_status is not None:
            phone_where["verification_status"] = verification_status
        if ingestion_source is not None:
            phone_where["ingestion_source"] = ingestion_source
        if phone_type is not None:
            phone_where["phone_type"] = phone_type
        phones = storage.phones.list(phone_where)
        entity_ids = list({p.entity_id for p in phones})
        entities: dict = {}
        if entity_ids:
            ent_rows = storage.entities.list({"id": {"in": entity_ids}})
            entities = {e.id: e for e in ent_rows}
        if not include_deleted:
            phones = [
                p for p in phones
                if entities.get(p.entity_id) is not None
                and entities[p.entity_id].deleted_at == SOFT_DELETE_SENTINEL
            ]

    # ── Common: free-text, sort, paginate, build items ────────────────
    if q:
        needle = q.strip().lower()
        def _hay(ph):
            ent = entities.get(ph.entity_id)
            return " ".join(filter(None, [
                ph.phone_number,
                ent.full_name if ent else "",
                ent.identifier_1 if ent else "",
            ])).lower()
        phones = [p for p in phones if needle in _hay(p)]

    phones.sort(key=lambda p: (p.score, p.id), reverse=True)

    total  = len(phones)
    offset = (page - 1) * page_size
    items  = []
    for phone in phones[offset: offset + page_size]:
        ent = entities.get(phone.entity_id)
        items.append(
            PhoneSummary(
                id=phone.id,
                phone_number=phone.phone_number,
                entity_id=phone.entity_id,
                phone_type=phone.phone_type,
                verification_status=phone.verification_status,
                ingestion_source=phone.ingestion_source,
                score=phone.score,
                relation_type=ent.relation_type if ent else None,
                full_name=ent.full_name if ent else None,
                identifier_1=ent.identifier_1 if ent else None,
                identifier_2=ent.identifier_2 if ent else None,
            )
        )

    return PhoneListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post(
    "/export",
    summary="Export the /phones table to Excel (.xlsx)",
    responses={200: {"content": {_XLSX_MEDIA_TYPE: {}}}},
)
def export_phones(
    body: TableExportRequest,
    service: ExportService = Depends(get_export_service),
) -> Response:
    try:
        xlsx_bytes, filename = service.export_phones(
            filters=body.filters,
            columns=[c.model_dump() for c in body.columns],
            filename_hint=body.filename_hint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    return Response(
        content=xlsx_bytes,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_TEMPLATE_FILENAME = "bulk_phones_template.xlsx"


@router.get(
    "/bulk-template",
    summary="Download the Excel upload template",
    responses={200: {"content": {_XLSX_MEDIA_TYPE: {}}}},
)
def bulk_upload_template() -> Response:
    payload = BulkIngestionService.generate_template_xlsx()
    return Response(
        content=payload,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{_TEMPLATE_FILENAME}"'},
    )


@router.get(
    "/{phone_id}",
    response_model=PhoneDetailsResponse,
    summary="Get full detail for a single phone number",
)
def get_phone_detail(
    phone_id: str,
    storage=Depends(get_storage),
) -> PhoneDetailsResponse:
    phone = storage.phones.get(phone_id)
    if phone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"PhoneNumber with id={phone_id} not found.")

    entity = storage.entities.get(phone.entity_id)

    entity_summary = None
    if entity is not None:
        entity_summary = EntitySummary(
            id=entity.id,
            relation_type=entity.relation_type,
            target_entity_id=entity.target_entity_id,
            full_name=entity.full_name,
            identifier_1=entity.identifier_1,
            identifier_2=entity.identifier_2,
        )

    return PhoneDetailsResponse(
        id=phone.id,
        phone_number=phone.phone_number,
        entity_id=phone.entity_id,
        phone_type=phone.phone_type,
        ingestion_source=phone.ingestion_source,
        verification_status=phone.verification_status,
        score=phone.score,
        extra_data=phone.extra_data,
        entity=entity_summary,
    )


# ===========================================================================
# Phase E1 — Bulk text ingestion
# ===========================================================================


class _BulkTextIn(_BaseModel):
    phone_numbers_raw: str
    entity_id: str
    ingestion_source: str = "manual"
    phone_type: Optional[str] = None
    extra_shared: Optional[dict] = None


@router.post(
    "/bulk-text",
    response_model=BulkIngestSummary,
    summary="Bulk-ingest phone numbers under a shared entity",
)
def bulk_text_ingest(
    body: _BulkTextIn,
    current_user: Optional[User] = Depends(get_current_user),
    service: BulkIngestionService = Depends(get_bulk_ingestion_service),
) -> BulkIngestSummary:
    try:
        summary = service.ingest_bulk_text(
            phone_numbers_raw=body.phone_numbers_raw,
            entity_id=body.entity_id,
            ingestion_source=body.ingestion_source,
            phone_type=body.phone_type,
            extra_shared=body.extra_shared,
            uploaded_by_user_id=current_user.id if current_user else None,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    read_model_manager.reload()
    return BulkIngestSummary.model_validate(summary)


# ===========================================================================
# Phase E1-B — Excel / CSV bulk upload
# ===========================================================================

_UPLOAD_MAX_BYTES = 5 * 1024 * 1024


@router.post(
    "/bulk-upload",
    response_model=BulkIngestSummary,
    summary="Bulk-ingest phone numbers from an Excel (.xlsx) or CSV file",
)
async def bulk_upload_ingest(
    file: UploadFile = File(...),
    current_user: Optional[User] = Depends(get_current_user),
    service: BulkIngestionService = Depends(get_bulk_ingestion_service),
) -> BulkIngestSummary:
    file_bytes = await file.read()
    if len(file_bytes) > _UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Uploaded file is {len(file_bytes)} bytes; max allowed is {_UPLOAD_MAX_BYTES}.",
        )
    try:
        summary = service.ingest_bulk_upload(
            file_bytes=file_bytes,
            filename=file.filename or "",
            uploaded_by_user_id=current_user.id if current_user else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    read_model_manager.reload()
    return BulkIngestSummary.model_validate(summary)


# ===========================================================================
# Admin patch / soft-delete / restore for phones
# ===========================================================================


def _phone_to_dict(ph) -> dict:
    return {
        "id":                  ph.id,
        "entity_id":           ph.entity_id,
        "phone_number":        ph.phone_number,
        "phone_type":          ph.phone_type,
        "ingestion_source":    ph.ingestion_source,
        "verification_status": ph.verification_status,
        "score":               ph.score,
        "deleted_at":          ph.deleted_at,
        "extra_data":          ph.extra_data,
    }


class _PhonePatchIn(_BaseModel):
    phone_number:        Optional[str] = _Field(default=None, max_length=40)
    entity_id:           Optional[str] = _Field(default=None)
    phone_type:          Optional[str] = _Field(default=None, max_length=40)
    ingestion_source:    Optional[str] = _Field(default=None, max_length=40)
    verification_status: Optional[str] = _Field(default=None, max_length=40)
    score:               Optional[float] = _Field(default=None)


@router.patch(
    "/{phone_id}/admin",
    summary="Admin edit a phone row",
)
def admin_patch_phone(
    phone_id: str,
    body: _PhonePatchIn,
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ph = admin.patch_phone(
            phone_id,
            phone_number=body.phone_number,
            entity_id=body.entity_id,
            phone_type=body.phone_type,
            ingestion_source=body.ingestion_source,
            verification_status=body.verification_status,
            score=body.score,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    read_model_manager.reload()
    return _phone_to_dict(ph)


@router.delete(
    "/{phone_id}",
    summary="Soft-delete a phone (admin)",
)
def soft_delete_phone(
    phone_id: str,
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ph = admin.soft_delete_phone(phone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    read_model_manager.reload()
    return _phone_to_dict(ph)


@router.post(
    "/{phone_id}/restore",
    summary="Restore a soft-deleted phone (admin)",
)
def restore_phone(
    phone_id: str,
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ph = admin.restore_phone(phone_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    read_model_manager.reload()
    return _phone_to_dict(ph)


# ===========================================================================
# Simplified phone ingestion (quick attach)
# ===========================================================================


class _QuickAttachIn(_BaseModel):
    phone_number: str
    entity_id:    str
    phone_type:   Optional[str] = None


@router.post(
    "/quick",
    summary="Attach a phone to an existing entity",
)
def quick_attach_phone(
    body: _QuickAttachIn,
    current_user: Optional[User] = Depends(get_current_user),
    service: IngestionService = Depends(get_ingestion_service),
) -> dict:
    try:
        ph = service.quick_attach_phone(
            phone_number=body.phone_number,
            entity_id=body.entity_id,
            ingestion_source="manual",
            uploaded_by_user_id=current_user.id if current_user else None,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    read_model_manager.reload()
    return _phone_to_dict(ph)
