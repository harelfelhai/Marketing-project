"""
app/api/deps.py — FastAPI dependency providers for the v1 API layer.

This module extends the root-level `dependencies.py` (which handles the three
injectable ABC-backed services) with additional providers for the read/query
and recovery services introduced in Milestone 4.

DESIGN PRINCIPLE
----------------
Every function here is a FastAPI dependency (called via `Depends(...)`).
None of them contain business logic — they only compose already-built service
objects from the service layer and hand them to router handlers.

HOOK LOCATIONS
--------------
Each `get_*` function that wraps a service with tunable behaviour carries a
`# HOOK FOR INTERNAL ENGINEERS` comment indicating what to configure for
production deployments.
"""

from fastapi import Depends
from sqlmodel import Session

# Re-export the Phase 1/2/3 ABC-backed dependencies unchanged.
# Router modules can import everything from this single module.
from database import get_session
from dependencies import (  # noqa: F401  (re-exported for router convenience)
    get_action_dispatcher,
    get_bulk_ingestion_service,
    get_ingestion_service,
    get_scoring_service,
    get_verification_engine,
)
from services.dispatcher import (
    ActionDataTriggerService,
    ActionDispatcher,
    RetryEngine,
    UserActionService,
)
from services.scoring import ScoringService
from services.tasks import PipelineTaskService
from services.verification import VerificationService


# ===========================================================================
# PHASE 2 — ADDITIONAL DISPATCHER SERVICES
# ===========================================================================


def get_user_action_service(
    session: Session = Depends(get_session),
    dispatcher: ActionDispatcher = Depends(get_action_dispatcher),
) -> UserActionService:
    """
    Compose and return a `UserActionService` for operator-triggered actions.

    Wraps `ActionDispatcher` with operator-attribution logic: the `operator_id`
    is stamped into `ActionLog.extra_data` atomically alongside the dispatch
    result, so the audit trail is never incomplete.

    HOOK FOR INTERNAL ENGINEERS:
        Add permission checks, quota limits, or approval-workflow integrations
        in `UserActionService.trigger_manual_action()` before creating the
        ActionLog row. This is the correct enforcement layer for operator policy.

    Args:
        session    (Session):          Per-request DB session.
        dispatcher (ActionDispatcher): Fully wired dispatcher (from get_action_dispatcher).

    Returns:
        UserActionService: Ready to handle one operator trigger request.
    """
    return UserActionService(session=session, dispatcher=dispatcher)


def get_action_data_trigger_service(
    session: Session = Depends(get_session),
    dispatcher: ActionDispatcher = Depends(get_action_dispatcher),
) -> ActionDataTriggerService:
    """
    Compose and return an `ActionDataTriggerService` for PATCH-driven recovery.

    Called after a PATCH /phones/{id} update to evaluate whether the changed
    fields should trigger a re-dispatch of a previously failed action.

    HOOK FOR INTERNAL ENGINEERS:
        Set `trigger_fields` to a specific allowlist of field names that should
        activate re-dispatch. For example, if a data fix to `classification_type`
        is the only correction that should trigger a retry:
            return ActionDataTriggerService(
                session=session,
                dispatcher=dispatcher,
                trigger_fields={"classification_type"},
            )
        Leaving `trigger_fields` as None (open-environment default) means ANY
        field update triggers re-dispatch when a failed action exists — safe
        for development but too permissive for production.

    Args:
        session    (Session):          Per-request DB session.
        dispatcher (ActionDispatcher): Fully wired dispatcher.

    Returns:
        ActionDataTriggerService: Ready to evaluate one data-change event.
    """
    # HOOK FOR INTERNAL ENGINEERS: Replace None with your trigger_fields set.
    return ActionDataTriggerService(
        session=session,
        dispatcher=dispatcher,
        trigger_fields=None,
    )


def get_retry_engine(
    session: Session = Depends(get_session),
    dispatcher: ActionDispatcher = Depends(get_action_dispatcher),
) -> RetryEngine:
    """
    Compose and return a `RetryEngine` for the system-control worker endpoint.

    The RetryEngine is normally driven by the APScheduler background job.
    This dependency makes it available to the `POST /system/workers/run`
    endpoint so an administrator can trigger an immediate flush of the retry
    queue (e.g. after an external vendor outage is resolved).

    Args:
        session    (Session):          Per-request DB session.
        dispatcher (ActionDispatcher): Fully wired dispatcher.

    Returns:
        RetryEngine: Ready to run one `process_scheduled_retries()` tick.
    """
    return RetryEngine(session=session, dispatcher=dispatcher)


# ===========================================================================
# PHASE 3 — VERIFICATION SERVICE (read/write layer for manual verdicts)
# ===========================================================================


def get_verification_service(
    session: Session = Depends(get_session),
    scoring_service: ScoringService = Depends(get_scoring_service),
) -> VerificationService:
    """
    Compose and return a `VerificationService` for manual verdict submissions.

    The VerificationService is the single authoritative writer to the Phase 3
    block of the PhoneNumber table. Using it in the manual verdict endpoint
    ensures that human and automated verdicts follow the same atomic write path.

    Phase DY composition: the injected `ScoringService` ensures that every
    successful verdict triggers a priority recalculation in the SAME
    transaction as the verdict write, so verdict + priority land
    atomically (no race between separate commits).

    Args:
        session         (Session):         Per-request DB session.
        scoring_service (ScoringService):  Phase DY scoring hook.

    Returns:
        VerificationService: Ready to write one verification verdict +
        recompute priority atomically.
    """
    return VerificationService(session=session, scoring_service=scoring_service)


# ===========================================================================
# PHASE DX — PIPELINE TASK QUEUE
# ===========================================================================


def get_pipeline_task_service(
    session: Session = Depends(get_session),
) -> PipelineTaskService:
    """
    Compose and return a `PipelineTaskService` for the four /tasks endpoints.

    The PipelineTaskService is the single authoritative writer to the
    `pipeline_task` table and the canonical owner of the JOIN with
    PhoneNumber + Entity used by the read endpoints.

    // HOOK FOR ENTERPRISE AUTH — when Phase G activates, this dependency
    // will be composed with a `get_current_operator` dependency that
    // replaces the request-body `operator_id` on /tasks/{id}/resolve.

    Args:
        session (Session): Per-request DB session.

    Returns:
        PipelineTaskService: Ready to open / resolve / list / fetch tasks.
    """
    return PipelineTaskService(session=session)
