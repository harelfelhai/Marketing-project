"""
test_notifications_dual_backend.py — notification services on SQL and Mongo.

Pins the notification stack on both backends:
    - NotificationDispatcher.dispatch persists pending → sent/failed
    - NotificationSubscriptionService CRUD + filtered list + list_deliveries
    - EventDispatcher.fire matches (event AND active) AND (exact OR global)
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import NotificationSubscriptionNotFoundError
from interfaces.notifications import BaseNotificationChannel, DeliveryResult
from repositories.storage import MongoStorage, SqlStorage
from services.notifications import (
    EventDispatcher,
    NotificationDispatcher,
    NotificationSubscriptionService,
)


class _OKChannel(BaseNotificationChannel):
    def __init__(self):
        self.calls = []
    def deliver(self, *, recipients, title, body, metadata=None):
        self.calls.append(recipients)
        return DeliveryResult(success=True, provider_message_id="m-1",
                              error_detail=None, raw_response={"ok": True})


class _FailChannel(BaseNotificationChannel):
    def deliver(self, *, recipients, title, body, metadata=None):
        return DeliveryResult(success=False, provider_message_id=None,
                              error_detail="boom", raw_response=None)


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


class TestDispatcher:
    def test_success_marks_sent(self, storage):
        d = NotificationDispatcher(storage=storage, channel=_OKChannel())
        out = d.dispatch(trigger_event_type="e", title="t", body="b",
                         recipients=["a"], subscription_id=None)
        assert out.status == "sent"
        assert out.provider_message_id == "m-1"
        assert out.extra_data["raw_response"] == {"ok": True}

    def test_failure_marks_failed(self, storage):
        d = NotificationDispatcher(storage=storage, channel=_FailChannel())
        out = d.dispatch(trigger_event_type="e", title="t", body="b",
                         recipients=["a"], subscription_id=None)
        assert out.status == "failed"
        assert out.last_error == "boom"


class TestSubscriptionService:
    def test_create_get_update_delete(self, storage):
        svc = NotificationSubscriptionService(storage=storage)
        sub = svc.create(trigger_event_type="task.opened", target_kind="global",
                         target_id=None, recipients=["m"], created_by="op")
        assert svc.get(sub.id).id == sub.id
        upd = svc.update(sub.id, active=False)
        assert upd.active is False
        svc.delete(sub.id)
        with pytest.raises(NotificationSubscriptionNotFoundError):
            svc.get(sub.id)

    def test_create_global_with_target_id_rejected(self, storage):
        svc = NotificationSubscriptionService(storage=storage)
        with pytest.raises(ValueError):
            svc.create(trigger_event_type="e", target_kind="global",
                       target_id="t-1", recipients=["m"], created_by="op")

    def test_list_filters_and_order(self, storage):
        svc = NotificationSubscriptionService(storage=storage)
        svc.create(trigger_event_type="a", target_kind="global", target_id=None,
                   recipients=["m"], created_by="op")
        svc.create(trigger_event_type="b", target_kind="global", target_id=None,
                   recipients=["m"], created_by="op")
        only_a = svc.list(trigger_event_type="a")
        assert len(only_a) == 1 and only_a[0].trigger_event_type == "a"
        assert len(svc.list()) == 2

    def test_list_deliveries_filtered(self, storage):
        d = NotificationDispatcher(storage=storage, channel=_OKChannel())
        d.dispatch(trigger_event_type="e", title="t", body="b",
                   recipients=["a"], subscription_id="sub-1")
        svc = NotificationSubscriptionService(storage=storage)
        assert len(svc.list_deliveries(subscription_id="sub-1")) == 1
        assert len(svc.list_deliveries(subscription_id="sub-other")) == 0


class TestEventDispatcher:
    def _wire(self, storage):
        ch = _OKChannel()
        disp = NotificationDispatcher(storage=storage, channel=ch)
        evt = EventDispatcher(storage=storage, dispatcher=disp)
        subs = NotificationSubscriptionService(storage=storage)
        return ch, evt, subs

    def test_global_and_scoped_both_fire(self, storage):
        ch, evt, subs = self._wire(storage)
        subs.create(trigger_event_type="task.opened", target_kind="global",
                    target_id=None, recipients=["mgr"], created_by="op")
        subs.create(trigger_event_type="task.opened", target_kind="task",
                    target_id="t-7", recipients=["owner"], created_by="op")
        result = evt.fire("task.opened", context_kind="task", context_id="t-7",
                          default_title="T", default_body="B")
        assert len(result) == 2

    def test_inactive_subscription_does_not_fire(self, storage):
        ch, evt, subs = self._wire(storage)
        sub = subs.create(trigger_event_type="task.opened", target_kind="global",
                          target_id=None, recipients=["mgr"], created_by="op")
        subs.update(sub.id, active=False)
        result = evt.fire("task.opened", context_kind="task", context_id="t-7",
                          default_title="T", default_body="B")
        assert result == []

    def test_no_context_only_global_fires(self, storage):
        ch, evt, subs = self._wire(storage)
        subs.create(trigger_event_type="sys.event", target_kind="global",
                    target_id=None, recipients=["mgr"], created_by="op")
        subs.create(trigger_event_type="sys.event", target_kind="task",
                    target_id="t-7", recipients=["owner"], created_by="op")
        result = evt.fire("sys.event", default_title="T", default_body="B")
        assert len(result) == 1   # only the global one
