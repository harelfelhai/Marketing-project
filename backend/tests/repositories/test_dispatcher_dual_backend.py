"""
test_dispatcher_dual_backend.py — dispatcher classes on SQL and Mongo.

Pins the Phase 2 dispatch lifecycle on both backends:
    - ActionDispatcher.dispatch: success → 'sent'; retryable failure →
      'scheduled_retry' with backoff; ceiling → 'failed'; no handler → 'failed' + raise
    - UserActionService stamps operator attribution
    - RetryEngine optimistic claim re-dispatches eligible rows
    - ActionDataTriggerService re-dispatches the latest failed action
"""

from datetime import datetime, timedelta

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import ActionExecutionError, PhoneNumberNotFoundError
from interfaces.dispatcher import BaseActionHandler
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from repositories.storage import MongoStorage, SqlStorage
from services.dispatcher import (
    ActionDataTriggerService,
    ActionDispatcher,
    RetryEngine,
    UserActionService,
)


class _OK(BaseActionHandler):
    def __init__(self):
        self.calls = []
    def execute(self, phone_number, extra_data):
        self.calls.append(phone_number)
        return {"ok": True}


class _Fail(BaseActionHandler):
    def __init__(self, retryable=True):
        self.retryable = retryable
    def execute(self, phone_number, extra_data):
        raise ActionExecutionError(action_type="x", phone_number=phone_number,
                                   retryable=self.retryable, detail="boom")


@pytest.fixture(params=["sql", "mongo"])
def storage(request):
    if request.param == "sql":
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                               poolclass=StaticPool)
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield SqlStorage(session)
    else:
        yield MongoStorage(mongomock.MongoClient()["test"])


def _phone(storage, number="+15550000001"):
    ent = storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                      extra_data={}))
    return storage.phones.add(PhoneNumber(entity_id=ent.id, phone_number=number,
                                          ingestion_source="manual"))


class TestDispatch:
    def test_success_marks_sent(self, storage):
        phone = _phone(storage)
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        log = d.dispatch(phone.id, "outreach_a")
        assert log.status == "sent"
        assert storage.action_logs.get(log.id).status == "sent"

    def test_retryable_failure_schedules_retry(self, storage):
        phone = _phone(storage)
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_Fail(True),
                             max_retry_count=3, retry_backoff_seconds=60)
        log = d.dispatch(phone.id, "outreach_a")
        assert log.status == "scheduled_retry"
        assert log.retry_count == 1
        assert log.retry_after is not None

    def test_ceiling_marks_failed(self, storage):
        phone = _phone(storage)
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_Fail(True),
                             max_retry_count=0)
        log = d.dispatch(phone.id, "outreach_a")
        assert log.status == "failed"

    def test_no_handler_marks_failed_and_raises(self, storage):
        phone = _phone(storage)
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=None)
        with pytest.raises(ValueError):
            d.dispatch(phone.id, "outreach_a")
        logs = storage.action_logs.list({"phone_id": phone.id})
        assert len(logs) == 1 and logs[0].status == "failed"

    def test_unknown_phone_raises(self, storage):
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        with pytest.raises(PhoneNumberNotFoundError):
            d.dispatch("ph-nope", "outreach_a")


class TestUserAction:
    def test_operator_attribution_persisted(self, storage):
        phone = _phone(storage)
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        svc = UserActionService(storage=storage, dispatcher=d)
        log = svc.trigger_manual_action(phone.id, "outreach_a", operator_id="alice")
        assert log.extra_data["triggered_by_operator"] == "alice"
        assert storage.action_logs.get(log.id).extra_data["triggered_by_operator"] == "alice"


class TestRetryEngine:
    def test_claims_and_redispatches_eligible(self, storage):
        phone = _phone(storage)
        # A due scheduled_retry row.
        storage.action_logs.add(ActionLog(
            phone_id=phone.id, action_type="outreach_a", status="scheduled_retry",
            retry_count=1, retry_after=datetime.utcnow() - timedelta(minutes=5),
        ))
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        engine = RetryEngine(storage=storage, dispatcher=d)
        count = engine.process_scheduled_retries()
        assert count == 1

    def test_not_yet_due_is_skipped(self, storage):
        phone = _phone(storage)
        storage.action_logs.add(ActionLog(
            phone_id=phone.id, action_type="outreach_a", status="scheduled_retry",
            retry_count=1, retry_after=datetime.utcnow() + timedelta(hours=1),
        ))
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        engine = RetryEngine(storage=storage, dispatcher=d)
        assert engine.process_scheduled_retries() == 0


class TestDataTrigger:
    def test_redispatches_latest_failed(self, storage):
        phone = _phone(storage)
        storage.action_logs.add(ActionLog(
            phone_id=phone.id, action_type="outreach_b", status="failed",
            requested_at=datetime.utcnow(),
        ))
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        svc = ActionDataTriggerService(storage=storage, dispatcher=d)
        out = svc.evaluate_data_change_trigger(phone.id, updated_fields=["classification_type"])
        assert out is not None
        assert out.action_type == "outreach_b"
        assert out.status == "sent"

    def test_no_failed_action_returns_none(self, storage):
        phone = _phone(storage)
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        svc = ActionDataTriggerService(storage=storage, dispatcher=d)
        assert svc.evaluate_data_change_trigger(phone.id, updated_fields=["x"]) is None

    def test_trigger_fields_gate(self, storage):
        phone = _phone(storage)
        storage.action_logs.add(ActionLog(
            phone_id=phone.id, action_type="outreach_b", status="failed",
            requested_at=datetime.utcnow(),
        ))
        d = ActionDispatcher(storage=storage, handlers={}, default_handler=_OK())
        svc = ActionDataTriggerService(storage=storage, dispatcher=d,
                                       trigger_fields={"classification_type"})
        # Updated field not in the allowlist → no re-dispatch.
        assert svc.evaluate_data_change_trigger(phone.id, updated_fields=["other"]) is None
