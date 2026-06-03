"""Service-layer tests for PipelineTaskService."""

import pytest

from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from models.types import not_deleted
from services.tasks import PipelineTaskService
from repositories.storage import SqlStorage


@pytest.fixture()
def second_phone(session, seeded_target):
    """A second phone on a fresh Entity."""
    other = Entity(relation_type="primary", deleted_at=not_deleted())
    session.add(other)
    session.flush()
    p = PhoneNumber(
        entity_id=other.id,
        phone_number="+15550000002",
        ingestion_source="manual",
        score=0.0,
        deleted_at=not_deleted(),
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


# ===========================================================================
# open_task
# ===========================================================================


class TestOpenTask:
    def test_creates_pending_task_with_minimal_fields(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        task = svc.open_task(
            phone_id=seeded_target.id,
            task_type="review",
        )
        assert task.id is not None
        assert task.status == "pending"
        assert task.phone_id == seeded_target.id
        assert task.phone_number == seeded_target.phone_number
        assert task.entity_id == seeded_target.entity_id

    def test_creates_task_with_extra_data(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        task = svc.open_task(
            phone_id=seeded_target.id,
            task_type="review",
            extra_data={"priority": "high"},
        )
        assert task.extra_data == {"priority": "high"}

    def test_unknown_phone_id_raises(self, session):
        svc = PipelineTaskService(storage=SqlStorage(session))
        with pytest.raises(PhoneNumberNotFoundError):
            svc.open_task(phone_id="nonexistent-id", task_type="review")


# ===========================================================================
# resolve_task
# ===========================================================================


class TestResolveTask:
    def _open(self, svc, seeded_target, **overrides):
        defaults = dict(phone_id=seeded_target.id, task_type="review")
        defaults.update(overrides)
        return svc.open_task(**defaults)

    def test_writes_terminal_state_atomically(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        task = self._open(svc, seeded_target)

        resolved = svc.resolve_task(
            task_id=task.id,
            operator_id="admin",
            outcome="done",
            resolution_note="approved",
        )
        assert resolved.status == "done"
        assert resolved.extra_data["resolution_outcome"] == "done"
        assert resolved.extra_data["resolved_by"] == "admin"
        assert resolved.extra_data["resolution_note"] == "approved"

    def test_rejected_outcome(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        task = self._open(svc, seeded_target)
        rejected = svc.resolve_task(
            task_id=task.id,
            operator_id="admin",
            outcome="rejected",
        )
        assert rejected.status == "rejected"

    def test_extra_data_merge_preserves_opener_keys(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        task = self._open(svc, seeded_target, extra_data={"requested_action": "type_a"})
        resolved = svc.resolve_task(
            task_id=task.id, operator_id="admin", outcome="done",
        )
        assert resolved.extra_data["requested_action"] == "type_a"
        assert resolved.extra_data["resolution_outcome"] == "done"

    def test_unknown_task_id_raises_not_found(self, session):
        svc = PipelineTaskService(storage=SqlStorage(session))
        with pytest.raises(PipelineTaskNotFoundError):
            svc.resolve_task(task_id="nonexistent-id", operator_id="op", outcome="done")

    @pytest.mark.parametrize("terminal_status", ["done", "rejected"])
    def test_terminal_task_rejects_resolution(self, session, seeded_target, terminal_status):
        svc = PipelineTaskService(storage=SqlStorage(session))
        task = self._open(svc, seeded_target)
        # Push to terminal state.
        task.status = terminal_status
        session.add(task)
        session.commit()

        with pytest.raises(TaskStateTransitionError) as exc:
            svc.resolve_task(task_id=task.id, operator_id="op", outcome="done")
        assert exc.value.current_status == terminal_status


# ===========================================================================
# Read paths (JOIN with PhoneNumber + Entity)
# ===========================================================================


class TestListAndGet:
    def test_list_no_filters_returns_all_and_total(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        svc.open_task(phone_id=seeded_target.id, task_type="review")
        svc.open_task(phone_id=seeded_target.id, task_type="audit")
        rows, total = svc.list_tasks_with_join()
        assert total == 2
        assert len(rows) == 2

    def test_list_row_shape(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        svc.open_task(phone_id=seeded_target.id, task_type="review")
        rows, total = svc.list_tasks_with_join()
        assert total == 1
        t, full_name, identifier_1, identifier_2 = rows[0]
        assert isinstance(t, PipelineTask)
        assert t.phone_number == seeded_target.phone_number

    def test_exclude_terminal_hides_done_and_rejected(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        t1 = svc.open_task(phone_id=seeded_target.id, task_type="a")
        t2 = svc.open_task(phone_id=seeded_target.id, task_type="b")
        t3 = svc.open_task(phone_id=seeded_target.id, task_type="c")
        svc.resolve_task(task_id=t2.id, operator_id="adm", outcome="done")
        svc.resolve_task(task_id=t3.id, operator_id="adm", outcome="rejected")

        rows, total = svc.list_tasks_with_join(exclude_terminal=True)
        assert total == 1
        assert rows[0][0].id == t1.id

    def test_list_pagination(self, session, seeded_target):
        svc = PipelineTaskService(storage=SqlStorage(session))
        for i in range(5):
            svc.open_task(phone_id=seeded_target.id, task_type=f"t{i}")
        rows, total = svc.list_tasks_with_join(page=1, page_size=2)
        assert total == 5
        assert len(rows) == 2

    def test_q_substring_matches_phone_number(self, session, seeded_target, second_phone):
        svc = PipelineTaskService(storage=SqlStorage(session))
        svc.open_task(phone_id=seeded_target.id, task_type="review")
        svc.open_task(phone_id=second_phone.id, task_type="review")

        # seeded_target is "+15550000001" and second_phone is "+15550000002"
        rows, total = svc.list_tasks_with_join(q="0001")
        assert total == 1
        assert rows[0][0].phone_number == seeded_target.phone_number


# ===========================================================================
# bulk_resolve_tasks
# ===========================================================================


class TestBulkResolveTasks:
    def _seed_n_pending(self, session, seeded_target, n):
        svc = PipelineTaskService(storage=SqlStorage(session))
        ids = []
        for i in range(n):
            t = svc.open_task(phone_id=seeded_target.id, task_type=f"t{i}")
            ids.append(t.id)
        return svc, ids

    def test_happy_path_settles_all(self, session, seeded_target):
        svc, ids = self._seed_n_pending(session, seeded_target, 3)
        summary = svc.bulk_resolve_tasks(
            task_ids=ids, operator_id="manager", outcome="done",
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert sorted(summary["success_ids"]) == sorted(ids)

    def test_missing_id_lands_in_failed(self, session, seeded_target):
        svc, ids = self._seed_n_pending(session, seeded_target, 2)
        summary = svc.bulk_resolve_tasks(
            task_ids=[ids[0], "missing-id", ids[1]],
            operator_id="manager",
            outcome="done",
        )
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_ids"] == ["missing-id"]

    def test_already_terminal_lands_in_failed(self, session, seeded_target):
        svc, ids = self._seed_n_pending(session, seeded_target, 2)
        svc.resolve_task(task_id=ids[0], operator_id="adm", outcome="done")

        summary = svc.bulk_resolve_tasks(
            task_ids=ids, operator_id="manager", outcome="done",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1

    def test_resolution_note_merged_into_extra_data(self, session, seeded_target):
        svc, ids = self._seed_n_pending(session, seeded_target, 2)
        svc.bulk_resolve_tasks(
            task_ids=ids, operator_id="manager", outcome="done",
            resolution_note="batch handled",
        )
        for tid in ids:
            extra = session.get(PipelineTask, tid).extra_data
            assert extra["resolution_note"] == "batch handled"
            assert extra["resolution_outcome"] == "done"
