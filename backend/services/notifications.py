"""
services/notifications.py — Phase NOTIF service layer.

Three services, each with one architectural role:

    NotificationDispatcher
        Provider-agnostic delivery seam. Takes a Notification payload,
        persists a NotificationDelivery row, hands off to the injected
        channel module, records the outcome. Single writer to the
        delivery table.

    NotificationSubscriptionService
        CRUD over the persistent rules. The /subscriptions endpoints
        delegate here. Owns the `(target_kind, target_id)` invariant
        — target_id is required for scoped subscriptions and rejected
        for global ones.

    EventDispatcher
        The TRIGGER seam between business code and the rest of the
        pipeline. Future code that wants to notify says
        `event_dispatcher.fire('phone.ingested', context_kind='phone',
        context_id=N, default_title=..., default_body=...)`. The
        dispatcher resolves matching subscriptions + global rules,
        renders templates, and fan-outs to NotificationDispatcher.

WHY THESE ARE SEPARATE CLASSES
------------------------------
The boundary between them is the place we'll add infrastructure later
(async via APScheduler, retry / backoff, per-channel rate limiting).
Keeping each role on its own class lets those refinements land
without rewriting the call sites.

ASYNC NOTE
----------
NOTIF-A ships synchronous delivery — the channel call happens inline
inside `NotificationDispatcher.dispatch`. The mock channel never
fails, so this is safe in dev / tests. A real Slack / Teams adapter
would benefit from APScheduler-backed async delivery (same pattern
as RetryEngine for outbound actions). The dispatcher's row-first-
then-deliver order is already structured for that upgrade: the
'pending' row exists in the DB regardless of whether the channel
call succeeds, fails, or is deferred.
"""

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select as sa_select
from sqlmodel import Session, select

from exceptions import NotificationSubscriptionNotFoundError
from interfaces.notifications import BaseNotificationChannel
from models.notification import NotificationDelivery, NotificationSubscription


# Vocabulary of supported target kinds. Source of truth — the schema
# layer's regex pattern stays in lockstep with this set.
_SUPPORTED_TARGET_KINDS: frozenset[str] = frozenset({
    "phone", "entity", "task", "global",
})

# The trigger_event_type for ad-hoc deliveries that don't have a
# subscription behind them (smoke tests, future manual broadcasts).
EVENT_MANUAL_TEST = "manual.test"


# ===========================================================================
# NotificationDispatcher
# ===========================================================================


