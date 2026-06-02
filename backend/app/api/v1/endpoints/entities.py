"""
app/api/v1/endpoints/entities.py — Phase E2: Entity Ingestion Channels.

Endpoints:
    POST /api/v1/entities                — Single-entry (E2-A)
    POST /api/v1/entities/bulk-text      — Bulk-text grid (E2-B)
    POST /api/v1/entities/bulk-upload    — Excel/CSV upload (E2-B)
    GET  /api/v1/entities/bulk-template  — Template download
    GET  /api/v1/entities                — List entities
    GET  /api/v1/entities/{entity_id}    — Fetch single entity
    PATCH /api/v1/entities/{entity_id}   — Edit entity
    DELETE /api/v1/entities/{entity_id}  — Soft-delete entity
    POST /api/v1/entities/{entity_id}/restore — Restore entity
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.api.deps import (
    get_current_user,
    get_data_admin_service,
    get_entity_ingestion_service,
    require_admin,
)
from app.schemas.api_contracts import BulkIngestSummary
from exceptions import TargetNotFoundError
from models.user import User
from schemas.entity_ingestion import (
    EntityBulkTextIn,
    EntitySingleCreateIn,
    EntitySingleCreateOut,
)
from services.data_admin import DataAdminService
from services.entity_ingestion import EntityIngestionService
from services.read_model.manager import read_model_manager
from models.types import SOFT_DELETE_SENTINEL

router = APIRouter()


_TEMPLATE_FILENAME = "bulk_entities_template.xlsx"
_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

_UPLOAD_MAX_BYTES = 5 * 1024 * 1024


@router.get(
    "/bulk-template",
    summary="Download the Excel entity-upload template",
    responses={200: {"content": {_XLSX_MEDIA_TYPE: {}}}},
)
def bulk_upload_template(
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> Response:
    payload = service.generate_template_xlsx()
    return Response(
        content=payload,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{_TEMPLATE_FILENAME}"'},
    )


@router.post(
    "",
    response_model=EntitySingleCreateOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a single named Entity",
)
def create_single_entity(
    payload: EntitySingleCreateIn,
    current_user: Optional[User] = Depends(get_current_user),
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> EntitySingleCreateOut:
    try:
        new_entity = service.create_single(
            relation_type=payload.relation_type.value if hasattr(payload.relation_type, 'value') else payload.relation_type,
            target_entity_id=payload.target_entity_id,
            identifier_1=getattr(payload, 'identifier_1', None),
            identifier_2=getattr(payload, 'identifier_2', None),
            full_name=getattr(payload, 'full_name', None),
            extra_data=payload.extra_data,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    read_model_manager.reload()
    return EntitySingleCreateOut(
        id=new_entity.id,
        relation_type=new_entity.relation_type,
        target_entity_id=new_entity.target_entity_id,
        full_name=new_entity.full_name,
        identifier_1=new_entity.identifier_1,
        identifier_2=new_entity.identifier_2,
    )


@router.post(
    "/bulk-text",
    response_model=BulkIngestSummary,
    summary="Bulk-create Entity rows from an inline grid",
)
def bulk_text_ingest(
    body: EntityBulkTextIn,
    current_user: Optional[User] = Depends(get_current_user),
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> BulkIngestSummary:
    rows = [
        {
            "row_token":        r.row_token,
            "relation_type":    r.relation_type.value if hasattr(r.relation_type, 'value') and r.relation_type else None,
            "target_entity_id": r.target_entity_id,
            "full_name":        getattr(r, 'full_name', None),
            "identifier_1":     getattr(r, 'identifier_1', None),
            "identifier_2":     getattr(r, 'identifier_2', None),
        }
        for r in body.rows
    ]
    try:
        summary = service.ingest_bulk_text(
            rows=rows,
            default_relation_type=body.default_relation_type.value if hasattr(body.default_relation_type, 'value') else body.default_relation_type,
            default_target_entity_id=body.default_target_entity_id,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    read_model_manager.reload()
    return BulkIngestSummary.model_validate(summary)


@router.post(
    "/bulk-upload",
    response_model=BulkIngestSummary,
    summary="Bulk-create Entity rows from an Excel (.xlsx) or CSV file",
)
async def bulk_upload_ingest(
    file: UploadFile = File(...),
    current_user: Optional[User] = Depends(get_current_user),
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
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
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    read_model_manager.reload()
    return BulkIngestSummary.model_validate(summary)


# ===========================================================================
# Admin CRUD (view list / patch / soft-delete / restore)
# ===========================================================================


def _entity_to_dict(ent) -> dict:
    return {
        "id":               ent.id,
        "relation_type":    ent.relation_type,
        "target_entity_id": ent.target_entity_id,
        "full_name":        ent.full_name,
        "identifier_1":     ent.identifier_1,
        "identifier_2":     ent.identifier_2,
        "extra_data":       ent.extra_data,
        "deleted_at":       ent.deleted_at,
    }


class EntityPatchIn(BaseModel):
    """Partial update body. Only non-None fields are applied."""
    full_name:        Optional[str] = Field(default=None, max_length=200)
    identifier_1:     Optional[str] = Field(default=None, max_length=200)
    identifier_2:     Optional[str] = Field(default=None, max_length=200)
    relation_type:    Optional[str] = Field(default=None, max_length=40)
    target_entity_id: Optional[str] = None


@router.get(
    "",
    summary="List entities for the View tab and admin tools",
)
def list_entities(
    target_entity_id: Optional[str] = Query(default=None),
    client_ids: Optional[List[str]] = Query(default=None),
    include_deleted: bool = Query(default=False),
    q: Optional[str] = Query(default=None),
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    """
    Fast path (production): served from the in-memory ReadModelStore.
    Fallback path (tests / startup failure): one DB query via DataAdminService.

    `client_ids` scopes results to specific clients (used by the "My Data"
    personalization view). An entity's client is its root: a member's
    target_entity_id, or — for a root entity — its own id.
    """
    mgr = read_model_manager
    if mgr.started:
        # ── Memory path ──────────────────────────────────────────────
        rows = list(mgr.store.all_entities)
        if not include_deleted:
            rows = [e for e in rows if e.deleted_at == SOFT_DELETE_SENTINEL]
        if target_entity_id is not None:
            rows = [e for e in rows if e.target_entity_id == target_entity_id]
        if q:
            needle = q.strip().lower()
            def _hay(e) -> str:
                return " ".join(filter(None, [
                    e.full_name or "", e.identifier_1 or "",
                    e.identifier_2 or "", e.id,
                ])).lower()
            rows = [e for e in rows if needle in _hay(e)]
        rows.sort(key=lambda e: e.id, reverse=True)
    else:
        # ── DB fallback ───────────────────────────────────────────────
        rows = admin.list_entities(
            target_entity_id=target_entity_id,
            include_deleted=include_deleted,
            q=q,
        )

    # Client scoping applies to both paths. Derive each entity's client id
    # (root = its own id; member = target_entity_id) and keep only matches.
    if client_ids:
        allowed = set(client_ids)
        rows = [e for e in rows if (e.target_entity_id or e.id) in allowed]

    return {"items": [_entity_to_dict(r) for r in rows], "total": len(rows)}


@router.get(
    "/{entity_id}",
    summary="Fetch a single entity by id",
)
def get_entity(
    entity_id: str,
    include_deleted: bool = Query(default=False),
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ent = admin.get_entity(entity_id, include_deleted=include_deleted)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _entity_to_dict(ent)


@router.patch(
    "/{entity_id}",
    summary="Edit an entity (admin)",
)
def patch_entity(
    entity_id: str,
    body: EntityPatchIn,
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        ent = admin.patch_entity(
            entity_id,
            full_name=body.full_name,
            identifier_1=body.identifier_1,
            identifier_2=body.identifier_2,
            relation_type=body.relation_type,
            target_entity_id=body.target_entity_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    read_model_manager.reload()
    return _entity_to_dict(ent)


@router.delete(
    "/{entity_id}",
    summary="Soft-delete an entity (admin) — cascades to its phones and tasks",
)
def soft_delete_entity(
    entity_id: str,
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        result = admin.soft_delete_entity(entity_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    read_model_manager.reload()
    return result


@router.post(
    "/{entity_id}/restore",
    summary="Restore a soft-deleted entity — symmetric cascade revival",
)
def restore_entity(
    entity_id: str,
    admin: DataAdminService = Depends(get_data_admin_service),
) -> dict:
    try:
        result = admin.restore_entity(entity_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    read_model_manager.reload()
    return result
