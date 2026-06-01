"""
dependencies.py — Runtime dependency injection via dynamic module loading.

This is the central wiring point of the entire pipeline's pluggability.
Each `get_*` function is a FastAPI dependency (used via `Depends(...)`) that
resolves and instantiates the correct implementation class at request time.

HOW IT WORKS
------------
1. `config.py` holds a dotted Python module path for each pipeline stage
   (e.g. `INGESTION_MODULE=modules.mock_ingestion`).
2. `_load_class()` calls `importlib.import_module()` with that path and
   retrieves the class by name from the loaded module.
3. The resolved class is instantiated and returned, ready for injection
   into router handlers via FastAPI's `Depends()` mechanism.

HOW TO INJECT AN INTERNAL MODULE
---------------------------------
1. Create a new Python package accessible on the PYTHONPATH of your deployment.
2. Inside it, define a class with the EXACT name listed in each `get_*`
   function below, subclassing the matching abstract interface.
3. Set the corresponding env var to the dotted path of your new module.
4. Restart the application — no other changes needed.

EXPECTED CLASS NAMES BY MODULE
-------------------------------
    INGESTION_MODULE  → class IngestionRoutingEngine(BaseIngestionRoutingEngine)
    DISPATCHER_MODULE → class ActionHandler(BaseActionHandler)
    FEEDBACK_MODULE   → class VerificationStrategy(BaseVerificationStrategy)
    SCORING_MODULE    → class ScoringStrategy(BaseScoringStrategy)  (Phase DY)
"""

import importlib
from typing import Optional

from fastapi import Depends
from sqlmodel import Session

from config import settings
from database import get_session
from interfaces.dispatcher import BaseActionHandler
from interfaces.ingestion import BaseIngestionRoutingEngine
from interfaces.scoring import BaseScoringStrategy
from interfaces.verification import BaseVerificationStrategy
from fastapi import HTTPException, Request, status as http_status

from interfaces.notifications import BaseNotificationChannel
from models.user import User
from services.auth import AuthService
from services.bulk_ingestion import BulkIngestionService
from services.dispatcher import ActionDispatcher
from services.entity_ingestion import EntityIngestionService
from services.export import ExportService
from services.ingestion import IngestionService
from services.notifications import (
    EventDispatcher,
    NotificationDispatcher,
    NotificationSubscriptionService,
)
from services.scoring import ScoringService
from services.system_settings import SystemSettingsService
from services.user import UserService
from services.verification import VerificationEngine, VerificationService


def _load_class(module_path: str, class_name: str):
    """
    Dynamically import a module and retrieve a class from it by name.

    This is the single location where all runtime module swapping happens.
    If the module path or class name is wrong, this will raise a clear
    ImportError or AttributeError at startup/request time.

    Args:
        module_path (str): Dotted Python module path (e.g. "modules.mock_ingestion").
                           Must be importable from the application's PYTHONPATH.
        class_name  (str): The name of the class to retrieve from the module
                           (e.g. "IngestionRoutingEngine").

    Returns:
        type: The class object (not an instance). The caller is responsible
              for instantiating it.

    Raises:
        ModuleNotFoundError: If `module_path` cannot be found on PYTHONPATH.
        AttributeError:      If `class_name` does not exist inside the module.
    """
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


# ===========================================================================
# PHASE 1 — INGESTION
# ===========================================================================

def get_ingestion_routing_engine() -> BaseIngestionRoutingEngine:
    """
    Resolve and return the active IngestionRoutingEngine instance.

    The concrete class is determined by the `INGESTION_MODULE` env var.
    The returned object is guaranteed to implement `BaseIngestionRoutingEngine`.

    Used via:  Depends(get_ingestion_routing_engine)

    HOOK FOR INTERNAL ENGINEERS:
        Set INGESTION_MODULE to your proprietary module path.
        The class inside must be named `IngestionRoutingEngine`
        and must subclass `interfaces.ingestion.BaseIngestionRoutingEngine`.

    Returns:
        BaseIngestionRoutingEngine: Fresh instance of the configured routing class.
    """
    cls = _load_class(settings.ingestion_module, "IngestionRoutingEngine")
    return cls()


