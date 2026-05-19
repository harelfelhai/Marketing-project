"""
services/tasks.py — Phase DX: PipelineTask service layer.

This module is the SOLE writer to the `pipeline_task` table. By funnelling
both task openings (automated and operator-initiated) and resolutions
through one service, every Phase DX write path produces consistent state.

The service also owns the canonical JOIN with PhoneNumber and Entity used
to populate the `PipelineTaskResponse` convenience fields — keeping that
JOIN in one place lets the endpoint layer stay declarative.

PRIVACY CONTRACT
----------------
No proprietary identifiers are read or stored by this module beyond what
the caller supplies in `extra_data`. The structured columns receive only
opaque tokens (operator_id strings, free-form task_type / status / outcome).

AUTH DEFERRAL
-------------
`operator_id` is passed as an explicit parameter at every entry point.
The service performs no permission check — the frontend's
`<RequireRole role="admin">` wrapper is the gate today, and Phase G will
replace it with a `get_current_operator` FastAPI dependency.
"""

from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy import func, or_, select as sa_select
from sqlmodel import Session, select

from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask


# Terminal statuses that block re-resolution. Add to this set if a future
# task_type introduces additional terminal vocabulary (e.g. 'expired').
_TERMINAL_STATUSES = frozenset({"resolved", "rejected"})


# Row shape returned by the internal JOIN helpers below. Kept as a tuple so
# the endpoint layer can flatten it into PipelineTaskResponse without
# coupling this service to the API schema.
TaskJoinRow = Tuple[PipelineTask, Optional[str], Optional[int], Optional[str], Optional[int]]
# Order: (task, phone_number, entity_id, entity_type, client_id)


