"""
models/pipeline_task.py — The `PipelineTask` table (stateful work-order queue).

A PipelineTask represents one outstanding operational assignment that
requires human disposition. Tasks may be opened by:
    - The pipeline itself (automation hand-off when an ActionLog hits a
      terminal failure that the system flags as "needs human review").
    - A lower-tier operator who lacks execution privilege and instead
      requests authorization from a Senior Admin.

ARCHITECTURAL ROLE
------------------
This table is plumbing, not a pluggable algorithm. Unlike Phases 1/2/3,
there is no ABC interface for it. Failure-category classification —
deciding *which* failures spawn remediation tasks — lives inside the
existing `BaseActionHandler.execute()` implementations and the policy
that opens the task.

PRIVACY CONTRACT
----------------
Same as Entity / PhoneNumber / ActionLog: the structured columns hold
only generic lifecycle state and structural foreign keys. All proprietary
payload — failure category tokens, requested-action parameters, reviewer
notes, scoring vectors — lives inside `extra_data`.

AUTH DEFERRAL
-------------
`requested_by` and `resolved_by` are free-form strings carrying the
`operator_id` token. Permission gating (who may resolve which task_type)
happens at the FRONTEND boundary via `MockAuthContext` until Phase G
swaps the auth seam. The backend does not enforce role policy on these
columns — it only records what the caller passed in.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, JSON
from sqlalchemy.types import TypeDecorator
from sqlmodel import Field, SQLModel


# All three timestamps on this table are timezone-aware UTC per Phase DX
# constraint #3 (Explicit UTC Timezones). The legacy tables — Entity,
# PhoneNumber, ActionLog — still use naive datetime.utcnow() and are
# scheduled for migration in a later phase. Until then, callers that
# join Pipeline Task with those tables must be tolerant of mixed
# tz-aware / tz-naive comparisons.


def _utc_now() -> datetime:
    """Return a timezone-aware UTC datetime. Used as default_factory."""
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """
    DateTime column type that guarantees tz-aware UTC values on the way out.

    SQLAlchemy's `DateTime(timezone=True)` is honoured natively by PostgreSQL
    (TIMESTAMPTZ), but SQLite's TEXT-backed storage strips the offset on
    write and returns a naive datetime on read. That mismatch turns this
    table's timestamps into a comparison hazard on dev (naive on read) vs
    production (aware on read).

    This TypeDecorator closes the gap by:
        - On WRITE: requiring the inbound value to be tz-aware (or None);
          converting to UTC before handing it to the underlying engine.
        - On READ: reattaching `tzinfo=timezone.utc` if the engine returned
          a naive value (the SQLite path) so the application layer always
          sees the same tz-aware shape regardless of backend.

    `cache_ok = True` is safe because the decorator has no parameters.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            # Caller passed a naive datetime — refuse it loudly rather than
            # silently treating it as local-time.
            raise ValueError(
                "PipelineTask datetimes must be tz-aware (Phase DX constraint #3). "
                "Use datetime.now(timezone.utc) instead of datetime.utcnow()."
            )
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            # SQLite read path — reattach UTC.
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class PipelineTask(SQLModel, table=True):
    """
    A pending operational task awaiting human resolution.

    Lifecycle:
        1. INSERT with status="pending"   — opened by automation or operator.
        2. UPDATE to status="assigned"    — a Senior Admin claims the task.
        3. UPDATE to status="resolved"    — admin executed / approved.
              OR  status="rejected"       — admin declined / closed without action.
    """

    __tablename__ = "pipeline_task"

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing primary key.",
    )

    # ------------------------------------------------------------------
    # Structural foreign keys
    # ------------------------------------------------------------------

    phone_id: int = Field(
        foreign_key="phone_number.id",
        index=True,
        nullable=False,
        description="FK to `PhoneNumber.id` — the target this task is about.",
    )
    """Indexed for 'fetch all tasks for phone X' queries."""

    source_action_log_id: Optional[int] = Field(
        default=None,
        foreign_key="action_log.id",
        index=True,
        description=(
            "FK to the originating `ActionLog.id` when this task was opened "
            "by the automation layer in response to a specific action failure. "
            "NULL when the task originated from an operator request rather "
            "than an automated failure hand-off."
        ),
    )

    # ------------------------------------------------------------------
    # Task classification
    # ------------------------------------------------------------------

    task_type: str = Field(
        index=True,
        nullable=False,
        description=(
            "Free-form indexed string identifying what kind of task this is. "
            "Current vocabulary (NOT enforced at DB level): "
            "'remediation_failure' | 'approval_required' | 'manual_recommendation'."
        ),
    )
    """
    Example values (illustrative, NOT enforced):
        - 'remediation_failure'   : automated hand-off — an ActionLog hit a
                                    terminal failure that requires human review.
        - 'approval_required'     : low-tier operator requested an action;
                                    Senior Admin must authorize before execution.
        - 'manual_recommendation' : pipeline surfaced a suggestion (e.g. flag
                                    for verification) that needs human approval.

    Indexed so the OperationsQueue filter-as-view (?task_type=...) runs
    on equality. New task_type values can be introduced without migration.
    """

    # ------------------------------------------------------------------
    # Execution state
    # ------------------------------------------------------------------

    status: str = Field(
        default="pending",
        index=True,
        nullable=False,
        description=(
            "Lifecycle state. Free-form indexed string. Current vocabulary "
            "(NOT enforced): 'pending' | 'assigned' | 'resolved' | 'rejected'."
        ),
    )
    """
    Example values (illustrative, NOT enforced):
        - 'pending'  : awaiting Senior Admin pickup.
        - 'assigned' : a Senior Admin has claimed it; work in progress.
        - 'resolved' : terminal — action approved / executed / closed positively.
        - 'rejected' : terminal — declined / closed without action.

    Indexed because the OperationsQueue page filters heavily on this
    column (?status=pending is the default view).
    """

    # ------------------------------------------------------------------
    # Attribution (operator_id strings — auth-deferred)
    # ------------------------------------------------------------------

    requested_by: str = Field(
        nullable=False,
        index=True,
        description=(
            "operator_id of the human or system that opened the task. "
            "Free-form string. For automated tasks this is the engine name "
            "(e.g. 'automation:retry_engine'). For operator-opened tasks "
            "it is the operator_id from the frontend's auth seam."
        ),
    )
    """
    Indexed so a future 'my open requests' view can filter cheaply.
    Audit / RBAC enforcement is a frontend concern until Phase G.
    """

    resolved_by: Optional[str] = Field(
        default=None,
        index=True,
        description=(
            "operator_id of the Senior Admin who terminally settled the "
            "task. NULL while status is 'pending' or 'assigned'."
        ),
    )

    # ------------------------------------------------------------------
    # Timestamps — Phase DX constraint #3: explicit timezone-aware UTC.
    # ------------------------------------------------------------------
    # Each column is backed by `UTCDateTime` (defined at the top of this
    # file) which wraps `DateTime(timezone=True)` and guarantees tz-aware
    # roundtrip on BOTH PostgreSQL (native TIMESTAMPTZ) and SQLite
    # (offset stripped on write, reattached on read). Writes of naive
    # datetimes are rejected loudly with a ValueError rather than silently
    # treated as local-time.

    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(
            UTCDateTime(),
            nullable=False,
        ),
        description="Timezone-aware UTC timestamp when this task was opened.",
    )

    updated_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(
            UTCDateTime(),
            nullable=False,
            onupdate=_utc_now,
        ),
        description=(
            "Timezone-aware UTC timestamp of the most recent update "
            "(auto-managed by SQLAlchemy's onupdate hook)."
        ),
    )

    resolved_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=True,
        ),
        description=(
            "Timezone-aware UTC timestamp set the moment status transitions "
            "to 'resolved' or 'rejected'. NULL while still open."
        ),
    )

    # ------------------------------------------------------------------
    # Proprietary payload bucket
    # ------------------------------------------------------------------

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description=(
            "Opaque JSON blob for failure-category tokens, requested-action "
            "parameters, reviewer notes, scoring breakdowns, etc. Internal "
            "teams plug proprietary structured data here without schema changes."
        ),
    )
    """
    Example shapes (illustrative, NOT enforced):

    task_type='remediation_failure':
        {
            "failure_category": "provider_blocked",
            "provider_response": {...},
            "suggested_remediation": "...",
        }

    task_type='approval_required':
        {
            "requested_action_type": "advertisement_type_a",
            "operator_note": "...",
            "campaign_parameters": {...},
        }

    Resolution metadata (added by PipelineTaskService.resolve_task):
        {
            ...,
            "resolution_note": "...",
            "resolution_outcome": "resolved" | "rejected",
        }
    """