def get_ingestion_service(
    session: Session = Depends(get_session),
    routing_engine: BaseIngestionRoutingEngine = Depends(get_ingestion_routing_engine),
) -> IngestionService:
    """
    Compose and return a fully wired `IngestionService` for the current request.

    Injects the DB session, routing engine, action dispatcher, and Phase DY
    scoring service automatically. All sub-dependencies are resolved
    independently by FastAPI.

    The `ActionDispatcher` and `ScoringService` sub-dependencies are
    constructed inline here because they are internal services (not
    pluggable modules) that simply need the current session.

    Args:
        session        (Session):                    Injected per-request DB session.
        routing_engine (BaseIngestionRoutingEngine): Injected routing engine instance.

    Returns:
        IngestionService: A fully initialised ingestion service ready to handle
                          one ingestion request.
    """
    dispatcher = get_action_dispatcher(session)
    scoring_service = get_scoring_service(session)
    return IngestionService(
        session=session,
        routing_engine=routing_engine,
        dispatcher=dispatcher,
        scoring_service=scoring_service,
    )


# ===========================================================================
# PHASE 2 — DISPATCHING
# ===========================================================================

def get_action_handler() -> BaseActionHandler:
    """
    Resolve and return the default action handler instance.

    The concrete class is determined by the `DISPATCHER_MODULE` env var.
    In the open environment, this is a catch-all mock handler. In the internal
    environment, this may be a default handler, or the registry can be
    populated with action-type-specific handlers in `get_action_dispatcher()`.

    HOOK FOR INTERNAL ENGINEERS:
        Set DISPATCHER_MODULE to your proprietary module path.
        The class inside must be named `ActionHandler`
        and must subclass `interfaces.dispatcher.BaseActionHandler`.

    Returns:
        BaseActionHandler: Fresh instance of the configured handler class.
    """
    cls = _load_class(settings.dispatcher_module, "ActionHandler")
    return cls()


def get_action_dispatcher(
    session: Session = Depends(get_session),
) -> ActionDispatcher:
    """
    Compose and return a fully wired `ActionDispatcher` for the current request.

    The handler registry is constructed here. In the open environment, only
    the default catch-all handler is registered. In the internal environment,
    add action-type-specific handlers to the `handlers` dict:

    HOOK FOR INTERNAL ENGINEERS:
        Extend this function to build a rich handler registry:
            handlers = {
                "advertisement_type_a": MyAdHandler(),
                "followup_sms":         MySmsHandler(),
                "retention_call":       MyCallHandler(),
            }
        The `default_handler` serves as a fallback for unregistered types.
        Set it to None to enforce strict action-type registration.

    Args:
        session (Session): Injected per-request DB session.

    Returns:
        ActionDispatcher: Fully wired dispatcher with handler registry.
    """
    default_handler = get_action_handler()

    # INTERNAL HOOK: Replace {} with a populated handler registry.
    # Each key is an action_type token; each value is a BaseActionHandler instance.
    handlers: dict[str, BaseActionHandler] = {}

    return ActionDispatcher(
        session=session,
        handlers=handlers,
        default_handler=default_handler,
        max_retry_count=settings.max_retry_count,
        retry_backoff_seconds=settings.retry_backoff_seconds,
    )


# ===========================================================================
# PHASE 3 — VERIFICATION
# ===========================================================================

def get_verification_strategy() -> BaseVerificationStrategy:
    """
    Resolve and return the active VerificationStrategy instance.

    The concrete class is determined by the `FEEDBACK_MODULE` env var.
    The returned object is guaranteed to implement `BaseVerificationStrategy`.

    HOOK FOR INTERNAL ENGINEERS:
        Set FEEDBACK_MODULE to your proprietary module path.
        The class inside must be named `VerificationStrategy`
        and must subclass `interfaces.verification.BaseVerificationStrategy`.

    Returns:
        BaseVerificationStrategy: Fresh instance of the configured strategy class.
    """
    cls = _load_class(settings.feedback_module, "VerificationStrategy")
    return cls()


def get_verification_engine(
    session: Session = Depends(get_session),
    strategy: BaseVerificationStrategy = Depends(get_verification_strategy),
) -> VerificationEngine:
    """
    Compose and return a fully wired `VerificationEngine`.

    Used by the APScheduler background job in `workers/scheduler.py`
    (called directly, not via FastAPI Depends).

    Args:
        session  (Session):                   Injected per-request DB session.
        strategy (BaseVerificationStrategy):  Injected verification strategy.

    Returns:
        VerificationEngine: Fully wired engine ready to run `process_eligible_numbers()`.
    """
    # The VerificationEngine writes verdicts in batch (no scoring hook
    # here yet — scoring on engine batches is a Phase DY-2 add). For the
    # synchronous manual-verdict path that uses `get_verification_service`,
    # scoring IS wired in `app/api/deps.py`.
    verification_service = VerificationService(session=session)
    return VerificationEngine(
        session=session,
        strategy=strategy,
        verification_service=verification_service,
        verification_window_days=settings.verification_window_days,
    )


