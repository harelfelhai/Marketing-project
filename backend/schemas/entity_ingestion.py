"""
schemas/entity_ingestion.py — Pydantic contracts for Phase E2: Entity Ingestion.

Three operator-facing channels for creating Entity rows:

    Single-Entry (E2-A): one Entity, no phones.
                         POST /api/v1/entities

    Bulk-Text (E2-B):   N Entities under N target/relation choices,
                         delivered as a curated client-side grid.
                         POST /api/v1/entities/bulk-text

    Bulk-Upload (E2-B): N Entities from an Excel/CSV file, each row
                         carrying its own target_entity_id + relation.
                         POST /api/v1/entities/bulk-upload

New schema: full_name, identifier_1, identifier_2 replace first_name/last_name/strong_identifier.
"""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from interfaces.relation_types import AssociatedRelationType


class EntitySingleCreateIn(BaseModel):
    """
    Request body for POST /api/v1/entities.
    """

    relation_type: AssociatedRelationType = Field(
        ...,
        description="Relation type of the new entity.",
    )
    target_entity_id: Optional[str] = Field(
        default=None,
        description="FK to the root target Entity. Null for root entities.",
    )
    full_name: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Full display name of the entity.",
    )
    identifier_1: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Primary identifier (e.g. ID number, employee number).",
    )
    identifier_2: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Secondary identifier.",
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description="Opaque JSON blob for additional metadata.",
    )


class EntitySingleCreateOut(BaseModel):
    """
    Response body for POST /api/v1/entities.
    """

    id: str = Field(..., description="Surrogate PK of the newly created Entity row.")
    relation_type: str = Field(..., description="The relation token for this entity.")
    target_entity_id: Optional[str] = Field(
        default=None,
        description="FK to the root target Entity. Null for root entities.",
    )
    full_name: Optional[str] = Field(default=None, description="Full display name.")
    identifier_1: Optional[str] = Field(default=None, description="Primary identifier.")
    identifier_2: Optional[str] = Field(default=None, description="Secondary identifier.")

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# Phase E2-B — Bulk-text (Two-Step grid) request contracts
# ===========================================================================


class EntityBulkTextRow(BaseModel):
    """One row inside an `EntityBulkTextIn` payload."""

    row_token: str = Field(
        ...,
        max_length=200,
        description="The original token from the operator's Step-1 paste, for audit.",
    )
    relation_type: Optional[AssociatedRelationType] = Field(
        default=None,
        description="Per-row override of the request-level default_relation_type.",
    )
    target_entity_id: Optional[str] = Field(
        default=None,
        description="Per-row override of the request-level default_target_entity_id.",
    )
    full_name: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Full display name of the entity.",
    )
    identifier_1: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Primary identifier.",
    )
    identifier_2: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Secondary identifier.",
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description="Per-row opaque blob merged into Entity.extra_data.",
    )


class EntityBulkTextIn(BaseModel):
    """
    Request body for POST /api/v1/entities/bulk-text.
    """

    default_relation_type: AssociatedRelationType = Field(
        ...,
        description="Modal-level default applied to every row whose per-row relation_type is null.",
    )
    default_target_entity_id: str = Field(
        ...,
        description="Modal-level default target FK applied to rows without a per-row override.",
    )
    rows: List[EntityBulkTextRow] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="One typed record per operator-grid row. 1..500 entries.",
    )
