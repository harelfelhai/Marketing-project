"""
app/schemas/api_contracts.py — HTTP request and response Pydantic contracts.

This module defines the EXTERNAL API boundary: the exact shapes of data the
REST layer accepts from callers and guarantees to return. It is separate from
the internal `schemas/` package (which defines the ingestion/verification data
contracts between service layers).

DESIGN INVARIANTS
-----------------
1. Every response model is typed — no `dict` or `Any` in response_model.
2. Request models accept only the fields a caller is allowed to supply.
   Fields managed internally (e.g. timestamps, auto-PKs) are never writable.
3. Sensitive proprietary payload is accepted/returned only via `extra_data`
   opaque dict fields — field names inside that dict are never exposed here.
4. Paginated list responses always carry `total`, `page`, and `page_size` so
   the frontend can build pagination controls without a second round-trip.
"""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ===========================================================================
# SHARED PRIMITIVES
# ===========================================================================


class FormFieldOption(BaseModel):
    """A single selectable option within a 'select' form field."""

    value: str = Field(..., description="The machine-readable value submitted on form POST.")
    label: str = Field(..., description="The human-readable label rendered in the UI dropdown.")


class FormField(BaseModel):
    """
    Descriptor for a single field rendered by DynamicForm.jsx.

    The frontend component inspects `type` to choose the correct input widget
    (text, tel, select, checkbox, json_blob, etc.). It never has knowledge of
    any field name — it renders whatever this schema defines.
    """

    name: str = Field(
        ...,
        description="Machine-readable field key. Used as the payload key on form submit.",
    )
    type: str = Field(
        ...,
        description=(
            "Input widget type hint. The frontend maps this to a React component. "
            "Supported types (open repo): 'text', 'tel', 'select', 'textarea', 'json_blob'. "
            "Internal teams may introduce additional type strings by extending DynamicForm.jsx."
        ),
    )
    label: str = Field(..., description="Human-readable label displayed above the field.")
    required: bool = Field(..., description="Whether the field must be non-empty on submit.")
    options: Optional[List[FormFieldOption]] = Field(
        default=None,
        description="Populated only for 'select' type fields. Null for all other types.",
    )


# ===========================================================================
# DOMAIN A — UI & INGESTION (Phase 1)
# ===========================================================================


class LeadFormSchemaResponse(BaseModel):
    """
    Response contract for GET /api/v1/schema/lead-form.

    Returns the complete dynamic form descriptor consumed by DynamicForm.jsx
    on mount. The frontend renders exactly these fields, in this order, with
    these widget types. Internal teams extend this list to expose proprietary
    fields without any frontend code change.

    INTERNAL HOOK:
        The endpoint that returns this schema is the ONLY place where
        proprietary field names should ever appear. The open-source repo
        returns a generic baseline. In internal deployments, the endpoint
        can extend `fields` with company-specific entries.
    """

    fields: List[FormField] = Field(
        ...,
        description="Ordered list of form field descriptors. Rendered in list order.",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "fields": [
                    {
                        "name": "phone_number",
                        "type": "tel",
                        "label": "Phone Number",
                        "required": True,
                        "options": None,
                    },
                    {
                        "name": "entity_type",
                        "type": "text",
                        "label": "Relationship Type",
                        "required": True,
                        "options": None,
                    },
                ]
            }
        }
    )


