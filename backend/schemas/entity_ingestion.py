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

The bulk endpoints share the `BulkIngestSummary` response shape from
`app/schemas/api_contracts.py` — they re-use Phase E1's response
contract so the frontend's BulkResultPanel renders both phone-side
and entity-side bulk submissions identically.

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
from typing import List, Optional

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
    target_entity_id: str = Field(
        ...,
        description=(
            "FK to the root target Entity this person is being associated "
            "with. Validated server-side: the target must exist AND must "
            "itself be a root target (its own `target_entity_id` IS NULL). "
            "Pointing at a non-root entity is rejected with 422."
        ),
    )
    strong_identifier: Optional[str] = Field(
        default=None,
        max_length=80,
        description=(
            "UAT round-3 — optional external identifier (national id, "
            "employee number, etc.). Stored in Entity.strong_identifier "
            "as a first-class indexed column."
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

    id: str = Field(
        ...,
        description="Surrogate PK of the newly created Entity row.",
    )
    client_id: Optional[str] = Field(
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
    target_entity_id: str = Field(
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


# ===========================================================================
# Phase E2-B — Bulk-text (Two-Step grid) request contracts
# ===========================================================================


class EntityBulkTextRow(BaseModel):
    """
    One row inside an `EntityBulkTextIn` payload.

    The frontend tokenizes the operator's raw paste (Step 1) and renders
    the inline editor grid (Step 2). By the time a request reaches the
    server, each row is a curated typed record — not raw text.

    Per-row `relation_type` and `target_entity_id` are OPTIONAL: when
    null, the row inherits the request-level default. Operators who
    want most rows uniform set the defaults once at the modal level
    and only override the few rows that differ.
    """

    row_token: str = Field(
        ...,
        max_length=200,
        description=(
            "The original token from the operator's Step-1 paste, "
            "preserved verbatim for audit. Round-trips into "
            "`Entity.extra_data['row_token']` so failed-row reports can "
            "be matched back to the operator's original input by the "
            "client-side grid. Empty string is acceptable for rows the "
            "operator added manually inside the grid."
        ),
    )
    first_name: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Given name. Required for every row.",
    )
    last_name: Optional[str] = Field(
        default=None,
        max_length=80,
        description="Family name. Optional — single-name rows accepted.",
    )
    relation_type: Optional[AssociatedRelationType] = Field(
        default=None,
        description=(
            "Per-row override of the request-level "
            "`default_relation_type`. Null means 'inherit'. When "
            "provided, must be one of the operator-creatable tokens."
        ),
    )
    target_entity_id: Optional[str] = Field(
        default=None,
        description=(
            "Per-row override of the request-level "
            "`default_target_entity_id`. Null means 'inherit'. When "
            "provided, the row's target must exist and be a root "
            "target (its own `target_entity_id` IS NULL); failures "
            "land as per-row failures, NOT a request abort."
        ),
    )
    strong_identifier: Optional[str] = Field(
        default=None,
        max_length=80,
        description=(
            "UAT round-3 — optional per-row external identifier "
            "(national id / employee number). Stored in "
            "Entity.strong_identifier as a first-class indexed column."
        ),
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Per-row opaque blob. Merged into Entity.extra_data "
            "alongside the names. Used for any per-row metadata that "
            "isn't a first-class column."
        ),
    )


class EntityBulkTextIn(BaseModel):
    """
    Request body for POST /api/v1/entities/bulk-text.

    The two defaults are required because every row needs SOME source
    for its relation_type and target_entity_id. Rows that don't
    override the defaults inherit them. Rows that override them ride
    their own validation path.

    The `rows` cap (500) matches the practical UI ceiling — operators
    pasting more than 500 names at once should use bulk-upload
    instead, which is built for that scale.
    """

    default_relation_type: AssociatedRelationType = Field(
        ...,
        description=(
            "Modal-level default applied to every row whose "
            "per-row `relation_type` is null."
        ),
    )
    default_target_entity_id: str = Field(
        ...,
        description=(
            "Modal-level default target FK applied to every row whose "
            "per-row `target_entity_id` is null. Validated as a "
            "request-level error (422) — if the default itself doesn't "
            "resolve to a root target, the whole submission aborts. "
            "Per-row target OVERRIDES that don't resolve are "
            "per-row failures inside the 200 response."
        ),
    )
    rows: List[EntityBulkTextRow] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="One typed record per operator-grid row. 1..500 entries.",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "default_relation_type": "family",
                "default_target_entity_id": 42,
                "rows": [
                    {
                        "row_token": "Jane Doe",
                        "first_name": "Jane",
                        "last_name": "Doe",
                        "relation_type": None,
                        "target_entity_id": None,
                    },
                    {
                        "row_token": "Sam Chen",
                        "first_name": "Sam",
                        "last_name": "Chen",
                        "relation_type": "colleague",
                        "target_entity_id": None,
                    },
                ],
            }
        }
    )
