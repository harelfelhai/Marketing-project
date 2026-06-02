"""
dependencies.py — Runtime dependency injection.

Central wiring point. Each `get_*` function is a FastAPI dependency
(used via `Depends(...)`) that resolves and instantiates the correct
implementation class at request time.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request, status as http_status
from sqlmodel import Session

from config import settings
from database import get_session
from interfaces.notifications import BaseNotificationChannel
from models.user import User
from services.auth import AuthService
from services.bulk_ingestion import BulkIngestionService
from services.entity_ingestion import EntityIngestionService
from services.export import ExportService
from services.ingestion import IngestionService
from services.notifications import (
    EventDispatcher,
    NotificationDispatcher,
    NotificationSubscriptionService,
)
from services.system_settings import SystemSettingsService
from services.user import UserService
from services.verification import VerificationService
from repositories.storage import SqlStorage

import importlib


def _load_class(module_path: str, class_name: str):
    """
    Dynamically import a module and retrieve a class from it by name.
    """
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


# ===========================================================================
# PHASE NOTIF — CHAT NOTIFICATIONS
# ===========================================================================


def get_notification_channel() -> BaseNotificationChannel:
    """
    Resolve and return the active NotificationChannel instance.

    The concrete class is determined by the `NOTIFICATION_MODULE` env var.
    """
    cls = _load_class(settings.notification_module, "NotificationChannel")
    return cls()


def get_notification_dispatcher(
    session: Session = Depends(get_session),
    channel: BaseNotificationChannel = Depends(get_notification_channel),
) -> NotificationDispatcher:
    """Compose and return a `NotificationDispatcher` for the current request."""
    return NotificationDispatcher(storage=SqlStorage(session), channel=channel)


def get_notification_subscription_service(
    session: Session = Depends(get_session),
) -> NotificationSubscriptionService:
    """Compose and return a `NotificationSubscriptionService`."""
    return NotificationSubscriptionService(storage=SqlStorage(session))


def get_event_dispatcher(
    session: Session = Depends(get_session),
    dispatcher: NotificationDispatcher = Depends(get_notification_dispatcher),
) -> EventDispatcher:
    """Compose and return an `EventDispatcher`."""
    return EventDispatcher(storage=SqlStorage(session), dispatcher=dispatcher)


# ===========================================================================
# PHASE EXP — TABLE EXPORT
# ===========================================================================


def get_export_service(
    session: Session = Depends(get_session),
) -> ExportService:
    """Compose and return an `ExportService` for the current request."""
    return ExportService(storage=SqlStorage(session))


# ===========================================================================
# PHASE E2 — ENTITY INGESTION
# ===========================================================================


def get_entity_ingestion_service(
    session: Session = Depends(get_session),
) -> EntityIngestionService:
    """Compose and return a fully wired `EntityIngestionService`."""
    return EntityIngestionService(storage=SqlStorage(session))


# Process-wide cache of the active backend.
_active_storage_backend: Optional[str] = None


def _resolve_storage_backend() -> str:
    """Return (and cache) the storage backend selected in System Settings."""
    global _active_storage_backend
    if _active_storage_backend is None:
        from services.system_settings import SystemSettingsService
        _active_storage_backend = SystemSettingsService(
            path=settings.system_settings_path
        ).get()["storage_backend"]
    return _active_storage_backend


def get_storage(
    session: Session = Depends(get_session),
):
    """
    Per-request `Storage` bundle — one Repository per aggregate, wired to the
    currently active storage backend.
    """
    from repositories.storage import MongoStorage, SqlStorage

    if _resolve_storage_backend() == "mongo":
        from repositories.mongo_connection import get_mongo_database
        return MongoStorage(get_mongo_database())
    return SqlStorage(session)


def get_client_read_model_service(
    storage=Depends(get_storage),
):
    """Per-request `ClientReadModelService`."""
    from services.read_models import ClientReadModelService
    return ClientReadModelService(storage=storage)


def get_data_admin_service(
    storage=Depends(get_storage),
):
    """Per-request DataAdminService for edit + soft-delete of Entity and PhoneNumber rows."""
    from services.data_admin import DataAdminService
    return DataAdminService(storage=storage)


# ===========================================================================
# PHASE E1 — BULK INGESTION
# ===========================================================================


def get_bulk_ingestion_service(
    storage=Depends(get_storage),
) -> BulkIngestionService:
    """Compose and return a fully wired `BulkIngestionService`."""
    return BulkIngestionService(storage=storage)


# ===========================================================================
# INGESTION SERVICE
# ===========================================================================


def get_ingestion_service(
    storage=Depends(get_storage),
) -> IngestionService:
    """Compose and return a fully wired `IngestionService`."""
    return IngestionService(storage=storage)


# ===========================================================================
# PHASE AUTH — authentication + role-gating dependencies
# ===========================================================================


def get_auth_service(
    storage=Depends(get_storage),
) -> AuthService:
    """Compose an `AuthService` for the current request."""
    return AuthService(storage=storage)


def get_user_service(
    storage=Depends(get_storage),
) -> UserService:
    """Compose a `UserService` for CRUD over the user aggregate."""
    return UserService(storage=storage)


def get_system_settings_service() -> SystemSettingsService:
    """Compose a `SystemSettingsService` bound to the configured on-disk settings file."""
    return SystemSettingsService(path=settings.system_settings_path)


def get_current_user(
    request: Request,
    auth: AuthService = Depends(get_auth_service),
) -> Optional[User]:
    """Resolve the request's session cookie to the owning User row."""
    token = request.cookies.get(AuthService.COOKIE_NAME)
    return auth.session_user(token)


def require_authenticated_user(
    user: Optional[User] = Depends(get_current_user),
) -> User:
    """Reject the request with 401 when no valid session is present."""
    if user is None:
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return user


def require_admin(
    user: User = Depends(require_authenticated_user),
) -> User:
    """Reject the request with 403 when the current user isn't an admin."""
    if user.role != "admin":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Admins only — this action is restricted to the Task Center role.",
        )
    return user