class IngestionResponse(BaseModel):
    """
    Response contract for POST /api/v1/ingest.

    Serialises the newly created PhoneNumber row immediately after it is
    committed. The `entity_id` field gives the caller a reference to the
    associated Entity without requiring a second request.

    Fields intentionally excluded from this response:
        - `extra_data`: opaque proprietary blob; never echoed back at the
          API boundary to avoid inadvertent data leakage in logs.
        - All Phase 3 (verification) block fields: they are in their
          initial `pending` state and carry no information at ingest time.
    """

    id: int = Field(..., description="Surrogate PK of the new PhoneNumber row.")
    phone_number: str = Field(..., description="The ingested phone number (as stored).")
    entity_id: int = Field(..., description="PK of the Entity record that owns this number.")
    verification_status: str = Field(
        ...,
        description="Always 'pending' on fresh ingestion. Changes after Phase 3 evaluation.",
    )
    ingestion_source: str = Field(
        ...,
        description="Origin channel of this ingestion (e.g. 'manual', 'automated').",
    )
    ingestion_reason: Optional[str] = Field(
        default=None,
        description="Operator note or algorithmic justification (may be null).",
    )
    ingested_at: datetime = Field(
        ...,
        description="UTC timestamp when this number entered the pipeline.",
    )
    created_at: datetime = Field(..., description="UTC row-creation timestamp.")

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# DOMAIN B — EXECUTION & RECOVERY (Phase 2)
# ===========================================================================


class ManualActionTriggerRequest(BaseModel):
    """
    Request body for POST /api/v1/actions/trigger.

    An operator selects a phone number in the UI and fires a named action.
    The `operator_id` is stored in `ActionLog.extra_data` for full audit
    traceability — it is never lost between the request and the persisted row.
    """

    phone_id: int = Field(
        ...,
        description="PK of the PhoneNumber row to dispatch the action against.",
        examples=[42],
    )
    action_type: str = Field(
        ...,
        description=(
            "Token identifying which outbound action to execute. "
            "Must match a registered handler in the ActionDispatcher registry. "
            "In the open environment, the default catch-all handler accepts any token."
        ),
        examples=["advertisement_type_a"],
    )
    operator_id: str = Field(
        ...,
        description="Identifier of the human operator submitting this trigger (e.g. username).",
        examples=["operator_007"],
    )


class RetryNowRequest(BaseModel):
    """
    Optional request body for POST /api/v1/actions/retry-now/{log_id}.

    Carries optional operator attribution for the force-retry. If omitted,
    the retry is logged without an operator stamp.
    """

    operator_id: Optional[str] = Field(
        default=None,
        description="Operator ID to stamp on the retried ActionLog row. Optional.",
        examples=["admin_user"],
    )


class PhoneUpdateRequest(BaseModel):
    """
    Request body for PATCH /api/v1/phones/{phone_id}.

    Only the fields listed here may be mutated by external callers. All
    Phase 3 verification fields are intentionally excluded — those are
    written exclusively by VerificationService.

    Any non-null field in this payload will be applied to the PhoneNumber row.
    A null value means "leave unchanged" — this is a true partial update.
    """

    classification_type: Optional[str] = Field(
        default=None,
        description=(
            "Internal system classification label. "
            "Set to a non-null string to update; leave null to leave unchanged. "
            "Allowed values are defined by the internal classification taxonomy."
        ),
        examples=["tier_a"],
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Opaque JSON blob update. Replaces (does NOT merge with) the existing "
            "`PhoneNumber.extra_data` value. Pass the full desired state. "
            "Leave null to leave existing extra_data unchanged."
        ),
    )


# ===========================================================================
# DOMAIN C — QUALITY AUDIT (Phase 3)
# ===========================================================================


class VerificationVerdictRequest(BaseModel):
    """
    Request body for POST /api/v1/verification/verdict.

    Carries a human operator's manual quality judgment about a phone number.
    The verdict is written to the Phase 3 block of the PhoneNumber via
    VerificationService, which ensures the write is atomic and consistent
    with the automated verification path.
    """

    phone_id: int = Field(
        ...,
        description="PK of the PhoneNumber row being judged.",
        examples=[99],
    )
    status: str = Field(
        ...,
        description=(
            "The quality verdict to persist. "
            "Example values: 'verified_good', 'verified_bad'. "
            "Internal teams may introduce additional status values without schema changes."
        ),
        examples=["verified_good"],
    )
    reason: str = Field(
        ...,
        description="Human-readable justification for the verdict.",
        examples=["Confirmed active number via manual callback."],
    )
    extra_metadata: Optional[dict] = Field(
        default=None,
        description=(
            "Optional structured metadata from the operator or tool that produced "
            "the verdict. Merged (non-destructively) into PhoneNumber.extra_data."
        ),
    )


