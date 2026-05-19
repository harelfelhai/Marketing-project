"""
schemas/entity_ingestion.py — Pydantic contracts for Phase E2: Entity Ingestion.

Single-entry channel only (Phase E2-A). Bulk-text and bulk-upload contracts
will be appended to this module in subsequent PRs (E2-B); keeping all three
channels in one schema file mirrors how `schemas/ingestion.py` colocates
Phase 1 contracts.

PRIVACY CONTRACT
----------------
`first_name` and `last_name` are human-readable identifiers and therefore
fall under the Secrets-Free Mandate — they MUST NOT land on schema-level
columns. The service layer merges both fields into `Entity.extra_data`
(the opaque JSON blob), preserving the invariant that the SQL schema
itself stores only structural integers and controlled-vocabulary strings.

The response model echoes the names back to the caller because the
operator-facing success panel needs them to render the "Person created"
confirmation chip and to seed the follow-on phone-ingestion modal. They
travel back over the wire on this single response only; they are NOT
persisted as queryable columns and DO NOT appear in any list endpoint.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from interfaces.relation_types import AssociatedRelationType


class EntitySingleCreateIn(BaseModel):
    """
    Request body for POST /api/v1/entities.

    The operator picks a target via the two-step client → target picker on
    the frontend; by the time the request reaches this endpoint, the
    target is a single opaque integer FK.

    The `relation_type` field is the operator-facing label — it is typed
    as `AssociatedRelationType`, which restricts the accepted values to
    the operator-creatable subset of the system vocabulary. Submitting
    'target' or 'social_envelope' is rejected at request-parse time with
    a 422 response listing the legal values.

    The `client_id` is NOT accepted on this request — it is derived
    server-side from the target Entity's own `client_id`. Accepting it
    here would invite drift between the new entity's partition and the
    target's partition; keeping the inheritance on the server eliminates
    a class of operator-error bugs.
    """

    first_name: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description=(
            "Given name of the new person. Trimmed of surrounding whitespace "
            "on the server. Stored in `Entity.extra_data['first_name']` — "
            "NEVER on a schema-level column (Secrets-Free Mandate)."
        ),
    )
    last_name: Optional[str] = Field(
        default=None,
        max_length=80,
        description=(
            "Family name of the new person. Optional — single-name entries "
            "(no surname known) are accepted. When provided, stored in "
            "`Entity.extra_data['last_name']`."
        ),
    )
    relation_type: AssociatedRelationType = Field(
        ...,
        description=(
            "How this person relates to the target. Constrained to the "
            "operator-creatable subset (`family`, `friend`, `colleague`, "
            "`spouse`). The value lands on `Entity.entity_type` at the DB "
            "layer (the operator-facing label says 'relation type' because "
            "it reads more naturally, but the column is `entity_type`)."
        ),
        examples=["family"],
    )
    target_entity_id: int = Field(
        ...,
        description=(
            "FK to the root target Entity this person is being associated "
            "with. Validated server-side: the target must exist AND must "
            "itself be a root target (its own `target_entity_id` IS NULL). "
            "Pointing at a non-root entity is rejected with 422."
        ),
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Optional opaque JSON blob merged into the new entity's "
            "`extra_data` alongside the names. Use for any proprietary "
            "per-person metadata (sourcing notes, scoring vectors, etc.) "
            "that operators want to attach at creation time."
        ),
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "first_name": "Jane",
                "last_name": "Doe",
                "relation_type": "family",
                "target_entity_id": 42,
                "extra_data": None,
            }
        }
    )


class EntitySingleCreateOut(BaseModel):
    """
    Response body for POST /api/v1/entities.

    Carries everything the operator-facing success panel needs to:
        1. Render the "Jane Doe was added" confirmation chip.
        2. Pre-fill the follow-on phone-ingestion modal with the correct
           target context (target_entity_id, client_id) and relation type
           (entity_type) so the operator can immediately attach a phone
           number without re-selecting the target.

    The names are echoed back for UX convenience only. They were merged
    into `extra_data` server-side; the response surfaces them as
    structured fields rather than asking the client to dig into the
    opaque blob.

    The `relation_type` field on the response mirrors what the operator
    submitted. It is typed as a plain string (not the enum) so the wire
    contract remains a literal token — Pydantic emits the enum's value
    on serialization, but consumers reading the JSON see `"family"`,
    not `"AssociatedRelationType.FAMILY"`.
    """

    id: int = Field(
        ...,
        description="Surrogate PK of the newly created Entity row.",
    )
    client_id: Optional[int] = Field(
        default=None,
        description=(
            "Integer client partition identifier, inherited from the "
            "target Entity. Null only if the target itself had no "
            "client_id (legacy seed rows). The frontend resolves this "
            "integer to a display name via `clientRegistry.js`."
        ),
    )
    relation_type: str = Field(
        ...,
        description=(
            "The relation token chosen by the operator. Echoed back as a "
            "plain string — same value the request supplied."
        ),
    )
    target_entity_id: int = Field(
        ...,
        description="FK to the root target Entity this person is associated with.",
    )
    first_name: str = Field(
        ...,
        description="Given name, echoed from the request (stored in extra_data).",
    )
    last_name: Optional[str] = Field(
        default=None,
        description="Family name, echoed from the request (stored in extra_data).",
    )
    created_at: datetime = Field(
        ...,
        description="UTC timestamp when the row was inserted.",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": 99,
                "client_id": 1,
                "relation_type": "family",
                "target_entity_id": 42,
                "first_name": "Jane",
                "last_name": "Doe",
                "created_at": "2026-05-19T10:00:00Z",
            }
        }
    )