# ===========================================================================
# PHASE DY — SCORING
# ===========================================================================


def get_scoring_strategy() -> BaseScoringStrategy:
    """
    Resolve and return the active `ScoringStrategy` instance.

    The concrete class is determined by the `SCORING_MODULE` env var
    (default: `modules.mock_scoring`). The returned object is guaranteed
    to implement `BaseScoringStrategy`.

    HOOK FOR INTERNAL ENGINEERS:
        Set SCORING_MODULE to your proprietary module path.
        The class inside must be named `ScoringStrategy` and must
        subclass `interfaces.scoring.BaseScoringStrategy`.

    Returns:
        BaseScoringStrategy: Fresh instance of the configured scoring class.
    """
    cls = _load_class(settings.scoring_module, "ScoringStrategy")
    return cls()


def get_scoring_service(
    session: Session = Depends(get_session),
    strategy: BaseScoringStrategy = Depends(get_scoring_strategy),
) -> ScoringService:
    """
    Compose and return a fully wired `ScoringService` for the current request.

    Args:
        session  (Session):              Per-request DB session.
        strategy (BaseScoringStrategy):  Injected scoring strategy.

    Returns:
        ScoringService: Ready to recalculate any phone's priority score.
    """
    return ScoringService(session=session, strategy=strategy)


# ===========================================================================
# PHASE NOTIF — CHAT NOTIFICATIONS
# ===========================================================================


def get_notification_channel() -> BaseNotificationChannel:
    """
    Resolve and return the active NotificationChannel instance.

    The concrete class is determined by the `NOTIFICATION_MODULE` env
    var (default: `modules.mock_chat`). The returned object is
    guaranteed to implement `BaseNotificationChannel`.

    HOOK FOR INTERNAL ENGINEERS:
        Set NOTIFICATION_MODULE to your proprietary module path.
        The class inside must be named `NotificationChannel` and
        must subclass `interfaces.notifications.BaseNotificationChannel`.

    Returns:
        BaseNotificationChannel: Fresh instance of the configured class.
    """
    cls = _load_class(settings.notification_module, "NotificationChannel")
    return cls()


def get_notification_dispatcher(
    session: Session = Depends(get_session),
    channel: BaseNotificationChannel = Depends(get_notification_channel),
) -> NotificationDispatcher:
    """
    Compose and return a `NotificationDispatcher` for the current
    request. Holds the per-request session + the configured channel.
    """
    return NotificationDispatcher(session=session, channel=channel)


def get_notification_subscription_service(
    session: Session = Depends(get_session),
) -> NotificationSubscriptionService:
    """
    Compose and return a `NotificationSubscriptionService`. CRUD-only;
    no chat-channel dependency.
    """
    return NotificationSubscriptionService(session=session)


def get_event_dispatcher(
    session: Session = Depends(get_session),
    dispatcher: NotificationDispatcher = Depends(get_notification_dispatcher),
) -> EventDispatcher:
    """
    Compose and return an `EventDispatcher` — the trigger seam business
    code calls into. Wraps subscription lookup + template rendering +
    fan-out via NotificationDispatcher.

    Future business services (IngestionService, VerificationService,
    PipelineTaskService) will accept this as an optional constructor
    arg and call `.fire(event_type, ...)` at their commit points.
    """
    return EventDispatcher(session=session, dispatcher=dispatcher)


# ===========================================================================
# PHASE EXP — TABLE EXPORT
# ===========================================================================


def get_export_service(
    session: Session = Depends(get_session),
) -> ExportService:
    """
    Compose and return an `ExportService` for the current request.

    The service is read-only — no scoring / dispatcher / routing
    dependencies needed; just the per-request DB session.

    Args:
        session (Session): Per-request DB session.

    Returns:
        ExportService: Ready to handle one phones/tasks export.
    """
    return ExportService(session=session)


# ===========================================================================
# PHASE E2 — ENTITY INGESTION
# ===========================================================================


def get_entity_ingestion_service(
    session: Session = Depends(get_session),
) -> EntityIngestionService:
    """
    Compose and return a fully wired `EntityIngestionService`.

    The entity-centric ingestion path creates Entity rows standalone
    (no phone, no scoring hook, no routing engine). The service therefore
    needs only the per-request session — no other sub-dependencies.

    Args:
        session (Session): Per-request DB session.

    Returns:
        EntityIngestionService: Ready to mint one Entity row.
    """
    return EntityIngestionService(session=session)