# ===========================================================================
# DOMAIN D — QUERIES, MONITORING & SYSTEM CONTROLS
# ===========================================================================

# ---------------------------------------------------------------------------
# Sub-objects used as nested fields inside list and detail responses
# ---------------------------------------------------------------------------


class EntitySummary(BaseModel):
    """
    Compact representation of an Entity record, embedded inside phone responses.

    Exposes the relationship graph fields but deliberately omits `extra_data`
    to prevent proprietary payload from leaking into list-view responses.
    """

    id: int = Field(..., description="Entity surrogate PK.")
    client_id: Optional[int] = Field(
        default=None,
        description=(
            "Integer client partition identifier. Frontend maps this to a display name. "
            "Null for entities not yet assigned to a client partition."
        ),
    )
    relation_type: str = Field(
        ...,
        description=(
            "Structural relation category: 'primary' (direct target) or "
            "'associated' (perimeter circle-of-trust contact)."
        ),
    )
    entity_type: str = Field(
        ...,
        description="Sub-classification within the relation_type (e.g. 'family', 'friend').",
    )
    target_entity_id: Optional[int] = Field(
        default=None,
        description="FK to the primary target Entity. Null if this entity IS the target.",
    )
    created_at: datetime = Field(..., description="UTC row-creation timestamp.")

    model_config = ConfigDict(from_attributes=True)


class ActionLogResponse(BaseModel):
    """
    Full representation of a single ActionLog row.

    Used as:
        - Items in ActionLogListResponse (audit log view).
        - Items in PhoneDetailsResponse.action_timeline (phone detail view).
        - Direct response for POST /actions/trigger and POST /actions/retry-now.
    """

    id: int = Field(..., description="ActionLog surrogate PK.")
    phone_id: int = Field(..., description="FK to the targeted PhoneNumber.")
    action_type: str = Field(..., description="Token of the action type executed.")
    status: str = Field(
        ...,
        description=(
            "Execution state. Values: 'pending', 'sent', 'failed', "
            "'delivered', 'scheduled_retry', 'retrying'."
        ),
    )
    requested_at: datetime = Field(..., description="UTC timestamp when the action was queued.")
    executed_at: Optional[datetime] = Field(
        default=None,
        description="UTC timestamp of the completed dispatch attempt. Null while pending.",
    )
    retry_count: int = Field(
        ...,
        description="Number of retry cycles this row has undergone. 0 on fresh dispatch.",
    )
    retry_after: Optional[datetime] = Field(
        default=None,
        description="UTC backoff deadline. RetryEngine skips this row until after this time.",
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Handler result payload (success) or error details (failure). "
            "Includes operator attribution if triggered manually."
        ),
    )
    created_at: datetime = Field(..., description="UTC row-creation timestamp.")
    updated_at: datetime = Field(..., description="UTC timestamp of the last state update.")

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Paginated list envelopes
# ---------------------------------------------------------------------------


