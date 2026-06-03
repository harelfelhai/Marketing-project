"""
models/entity.py — The `Entity` table (Person / Circle-of-Trust).

Represents any individual tracked by the system: the primary target of
a marketing pipeline, or someone in their circle (family, friend, etc.).
The relationship between a non-root entity and its root is captured via
the self-referencing `target_entity_id` foreign key.

PRIVACY CONTRACT
----------------
This table MUST remain 100% generic. Any proprietary personal details,
classification metadata, or business-sensitive attributes belong inside
the `extra_data` JSON column.

SOFT-DELETE CONTRACT
--------------------
`deleted_at == SOFT_DELETE_SENTINEL` means the row is ACTIVE.
`deleted_at < SOFT_DELETE_SENTINEL` means the row is soft-deleted.
All active-row queries filter: deleted_at == SOFT_DELETE_SENTINEL.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from models.types import UTCDateTime, new_id, not_deleted


class Entity(SQLModel, table=True):
    """
    A person tracked by the marketing automation pipeline.

    TWO-LEVEL MODEL
    ---------------
    Root entity (target_entity_id IS NULL):  the primary campaign target.
    Member entity (target_entity_id != NULL): someone in the circle-of-trust.

    The `client_id` concept is gone — use `target_entity_id IS NULL` to
    find roots, and `target_entity_id = <root_id>` to find members.
    """

    __tablename__ = "entity"

    id: Optional[str] = Field(
        default_factory=new_id,
        primary_key=True,
        description="Opaque string primary key.",
    )

    target_entity_id: Optional[str] = Field(
        default=None,
        foreign_key="entity.id",
        index=True,
        description="Self-referencing FK. NULL if this entity is itself a root target.",
    )

    identifier_1: Optional[str] = Field(
        default=None,
        index=True,
        description="First external identifier (e.g. national ID, CRM ID).",
    )

    relation_type: str = Field(
        default="primary",
        index=True,
        description="Structural relation category (e.g. 'primary', 'family', 'friend', 'colleague').",
    )

    identifier_2: Optional[str] = Field(
        default=None,
        index=True,
        description="Second external identifier (optional).",
    )

    full_name: Optional[str] = Field(
        default=None,
        description="Human-readable display name for this entity.",
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
        description="Opaque JSON blob for proprietary personal metadata.",
    )
