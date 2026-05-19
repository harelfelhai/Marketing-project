"""Service-layer tests for NotificationDispatcher + EventDispatcher."""

import pytest

from interfaces.notifications import BaseNotificationChannel, DeliveryResult
from models.notification import NotificationDelivery, NotificationSubscription
from services.notifications import (
    EVENT_MANUAL_TEST,
    EventDispatcher,
    NotificationDispatcher,
    NotificationSubscriptionService,
)


# ---------------------------------------------------------------------------
# Test doubles — pluggable channels
# ---------------------------------------------------------------------------


class RecordingChannel(BaseNotificationChannel):
    """Always succeeds; records every call for assertions."""

    def __init__(self):
        self.calls = []

    def deliver(self, *, recipients, title, body, metadata=None):
        self.calls.append({
            "recipients": list(recipients),
            "title": title,
            "body": body,
            "metadata": metadata,
        })
        return DeliveryResult(
            success=True,
            provider_message_id=f"prov_{len(self.calls)}",
            error_detail=None,
            raw_response={"recorded": True},
        )


class FailingChannel(BaseNotificationChannel):
    """Always returns success=False with a configurable error_detail."""

    def __init__(self, detail="provider timeout"):
        self.detail = detail
        self.calls = []

    def deliver(self, *, recipients, title, body, metadata=None):
        self.calls.append((recipients, title, body))
        return DeliveryResult(
            success=False,
            provider_message_id=None,
            error_detail=self.detail,
            raw_response={"error_envelope": True},
        )


class RaisingChannel(BaseNotificationChannel):
    """Raises — the dispatcher's defensive try/except must catch this."""

    def deliver(self, *, recipients, title, body, metadata=None):
        raise RuntimeError("buggy third-party channel module")


# ---------------------------------------------------------------------------
# NotificationDispatcher
# ---------------------------------------------------------------------------


class TestDispatcherHappyPath:
    def test_dispatch_persists_pending_then_sent_row(self, session):
        ch = RecordingChannel()
        disp = NotificationDispatcher(session=session, channel=ch)
        delivery = disp.dispatch(
            trigger_event_type="phone.ingested",
            title="Phone added",
            body="A new phone was added.",
            recipients=["ops-alerts"],
        )
        assert delivery.id is not None
        assert delivery.status == "sent"
        assert delivery.delivered_at is not None
        assert delivery.attempted_at is not None
        assert delivery.provider_message_id == "prov_1"
        assert delivery.last_error is None
        # Channel was called once.
        assert len(ch.calls) == 1
        assert ch.calls[0]["recipients"] == ["ops-alerts"]

    def test_snapshotted_recipients_persist_independently_of_channel(
        self, session
    ):
        # The DB row stores its OWN copy of recipients — the channel's
        # later edits to its arg don't retroactively change the audit.
        ch = RecordingChannel()
        disp = NotificationDispatcher(session=session, channel=ch)
        original = ["A", "B"]
        delivery = disp.dispatch(
            trigger_event_type="manual.test",
            title="t", body="b",
            recipients=original,
        )
        original.append("C")
        session.expire_all()
        from sqlmodel import select
        reread = session.exec(
            select(NotificationDelivery).where(NotificationDelivery.id == delivery.id)
        ).first()
        assert reread.recipients == ["A", "B"]

    def test_raw_response_lands_in_extra_data(self, session):
        ch = RecordingChannel()
        disp = NotificationDispatcher(session=session, channel=ch)
        delivery = disp.dispatch(
            trigger_event_type="manual.test", title="t", body="b",
            recipients=["X"],
        )
        assert delivery.extra_data["raw_response"] == {"recorded": True}


class TestDispatcherFailurePaths:
    def test_failed_delivery_records_status_and_error(self, session):
        ch = FailingChannel(detail="webhook returned 500")
        disp = NotificationDispatcher(session=session, channel=ch)
        delivery = disp.dispatch(
            trigger_event_type="phone.action.failed",
            title="t", body="b", recipients=["X"],
        )
        assert delivery.status == "failed"
        assert delivery.delivered_at is None         # never delivered
        assert delivery.attempted_at is not None     # but we tried
        assert "500" in delivery.last_error

    def test_channel_that_raises_is_caught_and_recorded_as_failure(
        self, session,
    ):
        # The ABC contract says channels MUST NOT raise, but a buggy
        # third-party module might. The dispatcher's defensive
        # try/except keeps the system stable.
        disp = NotificationDispatcher(session=session, channel=RaisingChannel())
        delivery = disp.dispatch(
            trigger_event_type="manual.test",
            title="t", body="b", recipients=["X"],
        )
        assert delivery.status == "failed"
        assert "RuntimeError" in delivery.last_error
        assert "buggy third-party channel" in delivery.last_error


# ---------------------------------------------------------------------------
# EventDispatcher
# ---------------------------------------------------------------------------


@pytest.fixture()
def event_setup(session):
    """Provides dispatcher + event_dispatcher + sub_service in one place."""
    ch = RecordingChannel()
    disp = NotificationDispatcher(session=session, channel=ch)
    evt = EventDispatcher(session=session, dispatcher=disp)
    subs = NotificationSubscriptionService(session=session)
    return ch, disp, evt, subs