class PhoneSummary(BaseModel):
    """
    Compact PhoneNumber row returned as an item in PhoneListResponse.

    Includes `entity_type` and `client_id` sourced from the JOIN with Entity
    so the operator grid shows client partition and relationship context without
    a secondary request.
    `extra_data` is intentionally excluded from the list view to prevent
    mass proprietary data exposure in large result sets.
    """

    id: int = Field(..., description="PhoneNumber surrogate PK.")
    phone_number: str = Field(..., description="The stored phone number string.")
    entity_id: int = Field(..., description="FK to the owning Entity.")
    client_id: Optional[int] = Field(
        default=None,
        description="Integer client partition identifier sourced from the owning Entity.",
    )
    entity_type: str = Field(
        ...,
        description="Relationship classification of the owning Entity.",
    )
    classification_type: Optional[str] = Field(
        default=None,
        description="Internal system classification label (null if not yet classified).",
    )
    verification_status: str = Field(
        ...,
        description=(
            "Phase 3 quality state. Filter on 'pending' to use this endpoint "
            "as the operator task queue."
        ),
    )
    verification_source: Optional[str] = Field(
        default=None,
        description="Origin of the most recent verification verdict.",
    )
    ingestion_source: str = Field(
        ...,
        description="Origin channel of this ingestion.",
    )
    ingested_at: datetime = Field(
        ...,
        description="UTC timestamp when this number entered the pipeline.",
    )
    created_at: datetime = Field(..., description="UTC row-creation timestamp.")


class PhoneListResponse(BaseModel):
    """
    Paginated envelope for GET /api/v1/phones.

    `total` reflects the count BEFORE pagination is applied, so the frontend
    can correctly compute the total number of pages.
    """

    items: List[PhoneSummary] = Field(..., description="Phone records for the current page.")
    total: int = Field(
        ...,
        description="Total number of records matching the applied filters.",
    )
    page: int = Field(..., description="1-based current page number.", ge=1)
    page_size: int = Field(..., description="Number of records per page.", ge=1)


class ActionLogListResponse(BaseModel):
    """
    Paginated envelope for GET /api/v1/actions/logs.

    Because status is a query parameter (not a dedicated endpoint), the full
    audit log table is accessible from a single route. The frontend can reach
    any logical sub-view by setting `?status=failed` or `?status=scheduled_retry`.
    """

    items: List[ActionLogResponse] = Field(
        ...,
        description="ActionLog rows for the current page.",
    )
    total: int = Field(
        ...,
        description="Total number of rows matching the applied filters.",
    )
    page: int = Field(..., description="1-based current page number.", ge=1)
    page_size: int = Field(..., description="Number of records per page.", ge=1)


# ---------------------------------------------------------------------------
# Detail response
# ---------------------------------------------------------------------------


class PhoneDetailsResponse(BaseModel):
    """
    Full-detail response for GET /api/v1/phones/{phone_id}.

    Returns the complete three-phase lifecycle picture for one phone number:
        - Phase 1 ingestion block (how/why it entered the system).
        - Phase 3 verification block (current quality assessment state).
        - Phase 2 action timeline (chronological history of all dispatches).
        - Nested Entity summary (relationship graph context).

    The `action_timeline` list is ordered most-recent-first, matching the
    natural operator reading order when auditing a phone's history.
    """

    id: int = Field(..., description="PhoneNumber surrogate PK.")
    phone_number: str = Field(..., description="The stored phone number string.")
    entity_id: int = Field(..., description="FK to the owning Entity.")

    # Mutable classification field
    classification_type: Optional[str] = Field(
        default=None,
        description="Internal system classification label.",
    )

    # Phase 1 block
    ingestion_source: str = Field(..., description="Origin channel of this ingestion.")
    ingestion_reason: Optional[str] = Field(
        default=None,
        description="Operator note or algorithmic justification for ingestion.",
    )
    ingested_at: datetime = Field(
        ...,
        description="UTC timestamp when this number entered the pipeline.",
    )

    # Phase 3 block
    verification_status: str = Field(
        ...,
        description="Phase 3 quality state (e.g. 'pending', 'verified_good', 'verified_bad').",
    )
    verification_source: Optional[str] = Field(
        default=None,
        description="Origin of the most recent verification verdict.",
    )
    verification_reason: Optional[str] = Field(
        default=None,
        description="Justification for the most recent verification verdict.",
    )
    verified_at: Optional[datetime] = Field(
        default=None,
        description="UTC timestamp of the most recent verification verdict.",
    )

    # Proprietary payload
    extra_data: Optional[dict] = Field(
        default=None,
        description="Opaque JSON bucket for proprietary phase metadata.",
    )

    # Timestamps
    created_at: datetime = Field(..., description="UTC row-creation timestamp.")
    updated_at: datetime = Field(..., description="UTC timestamp of the last update.")

    # Nested objects
    entity: EntitySummary = Field(
        ...,
        description="Summary of the Entity that owns this phone number.",
    )
    action_timeline: List[ActionLogResponse] = Field(
        ...,
        description=(
            "Complete Phase 2 dispatch history for this phone, "
            "ordered most-recent-first."
        ),
    )

    model_config = ConfigDict(from_attributes=True)


