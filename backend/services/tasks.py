"""
services/tasks.py — Phase DX: PipelineTask service layer.

This module is the SOLE writer to the `pipeline_task` aggregate. By funnelling
both task openings (automated and operator-initiated) and resolutions through
one service, every Phase DX write path produces consistent state.

The service also owns the canonical JOIN with PhoneNumber and Entity used to
populate the `PipelineTaskResponse` convenience fields. Because the repository
seam must run on a document store with no server-side JOIN, that join is
performed application-side here: the candidate tasks are loaded, then their
phones and owning entities are batch-fetched and stitched in Python. The
volume is bounded by the operator queue ceiling, so the cost is negligible —
and this is exactly the read the planned "unified person+phones" aggregate
will later collapse into a single fetch.

PRIVACY CONTRACT
----------------
No proprietary identifiers are read or stored by this module beyond what the
caller supplies in `extra_data`. The structured columns receive only opaque
tokens (operator_id strings, free-form task_type / status / outcome).

AUTH DEFERRAL
-------------
`operator_id` is passed as an explicit parameter at every entry point.
"""

from datetime import datetime, timezone
from typing import List, Optional, Tuple

from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from models.pipeline_task import PipelineTask
from repositories.storage import Storage


# Terminal statuses that block re-resolution. Add to this set if a future
# task_type introduces additional terminal vocabulary (e.g. 'expired').
_TERMINAL_STATUSES = frozenset({"resolved", "rejected"})


# Row shape returned by the internal JOIN helpers below. Kept as a tuple so
# the endpoint layer can flatten it into PipelineTaskResponse without
# coupling this service to the API schema.
# Order: (task, phone_number, entity_id, entity_type, client_id)
TaskJoinRow = Tuple[
    PipelineTask, Optional[str], Optional[str], Optional[str], Optional[str]
]


