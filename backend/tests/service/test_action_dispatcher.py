"""Service-layer tests for ActionDispatcher."""

from datetime import datetime, timedelta

import pytest

from exceptions import PhoneNumberNotFoundError
from models.action_log import ActionLog
from services.dispatcher import ActionDispatcher

from tests.conftest import FailingHandler, RecordingHandler
from repositories.storage import SqlStorage


def _make_dispatcher(session, default_handler=None, handlers=None,
                    max_retry=3, backoff=60):
    return ActionDispatcher(
        storage=SqlStorage(session),
        handlers=handlers or {},
        default_handler=default_handler,
        max_retry_count=max_retry,
        retry_backoff_seconds=backoff,
    )


class TestDispatchSuccessPath:
    def test_status_transitions_pending_to_sent(self, session, seeded_target):
        handler = RecordingHandler()
        d = _make_dispatcher(session, default_handler=handler)
        log = d.dispatch(phone_id=seeded_target.id, action_type="adv_a")
        assert log.status == "sent"
        assert log.executed_at is not None
        assert log.extra_data["recorded"] is True
        assert log.retry_count == 0

    def test_handler_receives_phone_number_string(self, session, seeded_target):
        handler = RecordingHandler()
        d = _make_dispatcher(session, default_handler=handler)
        d.dispatch(phone_id=seeded_target.id, action_type="adv_a")
        assert handler.calls[0][0] == seeded_target.phone_number


class TestRetryableFailurePath:
    def test_first_retryable_failure_schedules_retry(self, session, seeded_target):
        handler = FailingHandler(retryable=True, detail="timeout")
        d = _make_dispatcher(session, default_handler=handler, backoff=120)
        before = datetime.utcnow()
        log = d.dispatch(phone_id=seeded_target.id, action_type="adv_a")
        assert log.status == "scheduled_retry"
        assert log.retry_count == 1
        assert log.retry_after >= before + timedelta(seconds=120) - timedelta(seconds=2)
        assert log.extra_data["retryable"] is True
        assert log.extra_data["error_detail"] == "timeout"

    def test_max_retry_ceiling_transitions_to_failed(self, session, seeded_target):
        """When retry_count is already at the ceiling, next retryable failure → failed."""
        handler = FailingHandler(retryable=True)
        d = _make_dispatcher(session, default_handler=handler, max_retry=2)
        # First dispatch: retry_count 0 → 1, scheduled_retry
        log = d.dispatch(phone_id=seeded_target.id, action_type="adv_a")
        # Manually re-execute twice more via execute_pending
        log = d.execute_pending(log)
        assert log.retry_count == 2
        assert log.status == "scheduled_retry"
        # Third execute would push above ceiling
        log = d.execute_pending(log)
        assert log.status == "failed"

    def test_non_retryable_failure_goes_directly_to_failed(self, session, seeded_target):
        handler = FailingHandler(retryable=False, detail="invalid number")
        d = _make_dispatcher(session, default_handler=handler)
        log = d.dispatch(phone_id=seeded_target.id, action_type="adv_a")
        assert log.status == "failed"
        assert log.retry_count == 0  # never incremented for non-retryable
        assert log.retry_after is None
        assert log.extra_data["error_detail"] == "invalid number"


class TestHandlerResolution:
    def test_registry_hit_takes_priority_over_default(self, session, seeded_target):
        registered = RecordingHandler()
        default = RecordingHandler()
        d = _make_dispatcher(
            session,
            handlers={"specific": registered},
            default_handler=default,
        )
        d.dispatch(phone_id=seeded_target.id, action_type="specific")
        assert len(registered.calls) == 1
        assert len(default.calls) == 0

    def test_default_used_when_action_type_not_registered(self, session, seeded_target):
        default = RecordingHandler()
        d = _make_dispatcher(session, default_handler=default)
        d.dispatch(phone_id=seeded_target.id, action_type="unknown_token")
        assert len(default.calls) == 1

    def test_no_handler_raises_value_error_and_marks_failed(self, session, seeded_target):
        d = _make_dispatcher(session, default_handler=None, handlers={})
        with pytest.raises(ValueError):
            d.dispatch(phone_id=seeded_target.id, action_type="missing")
        # The log row exists and is marked failed.
        from sqlmodel import select
        logs = session.exec(select(ActionLog).where(
            ActionLog.phone_id == seeded_target.id
        )).all()
        assert len(logs) == 1
        assert logs[0].status == "failed"


class TestPhoneLookup:
    def test_missing_phone_raises_not_found(self, session):
        d = _make_dispatcher(session, default_handler=RecordingHandler())
        with pytest.raises(PhoneNumberNotFoundError):
            d.dispatch(phone_id=99999, action_type="x")
