"""
State-machine invariants for PipelineTask lifecycle (Phase DX).

These tests assert the rules the service layer enforces around state
transitions — separate from the service-layer tests because they probe
the *invariants*, not the happy paths.

Lifecycle:
    pending → assigned → resolved | rejected
    pending → resolved | rejected           (direct settlement)
    (terminal) → ANY                          ⇒ TaskStateTransitionError
"""

import pytest

from exceptions import TaskStateTransitionError
from models.pipeline_task import PipelineTask
from services.tasks import PipelineTaskService


@pytest.fixture()
def opened_task(session, seeded_target):
    """A freshly opened pending task to start every invariant test from."""
    svc = PipelineTaskService(session=session)
    return svc.open_task(
        phone_id=seeded_target.id,
        task_type="approval_required",
        requested_by="mock_operator_02",
    )


class TestTerminalStateImmutability:
    """Once a task hits 'resolved' or 'rejected', re-settlement is rejected."""

    @pytest.mark.parametrize("first_outcome", ["resolved", "rejected"])
    @pytest.mark.parametrize("second_outcome", ["resolved", "rejected"])
    def test_cannot_re_resolve_a_terminal_task(
        self, session, opened_task, first_outcome, second_outcome
    ):
        svc = PipelineTaskService(session=session)
        svc.resolve_task(
            task_id=opened_task.id,
            operator_id="mock_admin_01",
            outcome=first_outcome,
        )
        with pytest.raises(TaskStateTransitionError) as exc:
            svc.resolve_task(
                task_id=opened_task.id,
                operator_id="mock_admin_02",
                outcome=second_outcome,
            )
        assert exc.value.current_status == first_outcome
        assert exc.value.task_id == opened_task.id

    @pytest.mark.parametrize("terminal_status", ["resolved", "rejected"])
    def test_terminal_task_retains_first_resolver_attribution(
        self, session, opened_task, terminal_status
    ):
        """A failed re-resolution attempt must NOT overwrite the first resolver."""
        svc = PipelineTaskService(session=session)
        svc.resolve_task(
            task_id=opened_task.id,
            operator_id="first_admin",
            outcome=terminal_status,
        )
        with pytest.raises(TaskStateTransitionError):
            svc.resolve_task(
                task_id=opened_task.id,
                operator_id="second_admin",
                outcome="resolved",
            )
        # Reload from DB and verify the first resolver remains intact.
        session.expire_all()
        refreshed = session.get(PipelineTask, opened_task.id)
        assert refreshed.resolved_by == "first_admin"
        assert refreshed.status == terminal_status


class TestNonTerminalTransitions:
    """Pending tasks can transition to either terminal state in a single step."""

    @pytest.mark.parametrize("outcome", ["resolved", "rejected"])
    def test_pending_to_terminal_succeeds(self, session, opened_task, outcome):
        svc = PipelineTaskService(session=session)
        result = svc.resolve_task(
            task_id=opened_task.id,
            operator_id="mock_admin_01",
            outcome=outcome,
        )
        assert result.status == outcome
        assert result.resolved_at is not None

    def test_assigned_to_resolved_succeeds(self, session, opened_task):
        """An admin may claim ('assigned') before settling — both transitions work."""
        # Directly mutate to 'assigned' (no service method for the claim step
        # yet; that would be a future enhancement).
        opened_task.status = "assigned"
        session.add(opened_task)
        session.commit()

        svc = PipelineTaskService(session=session)
        result = svc.resolve_task(
            task_id=opened_task.id,
            operator_id="mock_admin_01",
            outcome="resolved",
        )
        assert result.status == "resolved"


class TestResolutionAtomicity:
    """Resolution writes all four fields in a single commit."""

    def test_all_four_fields_persisted_atomically(self, session, opened_task):
        svc = PipelineTaskService(session=session)
        before_status = opened_task.status
        svc.resolve_task(
            task_id=opened_task.id,
            operator_id="mock_admin_01",
            outcome="resolved",
            resolution_note="ok",
        )
        # Reload from DB through a fresh identity-map lookup.
        session.expire_all()
        refreshed = session.get(PipelineTask, opened_task.id)
        # All four mutations are visible together — no partial write.
        assert before_status == "pending"
        assert refreshed.status == "resolved"
        assert refreshed.resolved_by == "mock_admin_01"
        assert refreshed.resolved_at is not None
        assert refreshed.extra_data["resolution_outcome"] == "resolved"
        assert refreshed.extra_data["resolution_note"] == "ok"
