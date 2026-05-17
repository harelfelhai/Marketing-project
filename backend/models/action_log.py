"""
models/action_log.py — The `ActionLog` table (Phase 2: External Dispatching).

An event-driven transactional log capturing every discrete outbound
action executed against a `PhoneNumber`. Each row represents ONE attempt
to trigger an external system (ad campaign, SMS send, follow-up call, etc.).

WHY A SEPARATE TABLE?
---------------------
Phase 2 events are STRUCTURALLY DISTINCT from Phase 1 (Ingestion) and
Phase 3 (Verification) for two reasons:

    1. Cardinality — a single PhoneNumber may receive many actions over
       its lifetime. Storing them as columns would require either
       arbitrary fixed slots or unbounded list serialisation.
    2. External vs. Internal — these events represent the system's
       OUTBOUND interactions with the real world, while Phase 1/3 live
       inside the internal evaluation pipeline. Separating them keeps
       audit boundaries clean.

PRIVACY CONTRACT
----------------
Provider-specific identifiers, response payloads, and proprietary
campaign parameters belong in the `extra_data` JSON column.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class ActionLog(SQLModel, table=True):
    """
    A single outbound action executed against a phone number.

    Lifecycle of a typical row:
        1. INSERT with status="pending"  and `requested_at` = now
        2. UPDATE to status="sent" / "failed" / "delivered"
                  with `executed_at` set by the dispatcher worker
        3. Optional later updates as upstream provider webhooks arrive
           (e.g. delivery receipts) — these mutate `status` and
           append to `extra_data`.
    """

    __tablename__ = "action_log"

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing primary key.",
    )

    phone_id: int = Field(
        foreign_key="phone_number.id",
        index=True,
        nullable=False,
        description="FK to `PhoneNumber.id` — the target of this action.",
    )
    """
    Indexed for efficient "fetch the action timeline for phone X"
    queries — the primary access pattern for this table.
    """

    # ------------------------------------------------------------------
    # Action Definition
    # ------------------------------------------------------------------

    action_type: str = Field(
        index=True,
        nullable=False,
        description="Identifier of the outbound action type (e.g. 'advertisement_type_a').",
    )
    """
    Free-form string identifying the action type.

    Example values (illustrative, NOT enforced):
        - "advertisement_type_a"
        - "advertisement_type_b"
        - "followup_sms"
        - "retention_call"

    The CampaignDispatcher implementation is responsible for understanding
    each action_type string. New action types can be supported by simply
    inserting rows with new values — NO schema migration is required.
    """

    # ------------------------------------------------------------------
    # Execution State
    # ------------------------------------------------------------------

    status: str = Field(
        default="pending",
        index=True,
        nullable=False,
        description="Real-time execution state (e.g. 'pending', 'sent', 'failed', 'delivered').",
    )
    """
    Lifecycle state of this dispatch attempt.

    Example values (illustrative, NOT enforced):
        - "pending"   : queued, awaiting dispatcher pickup
        - "sent"      : handed off to the external provider successfully
        - "failed"    : the dispatcher could not deliver the action
        - "delivered" : confirmed delivered (e.g. via provider webhook)

    Indexed because the dispatcher worker frequently polls for all rows
    in "pending" state.
    """

    requested_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        description="UTC timestamp when this action was queued.",
    )
    """Set at INSERT time. Represents enqueue moment, not execution moment."""

    executed_at: Optional[datetime] = Field(
        default=None,
        description="UTC timestamp when the dispatcher completed the action.",
    )
    """
    Populated by the CampaignDispatcher only after the outbound call
    completes (either success or failure). Remains NULL while the row
    is still "pending".
    """

    # ------------------------------------------------------------------
    # Standard Metadata
    # ------------------------------------------------------------------

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        description="UTC timestamp when this row was first inserted.",
    )

    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"onupdate": datetime.utcnow},
        description="UTC timestamp of the most recent update (auto-managed).",
    )

    # ------------------------------------------------------------------
    # Proprietary Payload Bucket
    # ------------------------------------------------------------------

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Opaque JSON bucket for provider IDs, response payloads, and campaign params.",
    )
    """
    Generic JSON container for ALL Phase 2 sensitive metadata.

    Example contents (illustrative, NOT enforced):
        {
            "provider_message_id": "...",
            "provider_response": {...},
            "campaign_parameters": {...},
            "error_details": {...}
        }

    Internal teams plug provider-specific data here without touching
    the schema. The CampaignDispatcher implementation owns the shape
    of this payload.
    """
