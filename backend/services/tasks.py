"""
services/tasks.py — PipelineTask service layer.

Sole writer and reader for the pipeline_task aggregate.

STATUS VOCABULARY
-----------------
  "pending"   -- awaiting resolution
  "done"      -- terminal, completed positively
  "rejected"  -- terminal, declined/closed without action
"""

from typing import List, Optional, Tuple

from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from models.pipeline_task import PipelineTask
from models.types import SOFT_DELETE_SENTINEL, not_deleted
from repositories.storage import Storage


_TERMINAL_STATUSES = frozenset({"done", "rejected"})

# Row shape returned by list_tasks_with_join.
# Order: (task, full_name, identifier_1, identifier_2)
TaskJoinRow = Tuple[
    PipelineTask, Optional[str], Optional[str], Optional[str]
]


class PipelineTaskService:
    """Atomic writer + JOIN reader for the pipeline_task aggregate."""

    def __init__(self, storage: Storage) -> None:
        self.tasks = storage.tasks
        self.phones = storage.phones
        self.entities = storage.entities

    def open_task(
        self,
        phone_id: str,
        task_type: str,
        extra_data: Optional[dict] = None,
    ) -> PipelineTask:
        """
        Open a new pending PipelineTask.

        Validates that phone_id exists (raises PhoneNumberNotFoundError).
        Denormalizes phone_number and entity_id from the phone row.
        """
        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        task = PipelineTask(
            phone_id=phone_id,
            phone_number=phone.phone_number,
            entity_id=phone.entity_id,
            task_type=task_type,
            status="pending",
            deleted_at=not_deleted(),
            extra_data=extra_data,
        )
        return self.tasks.add(task)

    def resolve_task(
        self,
        task_id: str,
        operator_id: str,
        outcome: str,
        resolution_note: Optional[str] = None,
    ) -> PipelineTask:
        """
        Terminally settle a task.

        outcome must be 'done' or 'rejected'.
        Raises TaskStateTransitionError if already terminal.
        """
        task = self.tasks.get(task_id)
        if task is None:
            raise PipelineTaskNotFoundError(task_id=task_id)

        if task.status in _TERMINAL_STATUSES:
            raise TaskStateTransitionError(
                task_id=task_id,
                current_status=task.status,
            )

        task.status = outcome

        merged = dict(task.extra_data or {})
        merged["resolution_outcome"] = outcome
        merged["resolved_by"] = operator_id
        if resolution_note is not None:
            merged["resolution_note"] = resolution_note
        task.extra_data = merged

        return self.tasks.update(task)

    def bulk_resolve_tasks(
        self,
        task_ids: List[str],
        operator_id: str,
        outcome: str,
        resolution_note: Optional[str] = None,
    ) -> dict:
        """Settle many tasks in a single request with per-task resilience."""
        success_ids: List[str] = []
        failed_rows: List[dict] = []

        for tid in task_ids:
            task = self.tasks.get(tid)
            if task is None:
                failed_rows.append({"task_id": tid, "error": f"PipelineTask with id={tid} was not found in the system."})
                continue
            if task.status in _TERMINAL_STATUSES:
                failed_rows.append({"task_id": tid, "error": f"PipelineTask id={tid} is already in terminal status '{task.status}'."})
                continue

            task.status = outcome
            merged = dict(task.extra_data or {})
            merged["resolution_outcome"] = outcome
            merged["resolved_by"] = operator_id
            if resolution_note is not None:
                merged["resolution_note"] = resolution_note
            task.extra_data = merged

            self.tasks.update(task)
            success_ids.append(tid)

        return {
            "success_count": len(success_ids),
            "failed_count":  len(failed_rows),
            "success_ids":   success_ids,
            "failed_ids":    [r["task_id"] for r in failed_rows],
            "failed_rows":   failed_rows,
        }

    def _join_entities(self, tasks: List[PipelineTask]):
        """Batch-fetch entities referenced by tasks."""
        entity_ids = list({t.entity_id for t in tasks})
        entities = (
            {e.id: e for e in self.entities.list({"id": {"in": entity_ids}})}
            if entity_ids else {}
        )
        return entities

    def list_tasks_with_join(
        self,
        status_filter: Optional[str] = None,
        task_type_filter: Optional[str] = None,
        phone_id_filter: Optional[str] = None,
        exclude_terminal: bool = False,
        q: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        custom_where: Optional[dict] = None,
    ) -> Tuple[List[TaskJoinRow], int]:
        """
        Paginated PipelineTask listing with entity JOIN for full_name + identifiers.
        Hides soft-deleted tasks. Returns (rows, total).

        `custom_where` carries already-validated admin-defined filter clauses
        (see services/generic_filters.py), merged straight into the DSL query.
        """
        where: dict = dict(custom_where or {})
        where["deleted_at"] = SOFT_DELETE_SENTINEL
        if status_filter is not None:
            where["status"] = status_filter
        if task_type_filter is not None:
            where["task_type"] = task_type_filter
        if phone_id_filter is not None:
            where["phone_id"] = phone_id_filter
        if exclude_terminal and status_filter is None:
            where["status"] = {"nin": list(_TERMINAL_STATUSES)}

        tasks = self.tasks.list(where)
        entities = self._join_entities(tasks)

        rows: List[TaskJoinRow] = []
        needle = q.strip().lower() if q else None
        for task in tasks:
            entity = entities.get(task.entity_id)
            if needle is not None:
                hay = " ".join(
                    str(x or "") for x in (
                        task.phone_number, task.entity_id,
                        entity.full_name if entity else None,
                        entity.identifier_1 if entity else None,
                    )
                ).lower()
                if needle not in hay:
                    continue
            rows.append((
                task,
                entity.full_name if entity else None,
                entity.identifier_1 if entity else None,
                entity.identifier_2 if entity else None,
            ))

        rows.sort(key=lambda r: r[0].id, reverse=True)

        total = len(rows)
        offset = (page - 1) * page_size
        return rows[offset:offset + page_size], total

    def get_task_with_join(self, task_id: str) -> TaskJoinRow:
        """Fetch one task with entity JOIN shape."""
        task = self.tasks.get(task_id)
        if task is None:
            raise PipelineTaskNotFoundError(task_id=task_id)

        entity = self.entities.get(task.entity_id) if task.entity_id else None
        return (
            task,
            entity.full_name if entity else None,
            entity.identifier_1 if entity else None,
            entity.identifier_2 if entity else None,
        )