def get_storage(
    session: Session = Depends(get_session),
):
    """
    Per-request `Storage` bundle — one Repository per aggregate, all wired
    to the currently active storage backend. Services that have been
    migrated to the repository seam depend on this rather than on the raw
    Session, so the SQL→Mongo switch flows through here.

    Today the SQL backend is the only available one (System Settings tab
    surfaces 'mongo' as a known-but-unavailable option). The Mongo branch
    is added once its connection / index management lands.
    """
    from repositories.storage import SqlStorage
    return SqlStorage(session)


def get_data_admin_service(
    storage=Depends(get_storage),
):
    """
    UAT round-3: per-request DataAdminService for edit + soft-delete of
    Entity and PhoneNumber rows. Wired through the Storage seam so it runs
    identically on SQL and Mongo.
    """
    # Local import to avoid an import-time cycle with services/__init__.
    from services.data_admin import DataAdminService
    return DataAdminService(storage=storage)


# ===========================================================================
# PHASE E1 — BULK INGESTION
# ===========================================================================


def get_bulk_ingestion_service(
    session: Session = Depends(get_session),
) -> BulkIngestionService:
    """
    Compose and return a fully wired `BulkIngestionService`.

    The scoring service is composed inline (not via FastAPI Depends)
    because it shares the same per-request session — using two separate
    Depends() resolutions would risk inconsistent transaction scopes.

    Args:
        session (Session): Per-request DB session.

    Returns:
        BulkIngestionService: Ready to ingest one bulk-text submission.
    """
    scoring_service = get_scoring_service(session)
    return BulkIngestionService(
        session=session,
        scoring_service=scoring_service,
    )


# ===========================================================================
# PHASE AUTH — authentication + role-gating dependencies
# ===========================================================================
#
# Three layered deps:
#
#   get_current_user            → User | None    (no error on absence)
#   require_authenticated_user  → User           (401 when absent)
#   require_admin               → User           (403 when not admin)
#
# Endpoint handlers compose them via the standard FastAPI Depends()
# chain. The `require_admin` dep is the guardrail wired onto the
# Task Center surface (/tasks read + resolve + bulk-status + export).


def get_auth_service(
    session: Session = Depends(get_session),
) -> AuthService:
    """
    Compose an `AuthService` for the current request. Used by the
    login / logout endpoints AND internally by the get_current_user
    dep below.
    """
    return AuthService(session=session)


def get_user_service(
    session: Session = Depends(get_session),
) -> UserService:
    """
    Compose a `UserService` for CRUD over the user table. Used by
    the registration + /auth/me PATCH endpoints.
    """
    return UserService(session=session)


def get_system_settings_service() -> SystemSettingsService:
    """
    Compose a `SystemSettingsService` bound to the configured on-disk
    settings file. No DB session — settings live outside the database
    on purpose (the storage_backend value selects which DB is active).
    Used by the admin-only System Settings endpoints.
    """
    return SystemSettingsService(path=settings.system_settings_path)


def get_current_user(
    request: Request,
    auth: AuthService = Depends(get_auth_service),
) -> Optional[User]:
    """
    Resolve the request's `marketing_session` cookie to the owning
    User row. Returns None when:
        - the cookie is missing (guest / not logged in)
        - the cookie value doesn't match a session row (revoked)
        - the user row is missing or `active=False`

    Never raises. Endpoints that want to enforce auth use the
    `require_authenticated_user` / `require_admin` wrappers below;
    endpoints that want soft-personalization (e.g., list endpoints
    that adapt their default filter when a user is logged in) read
    this directly.

    Args:
        request (Request):       FastAPI Request, for cookie access.
        auth    (AuthService):   Injected.

    Returns:
        Optional[User]: The authenticated user, or None.
    """
    token = request.cookies.get(AuthService.COOKIE_NAME)
    return auth.session_user(token)


def require_authenticated_user(
    user: Optional[User] = Depends(get_current_user),
) -> User:
    """
    Reject the request with 401 when no valid session is present.
    Use for endpoints that require ANY logged-in user (admin OR
    regular) — distinguished from the open-to-all endpoints which
    use `get_current_user` directly.
    """
    if user is None:
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return user


def require_admin(
    user: User = Depends(require_authenticated_user),
) -> User:
    """
    Reject the request with 403 when the current user isn't an
    admin. Wired onto every Task Center endpoint to enforce the
    Phase AUTH guardrail.

    The 403 message is deliberately friendly (this is a guardrail,
    not a security wall): operators landing here by accident see a
    clear "Admins only" toast rather than a generic forbidden.
    """
    if user.role != "admin":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Admins only — this action is restricted to the Task Center role.",
        )
    return user