class PhoneUpdateResponse(BaseModel):
    """
    Response contract for PATCH /api/v1/phones/{phone_id}.

    Returns the updated phone record plus the ActionLog created by
    ActionDataTriggerService if a failed action was re-dispatched as a
    side-effect of the field update. `triggered_action` is null when no
    failed action existed or the trigger allowlist did not match.
    """

    phone: IngestionResponse = Field(
        ...,
        description="The PhoneNumber row after the PATCH was applied.",
    )
    triggered_action: Optional[ActionLogResponse] = Field(
        default=None,
        description=(
            "New ActionLog row if ActionDataTriggerService fired a re-dispatch. "
            "Null if no trigger condition was met."
        ),
    )


# ---------------------------------------------------------------------------
# System controls
# ---------------------------------------------------------------------------


class WorkerRunResponse(BaseModel):
    """
    Response contract for POST /api/v1/system/workers/run.

    Reports the outcome of a synchronous background-worker invocation.
    The `processed_count` meaning depends on which worker was run:
        - 'retry':        number of ActionLog rows successfully re-dispatched.
        - 'verification': number of PhoneNumbers successfully evaluated and updated.
    """

    worker_name: str = Field(
        ...,
        description="Name of the worker that was executed ('retry' or 'verification').",
    )
    processed_count: int = Field(
        ...,
        description="Number of records successfully processed in this run.",
    )
    started_at: datetime = Field(
        ...,
        description="UTC timestamp immediately before the worker began execution.",
    )
    completed_at: datetime = Field(
        ...,
        description="UTC timestamp immediately after the worker finished execution.",
    )


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class DashboardMetricsResponse(BaseModel):
    """
    Response contract for GET /api/v1/dashboard/metrics.

    Aggregates live counts across the PhoneNumber and ActionLog tables.
    All counts reflect the state of the database at query time — there is
    no caching layer. For high-traffic deployments, add a materialized view
    or cache in front of this endpoint.

    Counts-by-status dicts have dynamic keys: the status string is the key,
    the record count is the value. This allows internal teams to add new
    status values without changing this schema.
    """

    total_phones: int = Field(
        ...,
        description="Total PhoneNumber rows in the database.",
    )
    phones_by_verification_status: Dict[str, int] = Field(
        ...,
        description=(
            "Record count per verification_status value. "
            "Example: {'pending': 150, 'verified_good': 80, 'verified_bad': 20}."
        ),
    )
    total_actions: int = Field(
        ...,
        description="Total ActionLog rows in the database.",
    )
    actions_by_status: Dict[str, int] = Field(
        ...,
        description=(
            "Record count per action status value. "
            "Example: {'sent': 320, 'failed': 12, 'scheduled_retry': 5}."
        ),
    )
    retry_queue_depth: int = Field(
        ...,
        description="Count of ActionLog rows currently in 'scheduled_retry' status.",
    )
    overdue_retries: int = Field(
        ...,
        description=(
            "Count of 'scheduled_retry' rows whose retry_after timestamp is in "
            "the past — i.e. they are eligible for immediate pickup by RetryEngine."
        ),
    )
