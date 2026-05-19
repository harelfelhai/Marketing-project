"""
models/notification.py — Tables backing Phase NOTIF (chat notifications).

Two tables, two responsibilities:

    NotificationSubscription
        The persistent RULE: "send me an alert when event X fires for
        record Y." Operators create / edit / disable these inline at
        the end of workflows (NotificationOptInPanel UX).

    NotificationDelivery
        One row per FIRE. Audit trail + retry state. Created by the
        dispatcher every time a trigger event matches a subscription
        (or an ad-hoc test-fire is requested). Status transitions
        ('pending' → 'sent' / 'failed') are owned exclusively by the
        NotificationDispatcher service.

WHY TWO TABLES
--------------
Conflating rule + event in one row would force replicating recipients,
templates, and trigger metadata on every fire — and lose them when
the subscription is later edited. Splitting them keeps each table
narrow and lets operators toggle a subscription off (`active=False`)
without losing history.

PRIVACY CONTRACT
----------------
Same Secrets-Free Mandate as everything else: the structured columns
hold only generic lifecycle state, opaque recipient tokens, and
controlled-vocabulary event strings. Display names for chat channels
live frontend-side in `chatChannelRegistry.js`; proprietary provider
payloads (Slack thread ids, raw API responses) live inside
`extra_data` JSON.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from models.types import UTCDateTime, utc_now as _utc_now


# ===========================================================================
# NotificationSubscription
# ===========================================================================


class NotificationSubscription(SQLModel, table=True):
    """
    A persistent "alert me when X happens" rule, attached to a phone /
    entity / task / global scope.

    Two operator-driven lifecycle transitions are supported:
        * `active=True → False`  — pause the rule without losing it
        * deletion                — hard remove via DELETE endpoint

    The dispatcher reads ONLY active rows at fire time, so a
    `active=False` row is a perfect no-op without code paths checking
    the flag explicitly.
    """

    __tablename__ = "notification_subscription"

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing primary key.",
    )

    # ------------------------------------------------------------------
    # Trigger classification
    # ------------------------------------------------------------------

    trigger_event_type: str = Field(
        index=True,
        nullable=False,
        description=(
            "Free-form indexed string identifying which event the rule "
            "fires on. Current example vocabulary (NOT enforced at DB "
            "level — finalized when business defines triggers): "
            "'phone.ingested' | 'phone.verification.changed' | "
            "'phone.action.failed' | 'entity.created' | 'task.opened' | "
            "'task.resolved' | 'manual.test'."
        ),
    )
    """
    Indexed so the EventDispatcher's per-fire lookup is one indexed
    scan + the target join. When trigger vocabulary stabilizes, this
    can be tightened with a CHECK constraint without migrating data.
    """

    # ------------------------------------------------------------------
    # Target context — which record (if any) does this rule attach to?
    # ------------------------------------------------------------------

    target_kind: str = Field(
        index=True,
        nullable=False,
        description=(
            "Structural context the subscription is scoped to. "
            "Vocabulary: 'phone' | 'entity' | 'task' | 'global'. "
            "When 'global', `target_id` is NULL and the rule fires "
            "regardless of which record raised the event."
        ),
    )

    target_id: Optional[int] = Field(
        default=None,
        index=True,
        description=(
            "FK to the targeted record. NULL when `target_kind='global'`. "
            "Intentionally NOT declared as a FOREIGN KEY constraint — "
            "the same column points at different tables depending on "
            "`target_kind`, and SQLAlchemy doesn't model polymorphic "
            "FKs cleanly. The service layer validates existence on "
            "insert; orphan rows are tolerated on delete cascades."
        ),
    )

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    recipients: Optional[list] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
        description=(
            "Opaque chat-platform tokens (Slack channel ids, Teams "
            "emails, webhook URLs, etc.). Interpreted only by the "
            "configured NotificationChannel module — the dispatcher "
            "treats each entry as a blind string."
        ),
    )

    # ------------------------------------------------------------------
    # Templates (both optional — caller-supplied at fire time wins)
    # ------------------------------------------------------------------

    title_template: Optional[str] = Field(
        default=None,
        description=(
            "Optional Python-format-string override for the message "
            "header. NULL → the caller's `default_title` at fire time "
            "is used verbatim. Template variables are limited to keys "
            "in the event payload."
        ),
    )

    body_template: Optional[str] = Field(
        default=None,
        description=(
            "Optional Python-format-string override for the message "
            "body. Same fallback semantics as `title_template`."
        ),
    )

    # ------------------------------------------------------------------
    # Lifecycle state
    # ------------------------------------------------------------------

    active: bool = Field(
        default=True,
        index=True,
        nullable=False,
        description=(
            "When False, the dispatcher skips this rule at lookup "
            "time. Lets operators pause noisy subscriptions without "
            "destroying the configuration."
        ),
    )

    # // HOOK FOR ENTERPRISE AUTH — `created_by` is a free-form string
    # // carrying the operator_id today (same pattern as PipelineTask).
    # // Phase G replaces explicit pass-through with a server-side
    # // `Depends(get_current_operator)`.
    created_by: str = Field(
        default="",
        nullable=False,
        description=(
            "operator_id of the operator who created this subscription. "
            "Recorded for audit; no permission gating implemented yet."
        ),
    )

    # ------------------------------------------------------------------
    # Timestamps (UTCDateTime — Phase DX/DY convention)
    # ------------------------------------------------------------------

    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
        description="UTC timestamp when this subscription was created.",
    )

    updated_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, onupdate=_utc_now),
        description="UTC timestamp of the most recent update.",
    )

    # ------------------------------------------------------------------
    # Proprietary payload bucket
    # ------------------------------------------------------------------

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description=(
            "Opaque JSON for proprietary subscription metadata "
            "(priority hints, escalation policies, etc.). The "
            "dispatcher never inspects its contents."
        ),
    )


# ===========================================================================
# NotificationDelivery
# ===========================================================================


class NotificationDelivery(SQLModel, table=True):
    """
    One row per delivery attempt — the audit trail.

    The dispatcher INSERTs with `status='pending'`, hands off to the
    channel, then UPDATEs to 'sent' or 'failed' based on the
    DeliveryResult. Retryable failures get scheduled re-attempts via
    APScheduler (future work — the skeleton ships synchronous and the
    retry hooks land later).

    `subscription_id` is nullable because not every delivery has a
    parent subscription: the `/test-fire` endpoint creates ad-hoc
    deliveries with `subscription_id=NULL` so operators can validate
    the chat pipe end-to-end without setting up a real rule first.
    """

    __tablename__ = "notification_delivery"

    # ------------------------------------------------------------------
    # Identity + parentage
    # ------------------------------------------------------------------

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing primary key.",
    )

    subscription_id: Optional[int] = Field(
        default=None,
        foreign_key="notification_subscription.id",
        index=True,
        description=(
            "FK to the parent subscription. NULL for ad-hoc deliveries "
            "(test-fire, manual operator broadcasts) that don't have "
            "a persistent rule behind them."
        ),
    )

    trigger_event_type: str = Field(
        index=True,
        nullable=False,
        description=(
            "Snapshotted from the subscription at fire time (or set "
            "to 'manual.test' for test-fire calls). Stored on the "
            "row so audit queries don't need to JOIN through to a "
            "(possibly-deleted) subscription."
        ),
    )

    # ------------------------------------------------------------------
    # Snapshotted message content (immutable on this row)
    # ------------------------------------------------------------------

    title: str = Field(
        nullable=False,
        description=(
            "Rendered title sent to the channel. Snapshotted at fire "
            "time so later template edits don't rewrite history."
        ),
    )

    body: str = Field(
        nullable=False,
        description="Rendered body sent to the channel. Snapshotted at fire time.",
    )

    recipients: Optional[list] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
        description=(
            "Snapshotted recipient tokens at fire time. Subscription "
            "recipient edits do NOT retroactively change this row."
        ),
    )

    # ------------------------------------------------------------------
    # Lifecycle state
    # ------------------------------------------------------------------

    status: str = Field(
        default="pending",
        index=True,
        nullable=False,
        description=(
            "Lifecycle state. Vocabulary: 'pending' | 'sent' | "
            "'failed' | 'cancelled'. State transitions are owned "
            "exclusively by NotificationDispatcher."
        ),
    )

    retry_count: int = Field(
        default=0,
        nullable=False,
        description=(
            "Number of retry attempts. 0 on first dispatch. Future "
            "RetryEngine integration bumps this on every reschedule."
        ),
    )

    last_error: Optional[str] = Field(
        default=None,
        description=(
            "Short operator-facing failure detail. Populated on the "
            "'failed' transition; NULL on success."
        ),
    )

    provider_message_id: Optional[str] = Field(
        default=None,
        description=(
            "Channel-supplied message id (Slack timestamp, Teams "
            "activity id, etc.). Used for de-duplication on re-fires."
        ),
    )

    # ------------------------------------------------------------------
    # Timestamps
    # ------------------------------------------------------------------

    attempted_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(UTCDateTime(), nullable=True),
        description=(
            "UTC timestamp of the most recent channel call. NULL "
            "until the first attempt completes (success or failure)."
        ),
    )

    delivered_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(UTCDateTime(), nullable=True),
        description=(
            "UTC timestamp of the first SUCCESSFUL delivery. NULL "
            "until status='sent'. Distinct from attempted_at so we "
            "can answer 'how long did this take to actually land?'"
        ),
    )

    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
        description="UTC row-creation timestamp.",
    )

    updated_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, onupdate=_utc_now),
        description="UTC timestamp of the most recent update.",
    )

    # ------------------------------------------------------------------
    # Proprietary payload bucket
    # ------------------------------------------------------------------

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description=(
            "Opaque JSON bucket — proprietary channel-response "
            "payload (raw_response from DeliveryResult), trigger "
            "event payload snapshot, retry history. The dispatcher "
            "writes here on every state transition."
        ),
    )
