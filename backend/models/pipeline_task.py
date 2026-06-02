"""
models/pipeline_task.py — The `PipelineTask` table (stateful work-order queue).

A PipelineTask represents one outstanding operational assignment that
requires human disposition.

STATUS VOCABULARY
-----------------
  "pending"   -- awaiting admin pickup
  "done"      -- terminal, completed positively
  "rejected"  -- terminal, declined/closed without action

SOFT-DELETE CONTRACT
--------------------
`deleted_at == SOFT_DELETE_SENTINEL` means the row is ACTIVE.
`deleted_at < SOFT_DELETE_SENTINEL` means the row is soft-deleted.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from models.types import UTCDateTime, new_id, not_deleted, utc_now as _utc_now


class PipelineTask(SQLModel, table=True):
    """A pending operational task awaiting human resolution."""

    __tablename__ = "pipeline_task"

    id: Optional[str] = Field(
        default_factory=new_id,
        primary_key=True,
        description="Opaque string primary key.",
    )

    phone_id: str = Field(
        foreign_key="phone_number.id",
        index=True,
        nullable=False,
        description="FK to PhoneNumber.id — the target this task is about.",
    )

    phone_number: str = Field(
        nullable=False,
        description="Denormalized phone number string (copied from PhoneNumber at insert time).",
    )

    entity_id: str = Field(
        foreign_key="entity.id",
        index=True,
        nullable=False,
        description="FK to Entity.id — the entity this task is about.",
    )

    task_type: str = Field(
        index=True,
        nullable=False,
        description="Free-form task classification token (e.g. 'review', 'verify', 'follow_up').",
    )

    status: str = Field(
        default="pending",
        index=True,
        nullable=False,
        description="Lifecycle state: 'pending' | 'done' | 'rejected'.",
    )

    deleted_at: datetime = Field(
        default_factory=not_deleted,
        sa_column=Column(UTCDateTime(), nullable=False, index=True),
        description=(
            "Soft-delete sentinel. SOFT_DELETE_SENTINEL = active row. "
            "Any earlier datetime = soft-deleted at that UTC instant."
        ),
    )

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description=(
            "Opaque JSON blob for task-type specific payload and resolution metadata."
        ),
    )
