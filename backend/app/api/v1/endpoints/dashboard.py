"""
app/api/v1/endpoints/dashboard.py — Domain D: Pipeline Metrics Dashboard.

Endpoint:
    GET /api/v1/dashboard/metrics
"""

from fastapi import APIRouter, Depends

from app.schemas.api_contracts import DashboardMetricsResponse
from models.types import SOFT_DELETE_SENTINEL
from dependencies import get_storage

router = APIRouter()


@router.get(
    "/metrics",
    response_model=DashboardMetricsResponse,
    summary="Retrieve aggregated pipeline metrics",
)
def get_dashboard_metrics(
    storage=Depends(get_storage),
) -> DashboardMetricsResponse:
    """
    Compute and return aggregated pipeline health metrics.
    """
    # Active phones
    all_phones = storage.phones.list({"deleted_at": SOFT_DELETE_SENTINEL})
    total_phones = len(all_phones)

    phones_by_vs: dict[str, int] = {}
    for phone in all_phones:
        vs = phone.verification_status
        phones_by_vs[vs] = phones_by_vs.get(vs, 0) + 1

    # Active tasks
    all_tasks = storage.tasks.list({"deleted_at": SOFT_DELETE_SENTINEL})
    total_tasks = len(all_tasks)

    tasks_by_status: dict[str, int] = {}
    for task in all_tasks:
        s = task.status
        tasks_by_status[s] = tasks_by_status.get(s, 0) + 1

    return DashboardMetricsResponse(
        total_phones=total_phones,
        phones_by_verification_status=phones_by_vs,
        total_tasks=total_tasks,
        tasks_by_status=tasks_by_status,
    )
