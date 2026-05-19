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
- `client_id`: integer FK to the owning client partition. The integer (1, 2,
  3 …) is a structural index key — it carries no confidential information.
  Human-readable client names live exclusively in the frontend config layer
  (`src/config/clientRegistry.js`). The backend never stores names.
- `relation_type`: explicit enum-like string ('primary' | 'associated').
  'primary' marks the direct marketing target; 'associated' marks perimeter
  contacts (family, friends, colleagues). Indexed for fast sub-set queries.
- `entity_type`: free-form sub-classification within a relation_type bucket
  (e.g. 'family', 'friend'). Internal teams extend this at runtime.
- `extra_data`: ALL sensitive personal payload data lives here.
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
    # Client Partition
    # ------------------------------------------------------------------

    client_id: Optional[int] = Field(
        default=None,
        index=True,
        description=(
            "Integer identifier of the owning client partition (e.g. 1, 2, 3). "
            "Human-readable names are mapped exclusively in the frontend config; "
            "the backend stores only the opaque integer."
        ),
    )
    """
    First-class indexed FK to the logical client partition.

    The integer is structural — it enables fast per-client filtering in SQL
    without exposing any proprietary client name in the open-source schema.
    The frontend `clientRegistry.js` maps integers to display names.

    NULL means the entity has not yet been assigned to a client partition
    (e.g. seeded before client assignment was implemented).
    """

    # ------------------------------------------------------------------
    # Relation Classification
    # ------------------------------------------------------------------

    relation_type: str = Field(
        default="primary",
        index=True,
        description=(
            "Structural relation category. "
            "'primary' = direct marketing target. "
            "'associated' = perimeter contact in the target's circle of trust."
        ),
    )
    """
    Explicit two-value enum stored as a string for extensibility.

    Values (current):
        - 'primary'    : The individual who is the direct subject of the
                          marketing pipeline for this client partition.
        - 'associated' : A perimeter contact (family member, friend, etc.)
                          linked to a primary target via `target_entity_id`.

    Indexed to support fast queries like "give me all primary targets for
    client 3" or "give me all associated contacts for a given primary".

    INTERNAL HOOK: Internal teams may introduce additional relation_type values
    (e.g. 'secondary', 'colleague') by extending the ingestion pipeline. No
    migration is required — the column is a free-form indexed string.
    """

    # ------------------------------------------------------------------
    # Relationship Classification (sub-type)
    # ------------------------------------------------------------------

    entity_type: str = Field(
        index=True,
        description="Sub-classification within the relation_type (e.g. 'family', 'friend').",
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
    # Audit attribution (Phase AUTH)
    # ------------------------------------------------------------------

    created_by_user_id: Optional[int] = Field(
        default=None,
        foreign_key="user.id",
        index=True,
        description=(
            "FK to the User who created this entity. Nullable for "
            "legacy rows (created before Phase AUTH), guest-mode "
            "creates, and automation-driven inserts. Populated by "
            "the entity-ingestion endpoints when a logged-in user is "
            "present on the request. The personalization filter joins "
            "on this column to surface 'my entities' to operators."
        ),
    )

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
