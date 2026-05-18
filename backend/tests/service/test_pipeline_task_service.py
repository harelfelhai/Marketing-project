"""Service-layer tests for PipelineTaskService (Phase DX)."""

import pytest

from exceptions import (
    PhoneNumberNotFoundError,
    PipelineTaskNotFoundError,
    TaskStateTransitionError,
)
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from services.tasks import PipelineTaskService


# ---------------------------------------------------------------------------
# Local fixtures — a second seeded phone owned by a different entity, used by
# the FK-cross-phone validation test for source_action_log_id.
# ---------------------------------------------------------------------------

@pytest.fixture()
def second_phone(session, seeded_target):
    """A second phone on a fresh Entity, for cross-phone FK tests."""
    other = Entity(entity_type="target", extra_data={})
    session.add(other)
    session.flush()
    p = PhoneNumber(
        entity_id=other.id,
        phone_number="+15550000002",
        ingestion_source="manual",
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@pytest.fixture()
def action_log_on(session, seeded_target):
    """A failed ActionLog attached to the seeded target."""
    log = ActionLog(
        phone_id=seeded_target.id,
        action_type="action_type_a",
        status="failed",
        extra_data={"error_detail": "test"},
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log


# ===========================================================================
# open_task
# ===========================================================================


class TestOpenTask:
    def test_creates_pending_task_with_minimal_fields(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        task = svc.open_task(
            phone_id=seeded_target.id,
            task_type="approval_required",
            requested_by="mock_operator_02",
        )
        assert task.id is not None
        assert task.status == "pending"
        assert task.requested_by == "mock_operator_02"
        assert task.resolved_by is None
        assert task.resolved_at is None
        assert task.source_action_log_id is None
        assert task.extra_data is None
        assert task.created_at is not None

    def test_creates_task_with_full_payload(self, session, seeded_target, action_log_on):
        svc = PipelineTaskService(session=session)
        task = svc.open_task(
            phone_id=seeded_target.id,
            task_type="remediation_failure",
            requested_by="automation:retry_engine",
            source_action_log_id=action_log_on.id,
            extra_data={"failure_category": "provider_blocked"},
        )
        assert task.task_type == "remediation_failure"
        assert task.source_action_log_id == action_log_on.id
        assert task.extra_data == {"failure_category": "provider_blocked"}

    def test_unknown_phone_id_raises_PhoneNumberNotFound(self, session):
        svc = PipelineTaskService(session=session)
        with pytest.raises(PhoneNumberNotFoundError):
            svc.open_task(
                phone_id=99999,
                task_type="approval_required",
                requested_by="op",
            )

    def test_unknown_source_action_log_raises_ValueError(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        with pytest.raises(ValueError, match="not found"):
            svc.open_task(
                phone_id=seeded_target.id,
                task_type="remediation_failure",
                requested_by="op",
                source_action_log_id=99999,
            )

    def test_source_action_log_belonging_to_other_phone_raises_ValueError(
        self, session, seeded_target, second_phone, action_log_on
    ):
        # action_log_on belongs to seeded_target; pass second_phone.id instead.
        svc = PipelineTaskService(session=session)
        with pytest.raises(ValueError, match="belongs to phone_id"):
            svc.open_task(
                phone_id=second_phone.id,
                task_type="remediation_failure",
                requested_by="op",
                source_action_log_id=action_log_on.id,
            )


# ===========================================================================
# resolve_task
# ===========================================================================


class TestResolveTask:
    def _open(self, svc, seeded_target, **overrides):
        defaults = dict(
            phone_id=seeded_target.id,
            task_type="approval_required",
            requested_by="mock_operator_02",
        )
        defaults.update(overrides)
        return svc.open_task(**defaults)

    def test_writes_terminal_state_atomically(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        task = self._open(svc, seeded_target)

        resolved = svc.resolve_task(
            task_id=task.id,
            operator_id="mock_admin_01",
            outcome="resolved",
            resolution_note="approved",
        )
        assert resolved.status == "resolved"
        assert resolved.resolved_by == "mock_admin_01"
        assert resolved.resolved_at is not None
        # Resolution metadata merged into extra_data:
        assert resolved.extra_data["resolution_outcome"] == "resolved"
        assert resolved.extra_data["resolved_by"] == "mock_admin_01"
        assert resolved.extra_data["resolution_note"] == "approved"

    def test_rejected_outcome(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        task = self._open(svc, seeded_target)
        rejected = svc.resolve_task(
            task_id=task.id,
            operator_id="mock_admin_01",
            outcome="rejected",
        )
        assert rejected.status == "rejected"
        assert rejected.resolved_at is not None
        # resolution_note omitted — extra_data still gets outcome + resolved_by.
        assert "resolution_note" not in rejected.extra_data

    def test_extra_data_merge_preserves_opener_keys(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        task = self._open(
            svc, seeded_target,
            extra_data={"requested_action_type": "action_type_a"},
        )
        resolved = svc.resolve_task(
            task_id=task.id,
            operator_id="mock_admin_01",
            outcome="resolved",
        )
        # Both opener key and resolution key coexist — merge, not overwrite.
        assert resolved.extra_data["requested_action_type"] == "action_type_a"
        assert resolved.extra_data["resolution_outcome"] == "resolved"

    def test_unknown_task_id_raises_NotFound(self, session):
        svc = PipelineTaskService(session=session)
        with pytest.raises(PipelineTaskNotFoundError):
            svc.resolve_task(task_id=99999, operator_id="op", outcome="resolved")

    @pytest.mark.parametrize("terminal_status", ["resolved", "rejected"])
    def test_terminal_task_rejects_resolution(self, session, seeded_target, terminal_status):
        svc = PipelineTaskService(session=session)
        task = self._open(svc, seeded_target)
        # Manually push to terminal state.
        task.status = terminal_status
        session.add(task)
        session.commit()

        with pytest.raises(TaskStateTransitionError) as exc:
            svc.resolve_task(task_id=task.id, operator_id="op", outcome="resolved")
        assert exc.value.current_status == terminal_status


# ===========================================================================
# Read paths (JOIN with PhoneNumber + Entity)
# ===========================================================================


class TestListAndGet:
    def test_get_returns_join_tuple(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        task = svc.open_task(
            phone_id=seeded_target.id,
            task_type="approval_required",
            requested_by="op",
        )
        row = svc.get_task_with_join(task_id=task.id)
        # SQLAlchemy returns a Row, which is iterable/destructurable but not
        # a strict `tuple` subclass — assert the destructure shape instead.
        t, phone_number, entity_id, entity_type, client_id = row
        assert isinstance(t, PipelineTask)
        assert phone_number == seeded_target.phone_number
        assert entity_id == seeded_target.entity_id
        assert entity_type == "target"
        # seeded_target Entity has no client_id assigned.
        assert client_id is None

    def test_get_unknown_id_raises(self, session):
        svc = PipelineTaskService(session=session)
        with pytest.raises(PipelineTaskNotFoundError):
            svc.get_task_with_join(task_id=99999)

    def test_list_no_filters_returns_all_and_total(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        svc.open_task(phone_id=seeded_target.id, task_type="approval_required", requested_by="op")
        svc.open_task(phone_id=seeded_target.id, task_type="remediation_failure", requested_by="op")
        rows, total = svc.list_tasks_with_join()
        assert total == 2
        assert len(rows) == 2

    def test_list_filter_by_status(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        t1 = svc.open_task(phone_id=seeded_target.id, task_type="a", requested_by="op")
        t2 = svc.open_task(phone_id=seeded_target.id, task_type="b", requested_by="op")
        svc.resolve_task(task_id=t1.id, operator_id="adm", outcome="resolved")

        pending_rows, pending_total = svc.list_tasks_with_join(status_filter="pending")
        assert pending_total == 1
        assert pending_rows[0][0].id == t2.id

        resolved_rows, resolved_total = svc.list_tasks_with_join(status_filter="resolved")
        assert resolved_total == 1
        assert resolved_rows[0][0].id == t1.id

    def test_list_filter_by_task_type(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        svc.open_task(phone_id=seeded_target.id, task_type="approval_required", requested_by="op")
        svc.open_task(phone_id=seeded_target.id, task_type="remediation_failure", requested_by="op")
        rows, total = svc.list_tasks_with_join(task_type_filter="approval_required")
        assert total == 1
        assert rows[0][0].task_type == "approval_required"

    def test_list_filter_by_phone_id(self, session, seeded_target, second_phone):
        svc = PipelineTaskService(session=session)
        svc.open_task(phone_id=seeded_target.id, task_type="x", requested_by="op")
        svc.open_task(phone_id=second_phone.id,  task_type="y", requested_by="op")
        rows, total = svc.list_tasks_with_join(phone_id_filter=second_phone.id)
        assert total == 1
        assert rows[0][0].phone_id == second_phone.id

    def test_list_orders_most_recent_first(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        first  = svc.open_task(phone_id=seeded_target.id, task_type="a", requested_by="op")
        second = svc.open_task(phone_id=seeded_target.id, task_type="b", requested_by="op")
        rows, _ = svc.list_tasks_with_join()
        # Most-recent created_at first.
        assert rows[0][0].id == second.id
        assert rows[1][0].id == first.id

    def test_list_pagination(self, session, seeded_target):
        svc = PipelineTaskService(session=session)
        for i in range(5):
            svc.open_task(phone_id=seeded_target.id, task_type=f"t{i}", requested_by="op")
        rows, total = svc.list_tasks_with_join(page=1, page_size=2)
        assert total == 5
        assert len(rows) == 2
        rows2, _ = svc.list_tasks_with_join(page=3, page_size=2)
        assert len(rows2) == 1
