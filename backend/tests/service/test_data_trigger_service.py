"""Service-layer tests for ActionDataTriggerService."""

from datetime import datetime, timedelta

from sqlmodel import select

from models.action_log import ActionLog
from services.dispatcher import ActionDispatcher, ActionDataTriggerService

from tests.conftest import RecordingHandler


def _make_trigger_service(session, trigger_fields=None):
    dispatcher = ActionDispatcher(
        session=session,
        handlers={},
        default_handler=RecordingHandler(),
        max_retry_count=3,
    )
    return ActionDataTriggerService(
        session=session, dispatcher=dispatcher, trigger_fields=trigger_fields,
    )


class TestNoFailedActionPath:
    def test_returns_none_when_no_failed_action_exists(self, session, seeded_target):
        svc = _make_trigger_service(session)
        result = svc.evaluate_data_change_trigger(
            phone_id=seeded_target.id,
            updated_fields=["any_field"],
        )
        assert result is None


class TestFailedActionTriggersRedispatch:
    def test_redispatches_action_type_from_most_recent_failed_row(
        self, session, seeded_target
    ):
        # Seed two failed rows; the newer one should be re-dispatched.
        older = ActionLog(
            phone_id=seeded_target.id, action_type="old_action",
            status="failed",
            requested_at=datetime.utcnow() - timedelta(hours=2),
        )
        newer = ActionLog(
            phone_id=seeded_target.id, action_type="new_action",
            status="failed",
            requested_at=datetime.utcnow() - timedelta(minutes=10),
        )
        session.add_all([older, newer])
        session.commit()

        svc = _make_trigger_service(session)
        result = svc.evaluate_data_change_trigger(
            phone_id=seeded_target.id,
            updated_fields=["classification_type"],
        )
        assert result is not None
        assert result.action_type == "new_action"
        assert result.id != newer.id  # a NEW row was created (fresh dispatch)


class TestTriggerFieldsAllowlist:
    def test_no_overlap_returns_none(self, session, seeded_target):
        # Seed a failed action that WOULD otherwise trigger.
        session.add(ActionLog(
            phone_id=seeded_target.id, action_type="a", status="failed",
        ))
        session.commit()

        svc = _make_trigger_service(session, trigger_fields={"classification_type"})
        result = svc.evaluate_data_change_trigger(
            phone_id=seeded_target.id,
            updated_fields=["unrelated_field", "another_one"],
        )
        assert result is None

    def test_overlap_triggers(self, session, seeded_target):
        session.add(ActionLog(
            phone_id=seeded_target.id, action_type="a", status="failed",
        ))
        session.commit()

        svc = _make_trigger_service(session, trigger_fields={"classification_type"})
        result = svc.evaluate_data_change_trigger(
            phone_id=seeded_target.id,
            updated_fields=["classification_type", "ignored"],
        )
        assert result is not None

    def test_empty_allowlist_is_permissive(self, session, seeded_target):
        """Empty trigger_fields = no gate, ANY field can trigger."""
        session.add(ActionLog(
            phone_id=seeded_target.id, action_type="a", status="failed",
        ))
        session.commit()

        svc = _make_trigger_service(session, trigger_fields=set())
        result = svc.evaluate_data_change_trigger(
            phone_id=seeded_target.id,
            updated_fields=["anything"],
        )
        assert result is not None