class NotificationDispatcher:
    """
    Provider-agnostic delivery seam.

    Lifecycle of one `dispatch()` call:
        1. INSERT a NotificationDelivery row with status='pending'.
        2. Call the channel's `deliver()` method.
        3. UPDATE the row to 'sent' (success) or 'failed' (failure)
           with attempted_at / delivered_at / provider_message_id /
           last_error / extra_data filled in.
        4. Commit.

    The row-first-then-deliver order is deliberate: even if the
    channel call hangs or the process dies between step 2 and step 3,
    the pending row exists for the next process-restart to reconcile.

    The dispatcher NEVER raises on channel failure — failures land
    on the row as `status='failed'` and the call returns the
    persisted row. Callers inspect `result.status` if they care.
    """

    def __init__(
        self,
        session: Session,
        channel: BaseNotificationChannel,
    ) -> None:
        """
        Args:
            session (Session):                  Active per-request DB session.
            channel (BaseNotificationChannel):  The configured chat-
                platform module (loaded via NOTIFICATION_MODULE env var
                in the dependency factory).
        """
        self.session = session
        self.channel = channel

    def dispatch(
        self,
        *,
        trigger_event_type: str,
        title: str,
        body: str,
        recipients: List[str],
        subscription_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> NotificationDelivery:
        """
        Persist a delivery row, fire the channel, record the outcome.

        Args:
            trigger_event_type (str): Snapshotted onto the delivery row.
            title (str):              Pre-rendered title.
            body (str):               Pre-rendered body.
            recipients (List[str]):   Opaque chat-platform tokens.
            subscription_id (Optional[int]): NULL for ad-hoc fires
                (test endpoint, manual broadcasts).
            metadata (Optional[dict]): Passed through to the channel's
                `deliver()` call. NOT stored on the delivery row;
                that's the channel's `raw_response` job.

        Returns:
            NotificationDelivery: The persisted, refreshed row. Inspect
            `.status` to see the outcome.
        """
        # Step 1 — INSERT pending row. This is the audit guarantee:
        # even a channel hang doesn't lose the fact that a fire was
        # attempted.
        delivery = NotificationDelivery(
            subscription_id=subscription_id,
            trigger_event_type=trigger_event_type,
            title=title,
            body=body,
            recipients=list(recipients),
            status="pending",
            retry_count=0,
        )
        self.session.add(delivery)
        self.session.commit()
        self.session.refresh(delivery)

        # Step 2 — channel call. The contract says implementations
        # NEVER raise. We still wrap in a defensive try/except so a
        # buggy third-party module can't blow up the request.
        attempted_at = datetime.now(timezone.utc)
        try:
            result = self.channel.deliver(
                recipients=list(recipients),
                title=title,
                body=body,
                metadata=metadata,
            )
        except Exception as exc:    # noqa: BLE001 — defensive boundary
            result = _failure_from_exception(exc)

        # Step 3 — UPDATE with the outcome.
        delivery.attempted_at = attempted_at
        delivery.updated_at = attempted_at
        delivery.provider_message_id = result.provider_message_id
        if result.success:
            delivery.status = "sent"
            delivery.delivered_at = attempted_at
            delivery.last_error = None
        else:
            delivery.status = "failed"
            delivery.last_error = result.error_detail

        # Stash raw provider response (Slack JSON, Teams envelope, etc.)
        # for postmortems without bloating the structured columns.
        if result.raw_response is not None:
            merged = dict(delivery.extra_data or {})
            merged["raw_response"] = result.raw_response
            delivery.extra_data = merged

        self.session.add(delivery)
        self.session.commit()
        self.session.refresh(delivery)
        return delivery


def _failure_from_exception(exc: Exception):
    """
    Convert an unexpected channel-side exception into a DeliveryResult-
    shaped failure. Local helper so the dispatcher stays clean.
    """
    from interfaces.notifications import DeliveryResult
    return DeliveryResult(
        success=False,
        provider_message_id=None,
        error_detail=f"channel raised: {type(exc).__name__}: {exc}"[:200],
        raw_response=None,
    )


# ===========================================================================
# NotificationSubscriptionService
# ===========================================================================


class NotificationSubscriptionService:
    """
    Sole writer + canonical reader for the NotificationSubscription table.

    The /subscriptions API endpoints delegate every CRUD operation
    here so the (target_kind, target_id) invariant lives in one place.
    """

    def __init__(self, session: Session) -> None:
        self.session = session

    # ----------------------------------------------------------------
    # Writers
    # ----------------------------------------------------------------

    def create(
        self,
        *,
        trigger_event_type: str,
        target_kind: str,
        target_id: Optional[str],
        recipients: List[str],
        created_by: str,
        title_template: Optional[str] = None,
        body_template: Optional[str] = None,
        extra_data: Optional[dict] = None,
    ) -> NotificationSubscription:
        """
        Insert one subscription. Enforces the target_kind / target_id
        invariant (target_id required iff target_kind != 'global').

        Args:
            trigger_event_type (str): Free-form event token. Stored
                verbatim — vocabulary lives frontend-side.
            target_kind (str): One of `_SUPPORTED_TARGET_KINDS`. The
                schema layer validates this; we double-check
                defensively because callers from tests or future
                internal scripts may bypass the schema.
            target_id (Optional[int]): Required for non-global
                subscriptions; rejected for global ones (ValueError).
            recipients (List[str]): Opaque tokens. Non-empty (the
                schema enforces min_length=1; defensive empty-check
                here in case a direct caller skips it).
            created_by (str): operator_id.
            title_template/body_template/extra_data: optional pass-through.

        Returns:
            NotificationSubscription: The committed row.

        Raises:
            ValueError: target_kind / target_id mismatch, or unsupported
                target_kind / empty recipients.
        """
        if target_kind not in _SUPPORTED_TARGET_KINDS:
            raise ValueError(
                f"Unsupported target_kind '{target_kind}'. "
                f"Allowed: {', '.join(sorted(_SUPPORTED_TARGET_KINDS))}."
            )
        if target_kind == "global" and target_id is not None:
            raise ValueError(
                "target_id must be NULL when target_kind='global'."
            )
        if target_kind != "global" and target_id is None:
            raise ValueError(
                f"target_id is required when target_kind='{target_kind}'."
            )
        if not recipients:
            raise ValueError("recipients must contain at least one entry.")

        sub = NotificationSubscription(
            trigger_event_type=trigger_event_type,
            target_kind=target_kind,
            target_id=target_id,
            recipients=list(recipients),
            title_template=title_template,
            body_template=body_template,
            active=True,
            created_by=created_by,
            extra_data=extra_data,
        )
        self.session.add(sub)
        self.session.commit()
        self.session.refresh(sub)
        return sub

    def update(
        self,
        subscription_id: str,
        *,
        recipients: Optional[List[str]] = None,
        title_template: Optional[str] = None,
        body_template: Optional[str] = None,
        active: Optional[bool] = None,
        extra_data: Optional[dict] = None,
    ) -> NotificationSubscription:
        """
        Apply a partial update. Only non-None args are written.

        Trigger / target fields are intentionally NOT updatable — they
        define the subscription's identity. To re-scope, delete and
        re-create.
        """
        sub = self.session.get(NotificationSubscription, subscription_id)
        if sub is None:
            raise NotificationSubscriptionNotFoundError(subscription_id)

        if recipients is not None:
            if not recipients:
                raise ValueError("recipients must contain at least one entry.")
            sub.recipients = list(recipients)
        if title_template is not None:
            sub.title_template = title_template
        if body_template is not None:
            sub.body_template = body_template
        if active is not None:
            sub.active = active
        if extra_data is not None:
            sub.extra_data = extra_data

        sub.updated_at = datetime.now(timezone.utc)
        self.session.add(sub)
        self.session.commit()
        self.session.refresh(sub)
        return sub

    def delete(self, subscription_id: str) -> None:
        """
        Hard-delete the subscription. Historical NotificationDelivery
        rows are NOT cascaded — they remain for audit (subscription_id
        becomes a dangling FK that the read layer tolerates).
        """
        sub = self.session.get(NotificationSubscription, subscription_id)
        if sub is None:
            raise NotificationSubscriptionNotFoundError(subscription_id)
        self.session.delete(sub)
        self.session.commit()

    # ----------------------------------------------------------------
    # Readers
    # ----------------------------------------------------------------

    def get(self, subscription_id: str) -> NotificationSubscription:
        """Fetch by id or raise NotificationSubscriptionNotFoundError."""
        sub = self.session.get(NotificationSubscription, subscription_id)
        if sub is None:
            raise NotificationSubscriptionNotFoundError(subscription_id)
        return sub

    def list(
        self,
        *,
        target_kind: Optional[str] = None,
        target_id: Optional[str] = None,
        trigger_event_type: Optional[str] = None,
        active: Optional[bool] = None,
    ) -> List[NotificationSubscription]:
        """
        Filterable listing. All filters are additive (AND). Each is
        optional — call with no args to get every subscription
        ordered most-recent-first.
        """
        stmt = select(NotificationSubscription)
        if target_kind is not None:
            stmt = stmt.where(NotificationSubscription.target_kind == target_kind)
        if target_id is not None:
            stmt = stmt.where(NotificationSubscription.target_id == target_id)
        if trigger_event_type is not None:
            stmt = stmt.where(
                NotificationSubscription.trigger_event_type == trigger_event_type
            )
        if active is not None:
            stmt = stmt.where(NotificationSubscription.active == active)
        stmt = stmt.order_by(NotificationSubscription.created_at.desc())
        return list(self.session.exec(stmt).all())

    def list_deliveries(
        self,
        *,
        subscription_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> List[NotificationDelivery]:
        """
        Read-only audit listing. Used by the GET /deliveries endpoint.
        Newest-first; capped at `limit` rows per call.
        """
        stmt = select(NotificationDelivery)
        if subscription_id is not None:
            stmt = stmt.where(NotificationDelivery.subscription_id == subscription_id)
        if status is not None:
            stmt = stmt.where(NotificationDelivery.status == status)
        stmt = stmt.order_by(NotificationDelivery.created_at.desc()).limit(limit)
        return list(self.session.exec(stmt).all())


# ===========================================================================
# EventDispatcher — the trigger seam business code calls into
# ===========================================================================


class EventDispatcher:
    """
    Wraps subscription lookup + template rendering + fan-out.

    Business code (future ingestion / verification / task flows) call
    `fire(event_type, context_kind=..., context_id=..., default_title=...,
    default_body=...)`. The dispatcher does the rest:

        1. Lookup matching subscriptions:
           - exact target match (target_kind, target_id)
           - + global subscriptions (target_kind='global', target_id NULL)
           - filtered to active=True and matching trigger_event_type.
        2. For each subscription, render title/body — the subscription's
           own template wins over the caller-supplied default.
        3. Call NotificationDispatcher.dispatch() per matching sub.

    Returns the list of NotificationDelivery rows created. Empty list
    when no subscriptions matched — that's a normal no-op, not an error.
    """

    def __init__(
        self,
        session: Session,
        dispatcher: NotificationDispatcher,
    ) -> None:
        self.session = session
        self.dispatcher = dispatcher

    def fire(
        self,
        event_type: str,
        *,
        context_kind: Optional[str] = None,
        context_id: Optional[str] = None,
        default_title: str,
        default_body: str,
        payload: Optional[dict] = None,
    ) -> List[NotificationDelivery]:
        """
        Match → render → dispatch fan-out for one event.

        Args:
            event_type (str): The trigger token (e.g. 'phone.ingested').
                Matched against NotificationSubscription.trigger_event_type
                with exact equality. Future wildcard / hierarchy support
                lives here, NOT on the subscription model.
            context_kind (Optional[str]): What kind of record raised
                the event. Only subscriptions targeting this kind AND
                global subscriptions match. None → only global subs
                match (use this for system-level events with no
                associated record).
            context_id (Optional[int]): FK of the raising record.
                Required when context_kind is set.
            default_title (str): Used when a matching subscription has
                no `title_template`. The caller is the source of
                truth for the default — it has the event payload in
                hand and can render the friendliest message.
            default_body (str): Same fallback semantics for the body.
            payload (Optional[dict]): Variables available to template
                rendering (e.g. {'phone_number': '+1...', 'client_id': 7}).
                Used as kwargs to str.format() on the templates. Missing
                keys in a template degrade to the raw default (so a
                buggy template doesn't drop the alert entirely).

        Returns:
            List[NotificationDelivery]: One row per matched subscription.
            Empty when nothing matched — operators see no alerts but
            no error either.
        """
        # Build the (event AND active AND (exact-match OR global))
        # subscription set in ONE query. SQLAlchemy's `or_` keeps
        # the indexed event lookup as the leading clause so the
        # exact-target / global branches both ride the same index.
        stmt = (
            sa_select(NotificationSubscription)
            .where(NotificationSubscription.trigger_event_type == event_type)
            .where(NotificationSubscription.active.is_(True))
        )
        match_filters = [NotificationSubscription.target_kind == "global"]
        if context_kind is not None and context_id is not None:
            from sqlalchemy import and_, or_
            match_filters.append(
                and_(
                    NotificationSubscription.target_kind == context_kind,
                    NotificationSubscription.target_id == context_id,
                )
            )
            stmt = stmt.where(or_(*match_filters))
        else:
            # No context — only global subscriptions are eligible.
            stmt = stmt.where(NotificationSubscription.target_kind == "global")

        subs = list(self.session.execute(stmt).scalars())

        if not subs:
            return []

        deliveries: List[NotificationDelivery] = []
        for sub in subs:
            title = _render_template(sub.title_template, default_title, payload)
            body  = _render_template(sub.body_template,  default_body,  payload)
            delivery = self.dispatcher.dispatch(
                trigger_event_type=event_type,
                title=title,
                body=body,
                recipients=list(sub.recipients or []),
                subscription_id=sub.id,
                metadata={
                    "context_kind": context_kind,
                    "context_id":   context_id,
                    "payload":      payload,
                },
            )
            deliveries.append(delivery)
        return deliveries


def _render_template(
    template: Optional[str],
    fallback: str,
    payload: Optional[dict],
) -> str:
    """
    Render a Python format-string template against the event payload,
    degrading to the fallback on any error.

    Why degrade rather than raise: a buggy operator-saved template
    (wrong variable name, malformed braces) must NEVER swallow an
    alert. The fallback is the caller's friendliest rendering of the
    same event; better to send that than nothing.
    """
    if template is None:
        return fallback
    try:
        return template.format(**(payload or {}))
    except (KeyError, IndexError, ValueError):
        return fallback
