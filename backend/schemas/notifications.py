"""
schemas/notifications.py — Pydantic contracts for Phase NOTIF.

Three logical surfaces:

    1. NotificationSubscription* — CRUD over the persistent rule.
       Create / update / response shapes; PATCH uses an explicit
       optional-fields update body so partial edits don't clobber
       columns the caller didn't intend to change.

    2. NotificationDelivery*    — audit-trail response shape for the
       deliveries list endpoint. Read-only at the API layer.

    3. TestFireRequest          — operator-triggered smoke fire that
       lets a manager validate the chat pipe end-to-end before any
       business trigger is wired.

PRIVACY CONTRACT
----------------
`recipients` lists carry opaque chat-platform tokens (Slack channel
ids, webhook URLs, Teams email aliases). The schema layer never
validates their shape — that's the concrete NotificationChannel's
job. We only enforce list-of-strings here.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ===========================================================================
# Subscription shapes
# ===========================================================================


# Allowed values for `target_kind`. Kept as a Literal-shape constant
# here so the regex pattern can be reused across create + update bodies.
_TARGET_KIND_PATTERN = "^(phone|entity|task|global)$"


class NotificationSubscriptionCreate(BaseModel):
    """
    Request body for POST /api/v1/notifications/subscriptions.

    Validated fields:
      - `trigger_event_type` is a free-form indexed string today; the
        controlled vocabulary lives frontend-side in the event catalog.
        When triggers stabilize this becomes an enum and the change is
        a one-line schema diff.
      - `target_kind` is constrained to the four supported scopes. The
        service layer enforces the matching invariant
        (target_id required iff target_kind != 'global').
      - `recipients` MUST have at least one entry — a subscription that
        delivers to nobody is always operator error.
    """

    trigger_event_type: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description=(
            "Event token the subscription fires on. Example values: "
            "'phone.ingested', 'phone.verification.changed', "
            "'entity.created', 'task.opened'. Free-form for now."
        ),
        examples=["phone.verification.changed"],
    )
    target_kind: str = Field(
        ...,
        pattern=_TARGET_KIND_PATTERN,
        description=(
            "Scope of the subscription. 'phone' | 'entity' | 'task' "
            "scope to a specific record (target_id required). "
            "'global' fires on every event of this type regardless "
            "of context (target_id must be NULL)."
        ),
    )
    target_id: Optional[int] = Field(
        default=None,
        description=(
            "FK to the targeted record. Required for non-global "
            "subscriptions; rejected for global ones (422). The "
            "service layer enforces this invariant — the schema "
            "only types the column."
        ),
    )
    recipients: List[str] = Field(
        ...,
        min_length=1,
        max_length=50,
        description=(
            "Opaque chat-platform tokens to deliver to. 1..50 entries. "
            "Format-validated only by the concrete NotificationChannel "
            "at delivery time."
        ),
    )
    title_template: Optional[str] = Field(
        default=None,
        max_length=200,
        description=(
            "Optional Python-format-string override for the message "
            "header. Variables resolved from the event payload. NULL "
            "→ caller-supplied default_title used at fire time."
        ),
    )
    body_template: Optional[str] = Field(
        default=None,
        max_length=2000,
        description=(
            "Optional override for the message body. Same fallback "
            "semantics as title_template."
        ),
    )
    # Phase AUTH-B: created_by removed. Endpoint requires auth;
    # current_user.username becomes the row's created_by value.
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Optional opaque JSON payload — priority hints, "
            "escalation policy, etc. Stored verbatim; never inspected."
        ),
    )


class NotificationSubscriptionUpdate(BaseModel):
    """
    Request body for PATCH /api/v1/notifications/subscriptions/{id}.

    True partial update — every field is optional and only non-None
    fields are applied. The PATCH explicitly does NOT support changing
    `trigger_event_type` or `target_kind` / `target_id`; those define
    the subscription's identity and editing them would invalidate the
    audit trail. To re-scope, delete and re-create.
    """

    recipients: Optional[List[str]] = Field(
        default=None,
        min_length=1,
        max_length=50,
    )
    title_template: Optional[str] = Field(default=None, max_length=200)
    body_template: Optional[str] = Field(default=None, max_length=2000)
    active: Optional[bool] = Field(
        default=None,
        description=(
            "Toggle without deleting. False → dispatcher skips this "
            "rule at lookup time. True → it's eligible again."
        ),
    )
    extra_data: Optional[dict] = Field(default=None)


class NotificationSubscriptionResponse(BaseModel):
    """Echoed shape — every column of NotificationSubscription."""

    id: int
    trigger_event_type: str
    target_kind: str
    target_id: Optional[int] = None
    recipients: List[str] = Field(default_factory=list)
    title_template: Optional[str] = None
    body_template: Optional[str] = None
    active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    extra_data: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Delivery shapes (read-only at the API)
# ===========================================================================


class NotificationDeliveryResponse(BaseModel):
    """Echoed shape — every column of NotificationDelivery."""

    id: int
    subscription_id: Optional[int] = None
    trigger_event_type: str
    title: str
    body: str
    recipients: List[str] = Field(default_factory=list)
    status: str
    retry_count: int
    last_error: Optional[str] = None
    provider_message_id: Optional[str] = None
    attempted_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    extra_data: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Test-fire
# ===========================================================================


class TestFireRequest(BaseModel):
    """
    Request body for POST /api/v1/notifications/test-fire.

    Lets an operator validate the configured chat pipe end-to-end
    without setting up a real subscription. Lands as a
    NotificationDelivery row tagged `trigger_event_type='manual.test'`
    with `subscription_id=NULL`.
    """

    recipients: List[str] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Opaque chat-platform tokens to deliver the test message to.",
    )
    title: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Title for the test message.",
    )
    body: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Body for the test message.",
    )
    metadata: Optional[dict] = Field(
        default=None,
        description=(
            "Optional opaque metadata passed through to the channel "
            "module's deliver() call. Channel modules may ignore it."
        ),
    )