class PipelineTaskService:
    """
    Atomic writer + JOIN reader for the `pipeline_task` aggregate.

    Construction:
        PipelineTaskService(storage=storage)
    """

    def __init__(self, storage: Storage) -> None:
        self.tasks = storage.tasks
        self.phones = storage.phones
        self.entities = storage.entities
        self.action_logs = storage.action_logs

    # ======================================================================
    # WRITERS
    # ======================================================================

    def open_task(
        self,
        phone_id: str,
        task_type: str,
        requested_by: str,
        source_action_log_id: Optional[str] = None,
        extra_data: Optional[dict] = None,
    ) -> PipelineTask:
        """
        Open a new pending PipelineTask.

        Validates that `phone_id` exists (raises `PhoneNumberNotFoundError`).
        If `source_action_log_id` is provided, validates that the referenced
        ActionLog exists and belongs to `phone_id` (raises `ValueError`).
        """
        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        if source_action_log_id is not None:
            log = self.action_logs.get(source_action_log_id)
            if log is None:
                raise ValueError(
                    f"source_action_log_id={source_action_log_id} not found."
                )
            if log.phone_id != phone_id:
                raise ValueError(
                    f"source_action_log_id={source_action_log_id} belongs to "
                    f"phone_id={log.phone_id}, not phone_id={phone_id}."
                )

        task = PipelineTask(
            phone_id=phone_id,
            task_type=task_type,
            status="pending",
            requested_by=requested_by,
            source_action_log_id=source_action_log_id,
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

        State machine:
            - Allowed from: 'pending', 'assigned' (any non-terminal status).
            - Blocked from: 'resolved', 'rejected' (raises TaskStateTransitionError).
        """
        task = self.tasks.get(task_id)
        if task is None:
            raise PipelineTaskNotFoundError(task_id=task_id)

        if task.status in _TERMINAL_STATUSES:
            raise TaskStateTransitionError(
                task_id=task_id,
                current_status=task.status,
            )

        now = datetime.now(timezone.utc)
        task.status = outcome
        task.resolved_by = operator_id
        task.resolved_at = now
        task.updated_at = now

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
        """
        Settle many tasks in a single request with per-task resilience.

        Each task is attempted individually; failures (not found, already
        terminal) are collected into `failed_rows` while successes land in
        `success_ids`. Partial success is the documented happy path.
        """
        now = datetime.now(timezone.utc)
        success_ids: List[str] = []
        failed_rows: List[dict] = []

        for tid in task_ids:
            task = self.tasks.get(tid)
            if task is None:
                failed_rows.append({
                    "task_id": tid,
                    "error":   f"PipelineTask with id={tid} was not found in the system.",
                })
                continue
            if task.status in _TERMINAL_STATUSES:
                failed_rows.append({
                    "task_id": tid,
                    "error": (
                        f"PipelineTask id={tid} is already in terminal status "
                        f"'{task.status}'. Open a new task instead of re-settling this one."
                    ),
                })
                continue

            task.status = outcome
            task.resolved_by = operator_id
            task.resolved_at = now
            task.updated_at = now

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
            "failed_rows":   failed_rows,
        }

    # ======================================================================
    # READERS (application-side JOIN with PhoneNumber + Entity)
    # ======================================================================

    def _join_maps(self, tasks: List[PipelineTask]):
        """Batch-fetch the phones + entities referenced by `tasks`."""
        phone_ids = list({t.phone_id for t in tasks})
        phones = (
            {p.id: p for p in self.phones.list({"id": {"in": phone_ids}})}
            if phone_ids else {}
        )
        entity_ids = list({p.entity_id for p in phones.values()})
        entities = (
            {e.id: e for e in self.entities.list({"id": {"in": entity_ids}})}
            if entity_ids else {}
        )
        return phones, entities

    def list_tasks_with_join(
        self,
        status_filter: Optional[str] = None,
        task_type_filter: Optional[str] = None,
        phone_id_filter: Optional[str] = None,
        exclude_terminal: bool = False,
        q: Optional[str] = None,
        client_ids: Optional[List[str]] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[TaskJoinRow], int]:
        """
        Paginated PipelineTask listing with an application-side JOIN to
        PhoneNumber + Entity. Returns (rows, total) where total is the
        match count BEFORE pagination. Rows are most-recent-first.

        Hides tasks whose phone OR owning entity is soft-deleted (the
        workflow target is gone). `exclude_terminal` is a no-op when
        `status_filter` is set — an explicit status query wins.
        """
        # Task-level filters resolved by the repository.
        where: dict = {}
        if status_filter is not None:
            where["status"] = status_filter
        if task_type_filter is not None:
            where["task_type"] = task_type_filter
        if phone_id_filter is not None:
            where["phone_id"] = phone_id_filter
        if exclude_terminal and status_filter is None:
            where["status"] = {"nin": list(_TERMINAL_STATUSES)}

        tasks = self.tasks.list(where)
        phones, entities = self._join_maps(tasks)

        rows: List[TaskJoinRow] = []
        needle = q.strip().lower() if q else None
        for task in tasks:
            phone = phones.get(task.phone_id)
            if phone is None or phone.deleted_at is not None:
                continue
            entity = entities.get(phone.entity_id)
            if entity is None or entity.deleted_at is not None:
                continue
            if client_ids and entity.client_id not in client_ids:
                continue
            if needle is not None:
                hay = " ".join(
                    str(x or "") for x in (
                        phone.phone_number, task.requested_by,
                        task.resolved_by, entity.client_id,
                    )
                ).lower()
                if needle not in hay:
                    continue
            rows.append((
                task, phone.phone_number, phone.entity_id,
                entity.entity_type, entity.client_id,
            ))

        # Most-recent-first; id is the deterministic tiebreaker.
        rows.sort(key=lambda r: (r[0].created_at, r[0].id), reverse=True)

        total = len(rows)
        offset = (page - 1) * page_size
        return rows[offset:offset + page_size], total

    def get_task_with_join(self, task_id: str) -> TaskJoinRow:
        """
        Fetch one task with the same JOIN shape as the list endpoint.

        Raises:
            PipelineTaskNotFoundError: `task_id` does not exist.
        """
        task = self.tasks.get(task_id)
        if task is None:
            raise PipelineTaskNotFoundError(task_id=task_id)

        phone = self.phones.get(task.phone_id)
        entity = self.entities.get(phone.entity_id) if phone else None
        return (
            task,
            phone.phone_number if phone else None,
            phone.entity_id if phone else None,
            entity.entity_type if entity else None,
            entity.client_id if entity else None,
        )
