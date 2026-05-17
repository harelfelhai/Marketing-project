"""
models/entity.py — The `Entity` table (Person / Circle-of-Trust).

Represents any individual tracked by the system: the primary `target` of
a marketing pipeline, or someone in their immediate surrounding circle
(family member, close friend, etc.). The relationship between a non-target
entity and its primary target is captured via the self-referencing
`target_entity_id` foreign key.

PRIVACY CONTRACT
----------------
This table MUST remain 100% generic. Any proprietary personal details,
classification metadata, or business-sensitive attributes belong inside
the `extra_data` JSON column. The schema fields themselves carry only
the structural relationship — never the secret payload.

INTERNAL HOOK POINTS
--------------------
- `entity_type`: stored as a free-form string so internal teams can add
  new relationship classifications (e.g. "colleague", "partner") without
  any database migration. Validate / normalise these values in your
  proprietary IngestionEngine, not at the model layer.
- `extra_data`: this is where ALL sensitive personal payload data lives
  in production. Examples (NOT exhaustive, NOT enforced):
      { "full_name": ..., "address": ..., "internal_tags": [...] }
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class Entity(SQLModel, table=True):
    """
    A person tracked by the marketing automation pipeline.

    Each Entity is either:
        * A "target" — the prospect the pipeline is actively working on.
          `target_entity_id` is NULL for these rows.
        * A member of a target's circle of trust (family, friend, etc.).
          `target_entity_id` points to the primary target's `id`.

    Attributes are intentionally minimal at the schema level. The
    `extra_data` JSON column is the canonical place to store any
    proprietary personal information.
    """

    __tablename__ = "entity"

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing primary key.",
    )
    """Surrogate primary key. Auto-assigned by the database on insert."""

    # ------------------------------------------------------------------
    # Relationship Classification
    # ------------------------------------------------------------------

    entity_type: str = Field(
        index=True,
        description="Relationship classification (e.g. 'target', 'family', 'friend').",
    )
    """
    Free-form classification string describing this entity's role relative
    to a primary target.

    Example values (illustrative, NOT enforced at the DB level):
        - "target"  : the prospect being marketed to
        - "family"  : immediate relative of a target
        - "friend"  : close friend of a target

    Internal teams may introduce additional classifications at runtime
    without altering this schema. The string is indexed to support fast
    filtering by relationship type.
    """

    # ------------------------------------------------------------------
    # Self-Referencing Hierarchy
    # ------------------------------------------------------------------

    target_entity_id: Optional[int] = Field(
        default=None,
        foreign_key="entity.id",
        index=True,
        description="Self-referencing FK. NULL if this entity is itself a target.",
    )
    """
    Self-referencing foreign key to `Entity.id`.

    Semantics:
        - NULL  → this row IS a primary target.
        - INT   → this row belongs to the circle-of-trust of the target
                  whose id matches this value.

    Indexed to make "fetch all circle members of target X" queries fast.
    """

    # ------------------------------------------------------------------
    # Timestamps
    # ------------------------------------------------------------------

    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        description="UTC timestamp when this row was first inserted.",
    )
    """Set once on creation by SQLModel's default_factory."""

    updated_at: datetime = Field(
        default_factory=datetime.utcnow,
        nullable=False,
        sa_column_kwargs={"onupdate": datetime.utcnow},
        description="UTC timestamp of the most recent update (auto-managed).",
    )
    """
    Automatically refreshed by SQLAlchemy's `onupdate` hook on every
    UPDATE statement. Read-only at the application layer — do not set
    manually.
    """

    # ------------------------------------------------------------------
    # Proprietary Payload Bucket
    # ------------------------------------------------------------------

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description="Opaque JSON blob for proprietary personal metadata.",
    )
    """
    Generic JSON container for ALL sensitive personal data.

    This is the single place where internal teams should write any
    proprietary fields. The open-source schema deliberately knows nothing
    about its contents.

    The value is stored as a native JSON column in PostgreSQL and as
    serialised TEXT in SQLite (transparent — both are queried as dict).
    """
