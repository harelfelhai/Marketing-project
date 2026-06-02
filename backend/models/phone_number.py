"""
models/phone_number.py — The `PhoneNumber` table.

Represents a unique communication endpoint owned by an `Entity`.

SOFT-DELETE CONTRACT
--------------------
`deleted_at == SOFT_DELETE_SENTINEL` means the row is ACTIVE.
`deleted_at < SOFT_DELETE_SENTINEL` means the row is soft-deleted.

VERIFICATION STATUS VOCABULARY
--------------------------------
  "pending"   — not yet evaluated
  "verified"  — passed quality audit
  "rejected"  — flagged as low-quality / non-actionable
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from models.types import UTCDateTime, new_id, not_deleted


class PhoneNumber(SQLModel, table=True):
    """A telephone number tracked through the pipeline lifecycle."""

    __tablename__ = "phone_number"

    id: Optional[str] = Field(
        default_factory=new_id,
        primary_key=True,
        description="Opaque string primary key.",
    )

    phone_number: str = Field(
        index=True,
        unique=True,
        nullable=False,
        description="Literal phone number (E.164 recommended). Unique + indexed.",
    )

    phone_type: Optional[str] = Field(
        default=None,
        index=True,
        description="Classification/type of phone (e.g. 'mobile', 'home', 'work'). Nullable.",
    )

    entity_id: str = Field(
        foreign_key="entity.id",
        index=True,
        nullable=False,
        description="FK to Entity.id — the owner of this number.",
    )

    ingestion_source: str = Field(
        nullable=False,
        description="Origin channel of this row (e.g. 'manual', 'automated').",
    )

    verification_status: str = Field(
        default="pending",
        index=True,
        nullable=False,
        description="Quality assessment state: 'pending' | 'verified' | 'rejected'.",
    )

    score: float = Field(
        default=0.0,
        index=True,
        nullable=False,
        description="General-purpose score (0.0 by default). Replaces confidence_score + priority_score.",
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
        description="Opaque JSON bucket for proprietary ingestion/verification metadata.",
    )
