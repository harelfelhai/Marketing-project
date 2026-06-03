"""
State-machine invariants for PipelineTask lifecycle.

These tests assert the rules the service layer enforces around state
transitions — separate from the service-layer tests because they probe
the *invariants*, not the happy paths.

Lifecycle:
    pending → done | rejected   (direct settlement)
    (terminal) → ANY            ⇒ TaskStateTransitionError
"""

import pytest

from exceptions import TaskStateTransitionError
from models.pipeline_task import PipelineTask
from services.tasks import PipelineTaskService
from repositories.storage import SqlStorage


@pytest.fixture()
def opened_task(session, seeded_target):
    """A freshly opened pending task to start every invariant test from."""
    svc = PipelineTaskService(storage=SqlStorage(session))
    return svc.open_task(
        phone_id=seeded_target.id,
        task_type="review",
    )


class TestTerminalStateImmutability:
    """Once a task hits 'done' or 'rejected', re-settlement is rejected."""

    @pytest.mark.parametrize("first_outcome", ["done", "rejected"])
    @pytest.mark.parametrize("second_outcome", ["done", "rejected"])
    def test_cannot_re_resolve_a_terminal_task(
        self, session, opened_task, first_outcome, second_outcome
    ):
        svc = PipelineTaskService(storage=SqlStorage(session))
        svc.resolve_task(
            task_id=opened_task.id,
            operator_id="admin_01",
            outcome=first_outcome,
        )
        with pytest.raises(TaskStateTransitionError) as exc:
            svc.resolve_task(
                task_id=opened_task.id,
                operator_id="admin_02",
                outcome=second_outcome,
            )
        assert exc.value.current_status == first_outcome
        assert exc.value.task_id == opened_task.id

    @pytest.mark.parametrize("terminal_status", ["done", "rejected"])
    def test_terminal_task_retains_first_resolver_attribution(
        self, session, opened_task, terminal_status
    ):
        """A failed re-resolution attempt must NOT overwrite the first resolver."""
        svc = PipelineTaskService(storage=SqlStorage(session))
        svc.resolve_task(
            task_id=opened_task.id,
            operator_id="first_admin",
            outcome=terminal_status,
        )
        with pytest.raises(TaskStateTransitionError):
            svc.resolve_task(
                task_id=opened_task.id,
                operator_id="second_admin",
                outcome="done",
            )
        # Reload from DB and verify the first resolver remains intact.
        session.expire_all()
        refreshed = session.get(PipelineTask, opened_task.id)
        assert refreshed.extra_data.get("resolved_by") == "first_admin"
        assert refreshed.status == terminal_status


class TestNonTerminalTransitions:
    """Pending tasks can transition to either terminal state in a single step."""

    @pytest.mark.parametrize("outcome", ["done", "rejected"])
    def test_pending_to_terminal_succeeds(self, session, opened_task, outcome):
        svc = PipelineTaskService(storage=SqlStorage(session))
        result = svc.resolve_task(
            task_id=opened_task.id,
            operator_id="admin_01",
            outcome=outcome,
        )
        assert result.status == outcome


class TestResolutionAtomicity:
    """Resolution writes all resolution fields in a single commit."""

    def test_all_fields_persisted_atomically(self, session, opened_task):
        svc = PipelineTaskService(storage=SqlStorage(session))
        before_status = opened_task.status
        svc.resolve_task(
            task_id=opened_task.id,
            operator_id="admin_01",
            outcome="done",
            resolution_note="ok",
        )
        # Reload from DB through a fresh identity-map lookup.
        session.expire_all()
        refreshed = session.get(PipelineTask, opened_task.id)
        assert before_status == "pending"
        assert refreshed.status == "done"
        assert refreshed.extra_data["resolved_by"] == "admin_01"
        assert refreshed.extra_data["resolution_outcome"] == "done"
        assert refreshed.extra_data["resolution_note"] == "ok"
