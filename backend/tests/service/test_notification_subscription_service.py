"""Service-layer tests for NotificationSubscriptionService."""

import pytest

from exceptions import NotificationSubscriptionNotFoundError
from models.notification import NotificationSubscription
from services.notifications import NotificationSubscriptionService
from repositories.storage import SqlStorage


@pytest.fixture()
def svc(session):
    return NotificationSubscriptionService(storage=SqlStorage(session))


# ---------------------------------------------------------------------------
# create — happy paths + invariants
# ---------------------------------------------------------------------------


class TestCreate:
    def test_minimal_scoped_subscription(self, svc, session):
        sub = svc.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="manager_1",
        )
        assert sub.id is not None
        assert sub.active is True       # default
        assert sub.title_template is None
        assert sub.body_template is None
        assert sub.created_at is not None

    def test_global_subscription_with_null_target_id(self, svc):
        sub = svc.create(
            trigger_event_type="system.heartbeat",
            target_kind="global", target_id=None,
            recipients=["all"], created_by="m",
        )
        assert sub.target_kind == "global"
        assert sub.target_id is None

    def test_recipients_stored_as_independent_list(self, svc):
        # Caller mutates after create — the row must not see the change.
        original = ["A", "B"]
        sub = svc.create(
            trigger_event_type="x", target_kind="phone", target_id=1,
            recipients=original, created_by="m",
        )
        original.append("C")
        assert sub.recipients == ["A", "B"]


# ---------------------------------------------------------------------------
# create — invariant violations → ValueError
# ---------------------------------------------------------------------------


class TestCreateInvariants:
    def test_unsupported_target_kind_raises(self, svc):
        with pytest.raises(ValueError, match="Unsupported target_kind"):
            svc.create(
                trigger_event_type="x", target_kind="phantom",
                target_id=1, recipients=["x"], created_by="m",
            )

    def test_scoped_without_target_id_raises(self, svc):
        with pytest.raises(ValueError, match="target_id is required"):
            svc.create(
                trigger_event_type="x", target_kind="phone",
                target_id=None, recipients=["x"], created_by="m",
            )

    def test_global_with_target_id_raises(self, svc):
        with pytest.raises(ValueError, match="must be NULL"):
            svc.create(
                trigger_event_type="x", target_kind="global",
                target_id=5, recipients=["x"], created_by="m",
            )

    def test_empty_recipients_raises(self, svc):
        with pytest.raises(ValueError, match="recipients must contain"):
            svc.create(
                trigger_event_type="x", target_kind="phone",
                target_id=1, recipients=[], created_by="m",
            )


# ---------------------------------------------------------------------------
# update — partial update + immutability of identity fields
# ---------------------------------------------------------------------------


class TestUpdate:
    def test_partial_update_only_writes_supplied_fields(self, svc):
        sub = svc.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=1,
            recipients=["ops"], created_by="m",
            title_template="X", body_template="Y",
        )
        # Patch only `active`. Title/body must be unchanged.
        updated = svc.update(sub.id, active=False)
        assert updated.active is False
        assert updated.title_template == "X"
        assert updated.body_template == "Y"
        assert updated.recipients == ["ops"]

    def test_update_recipients(self, svc):
        sub = svc.create(
            trigger_event_type="x", target_kind="phone",
            target_id=1, recipients=["ops"], created_by="m",
        )
        updated = svc.update(sub.id, recipients=["mgrs", "oncall"])
        assert updated.recipients == ["mgrs", "oncall"]

    def test_update_empty_recipients_raises(self, svc):
        sub = svc.create(
            trigger_event_type="x", target_kind="phone",
            target_id=1, recipients=["ops"], created_by="m",
        )
        with pytest.raises(ValueError, match="recipients must contain"):
            svc.update(sub.id, recipients=[])

    def test_update_missing_subscription_raises(self, svc):
        with pytest.raises(NotificationSubscriptionNotFoundError):
            svc.update(99999, active=False)


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


class TestDelete:
    def test_delete_removes_row(self, svc, session):
        sub = svc.create(
            trigger_event_type="x", target_kind="phone",
            target_id=1, recipients=["ops"], created_by="m",
        )
        svc.delete(sub.id)
        assert session.get(NotificationSubscription, sub.id) is None

    def test_delete_missing_raises(self, svc):
        with pytest.raises(NotificationSubscriptionNotFoundError):
            svc.delete(99999)


# ---------------------------------------------------------------------------
# list (filterable)
# ---------------------------------------------------------------------------


class TestList:
    def _seed(self, svc):
        # Two phone-scoped, one entity-scoped, one global, one inactive.
        a = svc.create(trigger_event_type="phone.ingested",  target_kind="phone",
                       target_id=1, recipients=["x"], created_by="m")
        b = svc.create(trigger_event_type="phone.action.failed", target_kind="phone",
                       target_id=2, recipients=["x"], created_by="m")
        c = svc.create(trigger_event_type="entity.created", target_kind="entity",
                       target_id=3, recipients=["x"], created_by="m")
        d = svc.create(trigger_event_type="phone.ingested",  target_kind="global",
                       target_id=None, recipients=["x"], created_by="m")
        e = svc.create(trigger_event_type="phone.ingested",  target_kind="phone",
                       target_id=4, recipients=["x"], created_by="m")
        svc.update(e.id, active=False)
        return a, b, c, d, e

    def test_no_filters_returns_all(self, svc):
        self._seed(svc)
        assert len(svc.list()) == 5

    def test_filter_by_target_kind(self, svc):
        self._seed(svc)
        phones = svc.list(target_kind="phone")
        assert all(s.target_kind == "phone" for s in phones)
        assert len(phones) == 3       # a, b, e (e is inactive but list doesn't filter)

    def test_filter_by_target_kind_and_id(self, svc):
        self._seed(svc)
        rows = svc.list(target_kind="phone", target_id=1)
        assert len(rows) == 1

    def test_filter_by_trigger_event(self, svc):
        self._seed(svc)
        rows = svc.list(trigger_event_type="phone.ingested")
        assert len(rows) == 3        # a, d (global), e (inactive included)

    def test_filter_by_active(self, svc):
        self._seed(svc)
        rows = svc.list(active=True)
        assert len(rows) == 4        # everything except e
        rows = svc.list(active=False)
        assert len(rows) == 1
