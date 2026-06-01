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

from sqlalchemy import Column, JSON, func
from sqlalchemy.ext.hybrid import hybrid_property
from sqlmodel import Field, SQLModel


class Entity(SQLModel, table=True):
    """
    A person tracked by the marketing automation pipeline.

    TWO-LEVEL CLIENT MODEL (post-refactor)
    --------------------------------------
    There is no separate `client_id` column and no `Client` table. A
    "client" IS a root entity — an entity whose `target_entity_id` is
    NULL. Every other entity (family / friend / social envelope) points
    at its client via `target_entity_id`. So the model has exactly two
    levels:

        * Root entity (= the client / campaign target):
              target_entity_id IS NULL
        * Member entity (circle of trust around that client):
              target_entity_id = <root entity id>

    "Which client does this row belong to?" is therefore derived, not
    stored: it is `target_entity_id` for members, or `id` for roots.
    The `client_id` hybrid property below exposes exactly that value —
    `COALESCE(target_entity_id, id)` — so existing code that reads or
    filters on `Entity.client_id` keeps working unchanged. The value is
    NOT a persisted column; it is computed in both Python and SQL.

    Attributes are intentionally minimal at the schema level. The
    `extra_data` JSON column is the canonical place to store any
    proprietary personal information (including the client's display
    name, which now lives on the root entity).
    """

    __tablename__ = "entity"

    # `hybrid_property` is a SQLAlchemy construct, not a pydantic field;
    # tell pydantic to ignore it so model construction doesn't choke.
    model_config = {"ignored_types": (hybrid_property,)}

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
    # Client Membership (DERIVED — no stored column)
    # ------------------------------------------------------------------
    # `client_id` is the id of this row's ROOT entity (the client):
    #   * a root entity (target_entity_id IS NULL) is its own client → id
    #   * a member entity → its target_entity_id (the root it points at)
    #
    # Exposed as a hybrid_property so `Entity.client_id == X`,
    # `Entity.client_id.in_([...])`, and `instance.client_id` all work
    # exactly as before, in Python and in SQL. It is computed, never
    # written — assigning to it raises.

    @hybrid_property
    def client_id(self):  # type: ignore[override]
        return self.target_entity_id if self.target_entity_id is not None else self.id

    @client_id.inplace.expression
    @classmethod
    def _client_id_expr(cls):
        return func.coalesce(cls.target_entity_id, cls.id)

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

    deleted_at: Optional[datetime] = Field(
        default=None,
        nullable=True,
        index=True,
        description=(
            "Soft-delete tombstone (UAT round-3). NULL = active row; "
            "non-NULL = soft-deleted at the recorded UTC instant. "
            "Every list endpoint defaults to WHERE deleted_at IS NULL; "
            "admin tools surface deleted rows via include_deleted=true."
        ),
    )

    deletion_group_id: Optional[str] = Field(
        default=None,
        nullable=True,
        index=True,
        max_length=40,
        description=(
            "UAT round-3 — shared UUID stamped on every row tombstoned "
            "by the SAME cascading delete action. Lets restore_entity "
            "bring back exactly the rows that vanished together, "
            "without resurrecting unrelated rows the operator deleted "
            "manually before or after."
        ),
    )

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
    # UAT round-3 — strong identifier (national id / employee number /
    # any external first-class id). Optional. Stored as its own column
    # rather than inside extra_data so it can be indexed, joined, and
    # exported as a first-class field.
    # ------------------------------------------------------------------

    strong_identifier: Optional[str] = Field(
        default=None,
        max_length=80,
        index=True,
        description=(
            "Operator-supplied external identifier (e.g. national id, "
            "employee number). Optional. Distinct from the internal "
            "primary-key `id`. Indexed so lookups by this value stay "
            "cheap even at scale."
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