class PipelineTaskService:
    """
    Atomic writer + JOIN reader for the `pipeline_task` table.

    Three write methods (`open_task`, `resolve_task`) and two read methods
    (`list_tasks_with_join`, `get_task_with_join`). Reads always go through
    the JOIN so the OperationsQueue UI never has to do a second round-trip
    to display the owning phone / entity / client.

    Construction:
        PipelineTaskService(session=db_session)
    """

    def __init__(self, session: Session) -> None:
        self.session = session

    # ======================================================================
    # WRITERS
    # ======================================================================

    def open_task(
        self,
        phone_id: int,
        task_type: str,
        requested_by: str,
        source_action_log_id: Optional[int] = None,
        extra_data: Optional[dict] = None,
    ) -> PipelineTask:
        """
        Open a new pending PipelineTask.

        Validates that `phone_id` exists (raises `PhoneNumberNotFoundError`).
        If `source_action_log_id` is provided, validates that the referenced
        ActionLog exists and belongs to `phone_id` (raises `ValueError`).

        Args:
            phone_id             (int):           FK to the target PhoneNumber.
            task_type            (str):           Free-form task_type token.
            requested_by         (str):           operator_id of the opener.
            source_action_log_id (Optional[int]): Optional originating ActionLog FK.
            extra_data           (Optional[dict]): Opaque payload stored on the new task.

        Returns:
            PipelineTask: The committed task with `status='pending'`.

        Raises:
            PhoneNumberNotFoundError: `phone_id` does not exist.
            ValueError: `source_action_log_id` does not belong to `phone_id`.
        """
        phone = self.session.get(PhoneNumber, phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        if source_action_log_id is not None:
            log = self.session.get(ActionLog, source_action_log_id)
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
        self.session.add(task)
        self.session.commit()
        self.session.refresh(task)
        return task

    def resolve_task(
        self,
        task_id: int,
        operator_id: str,
        outcome: str,
        resolution_note: Optional[str] = None,
    ) -> PipelineTask:
        """
        Terminally settle a task.

        Atomically writes `status`, `resolved_by`, `resolved_at`, and merges
        `resolution_note` + `resolution_outcome` into `extra_data` (preserving
        any existing keys).

        State machine:
            - Allowed from: 'pending', 'assigned' (and any non-terminal status).
            - Blocked from: 'resolved', 'rejected' (raises TaskStateTransitionError).

        Args:
            task_id         (int):           PK of the task to settle.
            operator_id     (str):           operator_id of the resolving admin.
            outcome         (str):           Terminal status ('resolved' or 'rejected').
            resolution_note (Optional[str]): Optional free-text justification.

        Returns:
            PipelineTask: The updated, committed task in its terminal state.

        Raises:
            PipelineTaskNotFoundError: `task_id` does not exist.
            TaskStateTransitionError:  Task is already in a terminal state.
        """
        task = self.session.get(PipelineTask, task_id)
        if task is None:
            raise PipelineTaskNotFoundError(task_id=task_id)

        if task.status in _TERMINAL_STATUSES:
            raise TaskStateTransitionError(
                task_id=task_id,
                current_status=task.status,
            )

        # Phase DX constraint #3: timezone-aware UTC. The column is
        # DateTime(timezone=True); writing a naive datetime here would
        # produce a value comparison hazard with the default_factory.
        now = datetime.now(timezone.utc)
        task.status = outcome
        task.resolved_by = operator_id
        task.resolved_at = now
        task.updated_at = now

        # Merge resolution metadata into extra_data without clobbering existing
        # proprietary keys the opener may have stored.
        merged = dict(task.extra_data or {})
        merged["resolution_outcome"] = outcome
        merged["resolved_by"] = operator_id
        if resolution_note is not None:
            merged["resolution_note"] = resolution_note
        task.extra_data = merged

        self.session.add(task)
        self.session.commit()
        self.session.refresh(task)
        return task

    def bulk_resolve_tasks(
        self,
        task_ids: List[int],
        operator_id: str,
        outcome: str,
        resolution_note: Optional[str] = None,
    ) -> dict:
        """
        Settle many tasks in a single request with per-task resilience.

        Each task is attempted individually inside the same outer
        transaction. Failures (task not found, already terminal) are
        collected into `failed_rows`; successful resolutions land in
        `success_ids`. The whole batch commits at the end — partial
        success is the documented happy path, matching the Phase E1
        bulk-ingestion resilience contract.

        Args:
            task_ids        (List[int]):     IDs to settle. Validated by the
                                              caller / schema layer for size
                                              and non-emptiness.
            operator_id     (str):           Operator stamped on every settled task.
            outcome         (str):           Terminal status to write
                                              ('resolved' or 'rejected'). Schema
                                              layer validates the enum.
            resolution_note (Optional[str]): Optional free-text note merged
                                              into every settled task's
                                              `extra_data`.

        Returns:
            dict: {
                success_count: int,
                failed_count:  int,
                success_ids:   List[int],   # ids that settled successfully
                failed_rows:   List[{       # one entry per non-settling id
                    task_id: int,
                    error:   str,
                }],
            }
        """
        now = datetime.now(timezone.utc)
        success_ids: List[int] = []
        failed_rows: List[dict] = []

        # Resolve each task one at a time. We deliberately do NOT use a
        # single bulk-UPDATE statement because each task's pre-state must
        # be inspected to enforce the terminal-state guard. The cost is
        # N round-trips to SQLite/Postgres, which for the UI ceiling
        # (200 task_ids per request) is well under the request budget.
        for tid in task_ids:
            task = self.session.get(PipelineTask, tid)
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

            self.session.add(task)
            success_ids.append(tid)

        # Single commit at the end — all surviving writes land atomically.
        self.session.commit()

        return {
            "success_count": len(success_ids),
            "failed_count":  len(failed_rows),
            "success_ids":   success_ids,
            "failed_rows":   failed_rows,
        }

    # ======================================================================
    # READERS (always JOIN with PhoneNumber + Entity)
    # ======================================================================

    def list_tasks_with_join(
        self,
        status_filter: Optional[str] = None,
        task_type_filter: Optional[str] = None,
        phone_id_filter: Optional[int] = None,
        exclude_terminal: bool = False,
        q: Optional[str] = None,
        client_ids: Optional[List[int]] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> Tuple[List[TaskJoinRow], int]:
        """
        Paginated PipelineTask listing with JOIN to PhoneNumber + Entity.

        Returns a 2-tuple of (rows, total). `total` reflects the count before
        pagination so the frontend can compute total pages. Rows are ordered
        most-recent-first by `created_at`.

        Args:
            status_filter     (Optional[str]): Filter on `pipeline_task.status`.
            task_type_filter  (Optional[str]): Filter on `pipeline_task.task_type`.
            phone_id_filter   (Optional[int]): Filter on `pipeline_task.phone_id`.
            exclude_terminal  (bool):          When True, hides rows whose status
                                                is in _TERMINAL_STATUSES (resolved /
                                                rejected). Used by the Task Center
                                                UI's default-hide toggle. Has no
                                                effect when `status_filter` is set
                                                — explicit filter intent wins.
            page              (int):           1-based page number.
            page_size         (int):           Records per page.

        Returns:
            Tuple[List[TaskJoinRow], int]: (rows, total) where each row is a
                                            (task, phone_number, entity_id,
                                            entity_type, client_id) tuple.
        """
        base = (
            sa_select(
                PipelineTask,
                PhoneNumber.phone_number,
                PhoneNumber.entity_id,
                Entity.entity_type,
                Entity.client_id,
            )
            .join(PhoneNumber, PipelineTask.phone_id == PhoneNumber.id)
            .join(Entity, PhoneNumber.entity_id == Entity.id)
        )
        count_base = (
            sa_select(func.count(PipelineTask.id))
            .join(PhoneNumber, PipelineTask.phone_id == PhoneNumber.id)
            .join(Entity, PhoneNumber.entity_id == Entity.id)
        )

        filters = []
        if status_filter is not None:
            filters.append(PipelineTask.status == status_filter)
        if task_type_filter is not None:
            filters.append(PipelineTask.task_type == task_type_filter)
        if phone_id_filter is not None:
            filters.append(PipelineTask.phone_id == phone_id_filter)
        # `exclude_terminal` is a noop when status_filter is set — an
        # explicit status query (e.g. "give me only resolved tasks for
        # audit") must not be silently overridden by the default-hide
        # toggle the UI defaults to ON.
        if exclude_terminal and status_filter is None:
            filters.append(PipelineTask.status.notin_(_TERMINAL_STATUSES))
        # Phase AUTH-C — multi-value client personalization filter.
        if client_ids:
            filters.append(Entity.client_id.in_(client_ids))
        # Substring search — mirrors TaskTable.applyFilters' frontend
        # search semantics: matches phone_number, requested_by,
        # resolved_by, and client_id (stringified) so an operator
        # filtering on screen sees the same set the server exports.
        # `client_name` is intentionally NOT matched — that's a
        # frontend-resolved display name the backend doesn't store.
        if q:
            like = f"%{q}%"
            filters.append(or_(
                PhoneNumber.phone_number.ilike(like),
                PipelineTask.requested_by.ilike(like),
                PipelineTask.resolved_by.ilike(like),
                func.cast(Entity.client_id, type_=PhoneNumber.phone_number.type).ilike(like),
            ))

        for f in filters:
            base = base.where(f)
            count_base = count_base.where(f)

        total: int = self.session.execute(count_base).scalar_one()

        offset = (page - 1) * page_size
        rows = self.session.execute(
            base.order_by(PipelineTask.created_at.desc()).offset(offset).limit(page_size)
        ).all()

        return list(rows), total

    def get_task_with_join(self, task_id: int) -> TaskJoinRow:
        """
        Fetch one task with the same JOIN shape as the list endpoint.

        Args:
            task_id (int): PK of the task to fetch.

        Returns:
            TaskJoinRow: (task, phone_number, entity_id, entity_type, client_id).

        Raises:
            PipelineTaskNotFoundError: `task_id` does not exist.
        """
        row = self.session.execute(
            sa_select(
                PipelineTask,
                PhoneNumber.phone_number,
                PhoneNumber.entity_id,
                Entity.entity_type,
                Entity.client_id,
            )
            .join(PhoneNumber, PipelineTask.phone_id == PhoneNumber.id)
            .join(Entity, PhoneNumber.entity_id == Entity.id)
            .where(PipelineTask.id == task_id)
        ).first()

        if row is None:
            raise PipelineTaskNotFoundError(task_id=task_id)

        return row
