"""
schemas/ingestion.py — Pydantic data contracts for Phase 1 (Ingestion Gateway).

This module defines the EXTERNAL data boundary: what shape of data the system
accepts from callers (the manual UI form or the automated external software)
and what it guarantees to return.

WHY PYDANTIC HERE, NOT SQLMODEL?
---------------------------------
SQLModel table classes define the internal DB structure. Pydantic `BaseModel`
classes here define the API boundary. Keeping them separate means:
    - API shape can evolve independently of the DB schema.
    - Sensitive fields in `extra_data` are validated at the entry point
      before reaching the DB layer.
    - Input coercion (e.g. phone number normalisation) can be added to
      validators without touching the SQLModel classes.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class IngestionPayload(BaseModel):
    """
    The complete input contract for ingesting a new circle-of-trust member.

    This model is the canonical entry point for ALL Phase 1 data — whether
    arriving from:
        - A human operator via the dynamic form (Manual Ingestion UI).
        - An external automated system via the REST API (Automated Ingestion).

    DESIGN NOTE — Blind External System
    ------------------------------------
    External callers do NOT know internal database IDs. They identify the
    primary target by their raw phone number (`target_phone_number`). The
    `IngestionService` is responsible for resolving this to an internal
    `Entity.id` via a DB lookup. If no match is found, ingestion is
    rejected with a `TargetNotFoundError`.

    PRIVACY NOTE
    ------------
    The `entity_extra` and `phone_extra` fields are the designated containers
    for any proprietary personal data or algorithmic metadata. They are
    schema-transparent opaque blobs at this layer — this file deliberately
    knows nothing about their contents.
    """

    phone_number: str = Field(
        ...,
        description="The literal telephone number being ingested (the new circle-of-trust member).",
        examples=["+14155550002"],
    )
    """
    The endpoint being added to the system.

    INTERNAL HOOK: The IngestionService (or a pre-processing validator added
    later) should normalise this to E.164 format before DB insertion.
    Normalisation logic should NOT live in this Pydantic class; keep it in
    the service layer to allow the mock and real implementations to diverge.
    """

    entity_type: str = Field(
        ...,
        description="Relationship classification of the new entity to its primary target.",
        examples=["family", "friend"],
    )
    """
    Describes how the new entity relates to the primary target.

    Example values (illustrative, NOT exhaustive):
        - "family"  : immediate relative of the target
        - "friend"  : close acquaintance of the target

    INTERNAL HOOK: The IngestionRoutingEngine may use this value to decide
    which immediate action (if any) to trigger for this entity type.
    Internal teams should document the full taxonomy in their proprietary
    IngestionRoutingEngine implementation, not in this schema.
    """

    target_phone_number: str = Field(
        ...,
        description=(
            "Phone number of the PRIMARY target already in the DB. "
            "Used by IngestionService to resolve the internal Entity/target FK."
        ),
        examples=["+14155550001"],
    )
    """
    The system uses this field ONLY for lookup — it is never written to the DB.

    The lookup chain inside IngestionService:
        1. Find PhoneNumber row where phone_number == target_phone_number
        2. Read its entity_id → this is the FK for the new Entity.target_entity_id
        3. Discard this field afterwards

    INTERNAL HOOK: If the external system sends a different identifier
    (e.g. an internal customer ID), the IngestionService can be extended to
    support alternative lookup strategies. Add those lookup paths to the
    service, not to this schema.
    """

    ingestion_source: str = Field(
        ...,
        description="Origin channel that surfaced this number (e.g. 'manual', 'automated').",
        examples=["manual", "automated"],
    )
    """
    Persisted as `PhoneNumber.ingestion_source`.

    Example values (illustrative):
        - "manual"     : a human operator submitted the form
        - "automated"  : an external system posted via the API

    INTERNAL HOOK: Internal teams may introduce additional source identifiers
    for different external software systems without any schema change.
    """

    ingestion_reason: Optional[str] = Field(
        default=None,
        description="Algorithmic justification or operator note for this ingestion.",
        examples=["Strong family connection to high-value target"],
    )
    """
    Persisted as `PhoneNumber.ingestion_reason`.

    For manual submissions: the operator's free-text explanation.
    For automated submissions: the natural-language output of the
    external system's scoring or ranking algorithm.

    Optional — may be None for automated pipelines that produce no
    human-readable explanation.
    """

    entity_extra: Optional[dict] = Field(
        default=None,
        description="Opaque JSON blob passed through to Entity.extra_data.",
    )
    """
    PRIVACY BUCKET: Any proprietary personal attributes about the new entity.

    This field is written verbatim to `Entity.extra_data` at insertion time.
    The IngestionService MUST NOT inspect, transform, or log its contents —
    it passes through as an opaque blob.

    INTERNAL HOOK: Internal teams define the schema of this object privately.
    The open-source codebase remains entirely blind to its structure.
    """

    phone_extra: Optional[dict] = Field(
        default=None,
        description="Opaque JSON blob passed through to PhoneNumber.extra_data.",
    )
    """
    PRIVACY BUCKET: Any proprietary metadata about the phone number itself
    (e.g. carrier lookup results, scoring vectors, internal audit trail).

    Written verbatim to `PhoneNumber.extra_data`. Same pass-through contract
    as `entity_extra` — the service layer must treat it as opaque.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "phone_number": "+14155550002",
                "entity_type": "family",
                "target_phone_number": "+14155550001",
                "ingestion_source": "automated",
                "ingestion_reason": "First-degree family member of high-scoring target",
                "entity_extra": None,
                "phone_extra": None,
            }
        }
    )
