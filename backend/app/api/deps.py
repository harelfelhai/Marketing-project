"""
app/api/deps.py — FastAPI dependency providers for the v1 API layer.

Re-exports from root-level `dependencies.py` for router convenience,
plus providers for the task service.
"""

from fastapi import Depends
from sqlmodel import Session

from database import get_session
from dependencies import (  # noqa: F401  (re-exported for router convenience)
    get_auth_service,
    get_bulk_ingestion_service,
    get_client_read_model_service,
    get_current_user,
    get_data_admin_service,
    get_entity_ingestion_service,
    get_event_dispatcher,
    get_export_service,
    get_ingestion_service,
    get_notification_channel,
    get_notification_dispatcher,
    get_notification_subscription_service,
    get_system_settings_service,
    get_user_service,
    require_admin,
    require_authenticated_user,
    get_storage,
)
from services.tasks import PipelineTaskService
from services.verification import VerificationService
from repositories.storage import SqlStorage


# ===========================================================================
# PHASE 3 — VERIFICATION SERVICE
# ===========================================================================


def get_verification_service(
    storage=Depends(get_storage),
) -> VerificationService:
    """
    Compose and return a `VerificationService` for manual verdict submissions.
    """
    return VerificationService(storage=storage)


# ===========================================================================
# PHASE DX — PIPELINE TASK QUEUE
# ===========================================================================


def get_pipeline_task_service(
    storage=Depends(get_storage),
) -> PipelineTaskService:
    """
    Compose and return a `PipelineTaskService` for the /tasks endpoints.
    """
    return PipelineTaskService(storage=storage)