class TestEventDispatcherMatching:
    def test_no_subscriptions_matched_returns_empty_list(self, event_setup):
        _, _, evt, _ = event_setup
        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=99,
            default_title="t", default_body="b",
        )
        assert result == []

    def test_exact_target_match_fires(self, session, event_setup):
        ch, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"],
            created_by="manager_1",
        )
        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=42,
            default_title="Phone added",
            default_body="...",
        )
        assert len(result) == 1
        assert result[0].status == "sent"
        assert len(ch.calls) == 1

    def test_different_target_id_does_not_fire(self, event_setup):
        ch, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="m",
        )
        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=99,
            default_title="t", default_body="b",
        )
        assert result == []
        assert ch.calls == []

    def test_global_subscription_fires_regardless_of_context(self, event_setup):
        ch, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="global", target_id=None,
            recipients=["ops-alerts"], created_by="m",
        )
        # Fire with one context …
        evt.fire("phone.ingested", context_kind="phone", context_id=1,
                 default_title="t", default_body="b")
        # … and another. Both should hit the global subscription.
        evt.fire("phone.ingested", context_kind="phone", context_id=2,
                 default_title="t", default_body="b")
        assert len(ch.calls) == 2

    def test_global_and_scoped_both_fire_for_matching_event(self, event_setup):
        ch, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="task.opened",
            target_kind="global", target_id=None,
            recipients=["all-managers"], created_by="m",
        )
        subs.create(
            trigger_event_type="task.opened",
            target_kind="task", target_id=7,
            recipients=["task-owner"], created_by="m",
        )
        result = evt.fire(
            "task.opened",
            context_kind="task", context_id=7,
            default_title="New task", default_body="...",
        )
        # Both subscriptions matched.
        assert len(result) == 2

    def test_inactive_subscription_is_skipped(self, event_setup, session):
        ch, _, evt, subs = event_setup
        sub = subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="m",
        )
        # Toggle off.
        subs.update(sub.id, active=False)

        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=42,
            default_title="t", default_body="b",
        )
        assert result == []

    def test_different_event_type_does_not_fire(self, event_setup):
        ch, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="m",
        )
        # Fire a different event on the same target.
        result = evt.fire(
            "phone.verification.changed",
            context_kind="phone", context_id=42,
            default_title="t", default_body="b",
        )
        assert result == []

    def test_event_without_context_only_matches_global_subscriptions(
        self, event_setup,
    ):
        ch, _, evt, subs = event_setup
        # Scoped subscription — should NOT match a context-less fire.
        subs.create(
            trigger_event_type="system.heartbeat",
            target_kind="phone", target_id=1,
            recipients=["x"], created_by="m",
        )
        # Global subscription — should match.
        subs.create(
            trigger_event_type="system.heartbeat",
            target_kind="global", target_id=None,
            recipients=["y"], created_by="m",
        )
        result = evt.fire(
            "system.heartbeat",
            default_title="ping", default_body="...",
        )
        assert len(result) == 1
        assert result[0].recipients == ["y"]


class TestEventDispatcherTemplating:
    def test_subscription_template_overrides_default(self, event_setup):
        _, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="m",
            title_template="Custom: {phone_number}",
            body_template="Body: {phone_number} for client {client_id}",
        )
        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=42,
            default_title="DEFAULT_TITLE",
            default_body="DEFAULT_BODY",
            payload={"phone_number": "+15551234", "client_id": 7},
        )
        assert result[0].title == "Custom: +15551234"
        assert result[0].body == "Body: +15551234 for client 7"

    def test_missing_template_uses_caller_default(self, event_setup):
        _, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="m",
            # No templates.
        )
        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=42,
            default_title="DT", default_body="DB",
        )
        assert result[0].title == "DT"
        assert result[0].body == "DB"

    def test_broken_template_degrades_to_default(self, event_setup):
        """A buggy template (wrong variable) must NEVER drop the alert.
        Degrades silently to the caller's default."""
        _, _, evt, subs = event_setup
        subs.create(
            trigger_event_type="phone.ingested",
            target_kind="phone", target_id=42,
            recipients=["ops"], created_by="m",
            title_template="Hi {nonexistent_variable}",
        )
        result = evt.fire(
            "phone.ingested",
            context_kind="phone", context_id=42,
            default_title="SAFE_DEFAULT",
            default_body="b",
            payload={"phone_number": "+1"},
        )
        # Degraded — not raised, not empty.
        assert result[0].title == "SAFE_DEFAULT"


# ---------------------------------------------------------------------------
# Manual test fire — the operator smoke-test contract
# ---------------------------------------------------------------------------


class TestManualTestFire:
    def test_dispatcher_directly_creates_subscriptionless_delivery(self, session):
        ch = RecordingChannel()
        disp = NotificationDispatcher(session=session, channel=ch)
        delivery = disp.dispatch(
            trigger_event_type=EVENT_MANUAL_TEST,
            title="Pipe check",
            body="Validating the chat channel.",
            recipients=["#smoke-test"],
            subscription_id=None,
        )
        assert delivery.subscription_id is None
        assert delivery.trigger_event_type == "manual.test"
        assert delivery.status == "sent"
