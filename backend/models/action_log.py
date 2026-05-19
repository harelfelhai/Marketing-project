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
        1. INSERT with status="pending"    — queued by IngestionService or UserActionService
        2. UPDATE to status="sent"         — dispatcher handed off to external provider
              OR  status="failed"          — dispatcher encountered a hard failure
              OR  status="scheduled_retry" — dispatcher encountered a soft failure;
                                            `retry_after` set, `retry_count` incremented
        3. RetryEngine picks up rows where status="scheduled_retry"
              AND retry_after <= utcnow(), re-dispatches, increments retry_count
        4. Terminal states: "sent", "delivered", "failed" (after max retries exceeded)
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
        - "pending"           : queued, awaiting dispatcher pickup
        - "sent"              : handed off to the external provider successfully
        - "failed"            : hard failure — max retries exceeded or non-retryable error
        - "delivered"         : confirmed delivered (e.g. via provider webhook)
        - "scheduled_retry"   : soft failure; RetryEngine will re-dispatch after `retry_after`

    Indexed because the RetryEngine and dispatcher worker both run frequent
    equality-filter queries against this column.
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
    # Retry & Recovery Tracking
    # ------------------------------------------------------------------
    # These columns exist as explicit schema fields — not inside extra_data —
    # so that the RetryEngine can run high-performance queries such as:
    #   SELECT * FROM action_log
    #   WHERE status = 'scheduled_retry' AND retry_after <= :now
    # without any JSON parsing overhead.

    retry_count: int = Field(
        default=0,
        nullable=False,
        index=True,
        description="Number of re-attempt cycles this action has gone through.",
    )
    """
    Incremented by the RetryEngine each time it picks up and re-dispatches
    this row.

    Use cases for querying this column:
        - Find choked actions: retry_count >= N (stuck in repeated failure)
        - Alerting: rows where retry_count exceeds a business-defined threshold
        - SLA monitoring: group by action_type, aggregate retry_count

    Indexed to support fast "fetch all actions that have been retried > N times"
    queries without full-table scans.
    """

    retry_after: Optional[datetime] = Field(
        default=None,
        nullable=True,
        description="UTC timestamp before which the RetryEngine must NOT re-attempt this action.",
    )
    """
    Enforces a cooldown window between retry attempts (back-off strategy).

    Semantics:
        - NULL          : no retry is scheduled (row is in a terminal or pending state)
        - datetime < now: row is eligible for re-dispatch by the RetryEngine
        - datetime > now: row is in a back-off window; RetryEngine must skip it

    Populated by the dispatcher when transitioning a row to "scheduled_retry".
    The back-off duration (e.g. exponential, linear) is the responsibility of
    the concrete ActionHandler or the dispatcher configuration — NOT hardcoded here.
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
