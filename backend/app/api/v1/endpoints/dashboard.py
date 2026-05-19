"""
app/api/v1/endpoints/dashboard.py — Domain D: Pipeline Metrics Dashboard.

Endpoint:
    GET /api/v1/dashboard/metrics

Purpose:
    Returns aggregated counts across the PhoneNumber and ActionLog tables
    for the operator and manager dashboard UI (Milestone 9). Provides a
    live snapshot of the pipeline's health without requiring the frontend
    to make multiple requests and aggregate client-side.

NO CACHING:
    All counts are computed at query time — there is no cache layer in the
    open-source implementation. For high-traffic deployments, add a
    materialized view or short-TTL cache in front of this endpoint.
    The internal team can introduce caching transparently without touching
    the router contract.
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select as sa_select
from sqlmodel import Session

from app.schemas.api_contracts import DashboardMetricsResponse
from database import get_session
from models.action_log import ActionLog
from models.phone_number import PhoneNumber

router = APIRouter()


@router.get(
    "/metrics",
    response_model=DashboardMetricsResponse,
    summary="Retrieve aggregated pipeline metrics",
    description=(
        "Returns a live snapshot of key counts across the full pipeline: "
        "phone numbers by verification status, action logs by execution status, "
        "retry queue depth, and count of overdue retries. "
        "All counts reflect the current database state at the time of the request."
    ),
)
def get_dashboard_metrics(
    session: Session = Depends(get_session),
) -> DashboardMetricsResponse:
    """
    Compute and return aggregated pipeline health metrics.

    Runs five targeted aggregate queries:
        1. Total PhoneNumber count.
        2. PhoneNumber count grouped by verification_status.
        3. Total ActionLog count.
        4. ActionLog count grouped by status.
        5. ActionLog count where status='scheduled_retry' (retry queue depth).
        6. ActionLog count where status='scheduled_retry' AND retry_after <= now
           (overdue retries eligible for immediate pickup).

    The grouped counts use dicts with status strings as keys, so new status
    values introduced by internal teams appear automatically in the response
    without any schema change.

    Args:
        session (Session): Injected DB session.

    Returns:
        DashboardMetricsResponse: All aggregated counts as a single typed object.
    """
    # --- 1. Total phones ---
    total_phones: int = session.execute(
        sa_select(func.count(PhoneNumber.id))
    ).scalar_one()

    # --- 2. Phones by verification_status ---
    phone_status_rows = session.execute(
        sa_select(PhoneNumber.verification_status, func.count(PhoneNumber.id))
        .group_by(PhoneNumber.verification_status)
    ).all()
    phones_by_verification_status: dict[str, int] = {
        vstatus: count for vstatus, count in phone_status_rows
    }

    # --- 3. Total actions ---
    total_actions: int = session.execute(
        sa_select(func.count(ActionLog.id))
    ).scalar_one()

    # --- 4. Actions by status ---
    action_status_rows = session.execute(
        sa_select(ActionLog.status, func.count(ActionLog.id))
        .group_by(ActionLog.status)
    ).all()
    actions_by_status: dict[str, int] = {
        astatus: count for astatus, count in action_status_rows
    }

    # --- 5. Retry queue depth (all scheduled_retry rows) ---
    retry_queue_depth: int = session.execute(
        sa_select(func.count(ActionLog.id)).where(
            ActionLog.status == "scheduled_retry"
        )
    ).scalar_one()

    # --- 6. Overdue retries (scheduled_retry + retry_after in the past) ---
    now = datetime.utcnow()
    overdue_retries: int = session.execute(
        sa_select(func.count(ActionLog.id)).where(
            ActionLog.status == "scheduled_retry",
            ActionLog.retry_after <= now,
        )
    ).scalar_one()

    return DashboardMetricsResponse(
        total_phones=total_phones,
        phones_by_verification_status=phones_by_verification_status,
        total_actions=total_actions,
        actions_by_status=actions_by_status,
        retry_queue_depth=retry_queue_depth,
        overdue_retries=overdue_retries,
    )
