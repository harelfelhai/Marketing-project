"""
app/api/v1/endpoints/system.py — Domain D: System Settings & Controls.

Endpoints:
    GET  /api/v1/system/settings                    — Read system settings
    PUT  /api/v1/system/settings                    — Update storage backend
    PUT  /api/v1/system/settings/display-fields     — Set visible fields for a surface
    PUT  /api/v1/system/settings/display-labels      — Override column labels for a surface
    PUT  /api/v1/system/settings/filter-fields      — Set active filters for a surface
    PUT  /api/v1/system/settings/custom-filters     — Set admin-defined custom filters
    PUT  /api/v1/system/settings/ingestion-fields   — Set admin-defined dynamic ingestion fields
    PUT  /api/v1/system/settings/mongo-url          — Configure MongoDB URL
    GET  /api/v1/system/settings/vocabulary/{name}  — Get vocabulary list
    PUT  /api/v1/system/settings/vocabulary/{name}  — Update vocabulary list
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import (
    get_system_settings_service,
    require_admin,
)
from app.schemas.api_contracts import (
    CustomFiltersUpdate,
    DisplayFieldsUpdate,
    DisplayLabelsUpdate,
    FilterFieldsUpdate,
    IngestionFieldsUpdate,
    MongoUrlUpdate,
    SystemSettingsResponse,
    SystemSettingsUpdate,
    VocabularyResponse,
    VocabularyUpdate,
)
from models.user import User
from services.system_settings import SystemSettingsService

router = APIRouter()


# ---------------------------------------------------------------------------
# System Settings — admin-only infrastructure controls
# ---------------------------------------------------------------------------


@router.get(
    "/settings",
    response_model=SystemSettingsResponse,
    summary="Read the operator-editable system settings",
)
def get_system_settings(
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    return SystemSettingsResponse(**svc.get())


@router.put(
    "/settings",
    response_model=SystemSettingsResponse,
    summary="Update the system settings (e.g. switch storage backend)",
)
def update_system_settings(
    body: SystemSettingsUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_storage_backend(body.storage_backend))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put(
    "/settings/display-fields",
    response_model=SystemSettingsResponse,
    summary="Set which fields a surface displays",
)
def update_display_fields(
    body: DisplayFieldsUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_display_fields(body.surface, body.fields))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put(
    "/settings/display-labels",
    response_model=SystemSettingsResponse,
    summary="Override the column labels a surface displays",
)
def update_display_labels(
    body: DisplayLabelsUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_display_labels(body.surface, body.labels))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put(
    "/settings/filter-fields",
    response_model=SystemSettingsResponse,
    summary="Set which filters are active on a surface",
)
def update_filter_fields(
    body: FilterFieldsUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_filter_fields(body.surface, body.fields))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put(
    "/settings/custom-filters",
    response_model=SystemSettingsResponse,
    summary="Set the admin-defined custom filters for a surface",
)
def update_custom_filters(
    body: CustomFiltersUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_custom_filters(body.surface, body.filters))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put(
    "/settings/ingestion-fields",
    response_model=SystemSettingsResponse,
    summary="Set the admin-defined dynamic ingestion fields for a surface",
)
def update_ingestion_fields(
    body: IngestionFieldsUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_ingestion_fields(body.surface, body.fields))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.put(
    "/settings/mongo-url",
    response_model=SystemSettingsResponse,
    summary="Configure the MongoDB connection URL",
)
def update_mongo_url(
    body: MongoUrlUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> SystemSettingsResponse:
    try:
        return SystemSettingsResponse(**svc.set_mongo_url(body.url))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))


@router.get(
    "/settings/vocabulary/{name}",
    response_model=VocabularyResponse,
    summary="Get a vocabulary list by name",
    description=(
        "Returns the current list for one of the operator-editable vocabularies: "
        "'relation_types', 'phone_types', or 'task_types'."
    ),
)
def get_vocabulary(
    name: str,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> VocabularyResponse:
    try:
        items = svc.get_vocabulary(name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return VocabularyResponse(name=name, items=items)


@router.put(
    "/settings/vocabulary/{name}",
    response_model=VocabularyResponse,
    summary="Update a vocabulary list",
    description=(
        "Persists a new list for one of the operator-editable vocabularies: "
        "'relation_types', 'phone_types', or 'task_types'."
    ),
)
def update_vocabulary(
    name: str,
    body: VocabularyUpdate,
    _admin: User = Depends(require_admin),
    svc: SystemSettingsService = Depends(get_system_settings_service),
) -> VocabularyResponse:
    try:
        svc.set_vocabulary(name, body.items)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return VocabularyResponse(name=name, items=svc.get_vocabulary(name))
