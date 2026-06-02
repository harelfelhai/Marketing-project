"""
app/api/v1/endpoints/tasks.py — Domain E: Operations Task Queue (Phase DX).

Endpoints:
    GET  /api/v1/tasks                — Paginated task list with filter-as-view.
    GET  /api/v1/tasks/{task_id}      — Single-task detail.
    POST /api/v1/tasks                — Open a new pending task.
    POST /api/v1/tasks/{task_id}/resolve  — Terminally settle a task.
    POST /api/v1/tasks/bulk-status    — Bulk-settle tasks.
    POST /api/v1/tasks/export         — Export to .xlsx.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import (
    get_current_user,
    get_export_service,
    get_pipeline_task_service,
    require_admin,
)
from models.user import User
from app.schemas.api_contracts import (
    BulkResolveTaskRequest,
    BulkResolveTaskResponse,
    OpenTaskRequest,
    PipelineTaskListResponse,
    PipelineTaskResponse,
    ResolveTaskRequest,
    TableExportRequest,
)
from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from models.types import SOFT_DELETE_SENTINEL
from services.export import ExportService
from services.read_model.manager import read_model_manager
from services.tasks import PipelineTaskService, TaskJoinRow

_TERMINAL_STATUSES = frozenset({"done", "rejected"})


_XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Internal: JOIN-row → response flattener
# ---------------------------------------------------------------------------

def _row_to_response(row: TaskJoinRow) -> PipelineTaskResponse:
    """
    Flatten a (task, full_name, identifier_1, identifier_2) JOIN
    tuple from PipelineTaskService into the PipelineTaskResponse shape.
    """
    task, full_name, identifier_1, identifier_2 = row
    return PipelineTaskResponse(
        id=task.id,
        phone_id=task.phone_id,
        phone_number=task.phone_number,
        entity_id=task.entity_id,
        task_type=task.task_type,
        status=task.status,
        extra_data=task.extra_data,
        full_name=full_name,
        identifier_1=identifier_1,
        identifier_2=identifier_2,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=PipelineTaskListResponse,
    summary="List pipeline tasks with optional filters",
)
def list_tasks(
    _admin: User = Depends(require_admin),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    task_type: Optional[str] = Query(default=None),
    phone_id: Optional[str] = Query(default=None),
    exclude_terminal: bool = Query(default=False),
    q: Optional[str] = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskListResponse:
    """
    Fast path (production): served from the in-memory ReadModelStore.
    Fallback path (tests / startup failure): DB queries via PipelineTaskService.
    """
    mgr = read_model_manager
    if mgr.started:
        # ── Memory path ──────────────────────────────────────────────
        tasks    = [t for t in mgr.store.all_tasks if t.deleted_at == SOFT_DELETE_SENTINEL]
        entities = mgr.store.entities_by_id

        if status_filter is not None:
            tasks = [t for t in tasks if t.status == status_filter]
        if task_type is not None:
            tasks = [t for t in tasks if t.task_type == task_type]
        if phone_id is not None:
            tasks = [t for t in tasks if t.phone_id == phone_id]
        if exclude_terminal and status_filter is None:
            tasks = [t for t in tasks if t.status not in _TERMINAL_STATUSES]

        needle = q.strip().lower() if q else None
        rows: list[TaskJoinRow] = []
        for task in tasks:
            entity = entities.get(task.entity_id)
            if needle is not None:
                hay = " ".join(str(x or "") for x in (
                    task.phone_number, task.entity_id,
                    entity.full_name if entity else None,
                    entity.identifier_1 if entity else None,
                )).lower()
                if needle not in hay:
                    continue
            rows.append((
                task,
                entity.full_name if entity else None,
                entity.identifier_1 if entity else None,
                entity.identifier_2 if entity else None,
            ))

        rows.sort(key=lambda r: r[0].id, reverse=True)
        total  = len(rows)
        offset = (page - 1) * page_size
        page_rows = rows[offset: offset + page_size]
    else:
        # ── DB fallback ───────────────────────────────────────────────
        page_rows, total = service.list_tasks_with_join(
            status_filter=status_filter,
            task_type_filter=task_type,
            phone_id_filter=phone_id,
            exclude_terminal=exclude_terminal,
            q=q,
            page=page,
            page_size=page_size,
        )

    return PipelineTaskListResponse(
        items=[_row_to_response(r) for r in page_rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{task_id}",
    response_model=PipelineTaskResponse,
    summary="Get a single pipeline task by id",
)
def get_task(
    task_id: str,
    _admin: User = Depends(require_admin),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskResponse:
    try:
        row = service.get_task_with_join(task_id=task_id)
    except PipelineTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return _row_to_response(row)


@router.post(
    "",
    response_model=PipelineTaskResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Open a new pipeline task",
)
def open_task(
    body: OpenTaskRequest,
    current_user: Optional[User] = Depends(get_current_user),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskResponse:
    try:
        task = service.open_task(
            phone_id=body.phone_id,
            task_type=body.task_type,
            extra_data=body.extra_data,
        )
    except PhoneNumberNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    read_model_manager.reload()
    return _row_to_response(service.get_task_with_join(task_id=task.id))


@router.post(
    "/export",
    summary="Export the /tasks table to Excel (.xlsx)",
    responses={200: {"content": {_XLSX_MEDIA_TYPE: {}}}},
)
def export_tasks(
    body: TableExportRequest,
    _admin: User = Depends(require_admin),
    service: ExportService = Depends(get_export_service),
) -> Response:
    try:
        xlsx_bytes, filename = service.export_tasks(
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


@router.post(
    "/bulk-status",
    response_model=BulkResolveTaskResponse,
    summary="Bulk-settle many tasks to a terminal status in one request",
)
def bulk_resolve_tasks(
    body: BulkResolveTaskRequest,
    admin: User = Depends(require_admin),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> BulkResolveTaskResponse:
    summary = service.bulk_resolve_tasks(
        task_ids=body.task_ids,
        operator_id=admin.username,
        outcome=body.outcome,
        resolution_note=body.resolution_note,
    )
    read_model_manager.reload()
    return BulkResolveTaskResponse.model_validate(summary)


@router.post(
    "/{task_id}/resolve",
    response_model=PipelineTaskResponse,
    summary="Terminally settle a pipeline task",
)
def resolve_task(
    task_id: str,
    body: ResolveTaskRequest,
    admin: User = Depends(require_admin),
    service: PipelineTaskService = Depends(get_pipeline_task_service),
) -> PipelineTaskResponse:
    try:
        service.resolve_task(
            task_id=task_id,
            operator_id=admin.username,
            outcome=body.outcome,
            resolution_note=body.resolution_note,
        )
    except PipelineTaskNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except TaskStateTransitionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    read_model_manager.reload()
    return _row_to_response(service.get_task_with_join(task_id=task_id))
