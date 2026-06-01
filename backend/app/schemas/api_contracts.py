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

    id: str = Field(..., description="Surrogate PK of the new PhoneNumber row.")
    phone_number: str = Field(..., description="The ingested phone number (as stored).")
    entity_id: str = Field(..., description="PK of the Entity record that owns this number.")
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

    # Phase DY — the scoring block is populated by the time this response
    # is built, because ingestion triggers the initial recalc inside the
    # same transaction.
    confidence_score: float = Field(
        ...,
        description="Reliability score (defaults to settings.scoring_default_confidence on insert).",
    )
    priority_score: float = Field(
        ...,
        description="Initial priority score computed by ScoringService at ingest time.",
    )
    confidence_updated_at: Optional[datetime] = Field(
        default=None,
        description="Last write timestamp of confidence_score. Null on fresh ingest.",
    )
    priority_updated_at: Optional[datetime] = Field(
        default=None,
        description="Last write timestamp of priority_score. Populated by the initial ingest recalc.",
    )

    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# DOMAIN B — EXECUTION & RECOVERY (Phase 2)
# ===========================================================================


class ManualActionTriggerRequest(BaseModel):
    """
    Request body for POST /api/v1/actions/trigger.

    Phase AUTH-B: the operator_id field has been removed. The endpoint
    requires authentication; the operator's username is taken from the
    session cookie (`Depends(require_authenticated_user)`) and stamped
    onto `ActionLog.extra_data` server-side. Callers can no longer
    spoof attribution.
    """

    phone_id: str = Field(
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


class RetryNowRequest(BaseModel):
    """
    Request body for POST /api/v1/actions/retry-now/{log_id}.

    Phase AUTH-B: the operator_id field has been removed. The endpoint
    requires authentication; the operator's username is read from the
    session and recorded on the retried ActionLog row.

    The body itself now carries nothing — kept as a model to preserve
    the endpoint's POST shape and to leave room for future fields.
    """

    # Empty body. Pydantic accepts {} or no body for endpoints that
    # need only the URL path param.
    pass


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
    confidence_score: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description=(
            "Phase DY — operator-supplied confidence score (0.0 → 100.0). "
            "When provided, the value is written to `confidence_score`, "
            "`confidence_updated_at` is bumped, and `priority_score` is "
            "recomputed atomically by ScoringService. Leave null to leave "
            "confidence unchanged. The 0..100 range is enforced at the "
            "API boundary; the DB column itself is unconstrained to allow "
            "internal strategies that use other scales."
        ),
        examples=[85.0],
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

    Phase DY-4 — TWO-AXIS contract.
    -----------------------------------------------------------------
    The legacy single-status flow (`status` + `reason`) is preserved
    for backwards compatibility. Phase DY-4 callers MAY additionally
    send `phone_axis`, `relation_axis`, and `identification` to express
    feedback on the two independent truth axes (phone-to-person and
    person-to-target) and to promote an envelope entity to a named
    identity in the same atomic transaction.

    Submission shapes supported:
      A. Legacy single-axis:    { phone_id, status, reason, extra_metadata? }
      B. Two-axis only:         { phone_id, phone_axis?, relation_axis?, ... }
      C. Envelope identify:     { phone_id, identification: {...}, ... }
      D. Combined:              any mix of A + B + C in one request

    At least ONE of {status, phone_axis, relation_axis, identification}
    must be present — an empty submission is rejected with 422.
    """

    phone_id: str = Field(
        ...,
        description="PK of the PhoneNumber row being judged.",
        examples=[99],
    )

    # ---- Legacy single-axis fields (kept for backwards compatibility) ----
    status: Optional[str] = Field(
        default=None,
        description=(
            "Legacy single-status verdict. Optional in the Phase DY-4 contract; "
            "if provided, written to PhoneNumber.verification_status. "
            "Example values: 'verified_good', 'verified_bad'."
        ),
        examples=["verified_good"],
    )
    reason: Optional[str] = Field(
        default=None,
        description="Human-readable justification for the verdict. Required when `status` is provided.",
    )
    extra_metadata: Optional[dict] = Field(
        default=None,
        description=(
            "Optional structured metadata from the operator or tool that produced "
            "the verdict. Merged (non-destructively) into PhoneNumber.extra_data."
        ),
    )

    # ---- Phase DY-4 two-axis fields ----
    phone_axis: Optional[str] = Field(
        default=None,
        pattern="^(confirm|refute)$",
        description=(
            "Phase DY-4 — phone-to-person axis feedback. "
            "'confirm' → confidence_score=100. 'refute' → confidence_score=0. "
            "Triggers ScoringService recalculation in the same transaction. "
            "Leave null when the operator has no opinion on this axis."
        ),
        examples=["confirm"],
    )
    relation_axis: Optional[str] = Field(
        default=None,
        pattern="^(confirm|refute)$",
        description=(
            "Phase DY-4 — person-to-target axis feedback. "
            "'confirm' → relation stays intact, verification_status='verified_good'. "
            "'refute'  → target_entity_id set to NULL, verification_status='verified_bad'. "
            "Leave null when the operator has no opinion on this axis."
        ),
        examples=["confirm"],
    )
    identification: Optional["EntityIdentification"] = Field(
        default=None,
        description=(
            "Phase DY-4 — promote a social_envelope entity to a named identity. "
            "Only applies when the owning entity is currently a 'social_envelope'. "
            "All four fields are optional individually; if none are provided the "
            "block has no effect."
        ),
    )


class EntityIdentification(BaseModel):
    """
    Optional sub-block of `VerificationVerdictRequest` (Phase DY-4).

    Captures the operator's identification of an envelope's owner. When
    applied, the owning entity's `entity_type` is promoted from
    `social_envelope` to the chosen `relation` (or 'identified_envelope'
    when relation is left null — the "partial identification" state).
    """

    first_name: Optional[str] = Field(default=None, description="Owner's first name.")
    last_name:  Optional[str] = Field(default=None, description="Owner's last name.")
    relation:   Optional[str] = Field(
        default=None,
        description=(
            "New entity_type token. When provided, the entity is promoted off "
            "'social_envelope'. Common values: 'target', 'family', 'friend', "
            "'colleague', 'spouse', 'unrelated'. When null, the entity is "
            "promoted to 'identified_envelope' as a holding state."
        ),
        examples=["spouse"],
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

    id: str = Field(..., description="Entity surrogate PK.")
    client_id: Optional[str] = Field(
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
    target_entity_id: Optional[str] = Field(
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

    id: str = Field(..., description="ActionLog surrogate PK.")
    phone_id: str = Field(..., description="FK to the targeted PhoneNumber.")
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

    id: str = Field(..., description="PhoneNumber surrogate PK.")
    phone_number: str = Field(..., description="The stored phone number string.")
    entity_id: str = Field(..., description="FK to the owning Entity.")
    client_id: Optional[str] = Field(
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

    # ------------------------------------------------------------------
    # Phase DY — scoring block (flattened JOIN result)
    # ------------------------------------------------------------------
    confidence_score: float = Field(
        ...,
        description="Reliability score (0.0 → 100.0 by convention).",
    )
    confidence_updated_at: Optional[datetime] = Field(
        default=None,
        description="Last write timestamp of confidence_score. Null until audited.",
    )
    priority_score: float = Field(
        ...,
        description=(
            "Final urgency score driving the prioritised queue ordering. "
            "Convention: 0.0 → 100.0; values outside that range are valid."
        ),
    )
    priority_updated_at: Optional[datetime] = Field(
        default=None,
        description="Last write timestamp of priority_score.",
    )
    customer_tier: Optional[int] = Field(
        default=None,
        description=(
            "Tier of the owning client, extracted server-side from the "
            "root target Entity's `extra_data['customer_tier']` JSON key. "
            "Null when the root entity has no tier hint."
        ),
    )


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

    id: str = Field(..., description="PhoneNumber surrogate PK.")
    phone_number: str = Field(..., description="The stored phone number string.")
    entity_id: str = Field(..., description="FK to the owning Entity.")

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

    # Phase DY block
    confidence_score: float = Field(
        ...,
        description="Reliability score (0.0 → 100.0 by convention).",
    )
    confidence_updated_at: Optional[datetime] = Field(
        default=None,
        description="Last write timestamp of confidence_score.",
    )
    priority_score: float = Field(
        ...,
        description="Final urgency score driving the prioritised queue ordering.",
    )
    priority_updated_at: Optional[datetime] = Field(
        default=None,
        description="Last write timestamp of priority_score.",
    )
    customer_tier: Optional[int] = Field(
        default=None,
        description=(
            "Tier of the owning client, extracted server-side from the "
            "root target Entity's extra_data."
        ),
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


# ===========================================================================
# DOMAIN E — OPERATIONS TASK QUEUE (Phase DX)
# ===========================================================================
# Stateful work-order surface. The backend records and reads the queue; all
# permission gating around resolution lives at the frontend boundary via the
# auth seam (`MockAuthContext`) until Phase G activates.


class PipelineTaskResponse(BaseModel):
    """
    Flat task row — same shape returned by list, detail, and write endpoints.

    JOIN convenience fields (`phone_number`, `entity_id`, `entity_type`,
    `client_id`) are populated by the service layer's JOIN with PhoneNumber
    and Entity so the OperationsQueue can render a 5-column row without a
    secondary lookup per task. The integer `client_id` stays opaque on the
    wire; the frontend resolves it to a display name via clientRegistry.js.
    """

    id: str = Field(..., description="PipelineTask surrogate PK.")
    phone_id: str = Field(..., description="FK to the PhoneNumber this task is about.")
    source_action_log_id: Optional[str] = Field(
        default=None,
        description=(
            "FK to the originating ActionLog when the task was opened by the "
            "automation layer in response to a specific failure. Null for "
            "operator-opened tasks."
        ),
    )
    task_type: str = Field(
        ...,
        description=(
            "Task classification token. Current vocabulary: "
            "'remediation_failure' | 'approval_required' | 'manual_recommendation'."
        ),
    )
    status: str = Field(
        ...,
        description=(
            "Lifecycle state. Current vocabulary: "
            "'pending' | 'assigned' | 'resolved' | 'rejected'."
        ),
    )
    requested_by: str = Field(
        ...,
        description="operator_id of the human or system that opened the task.",
    )
    resolved_by: Optional[str] = Field(
        default=None,
        description=(
            "operator_id of the Senior Admin who terminally settled the task. "
            "Null while status is 'pending' or 'assigned'."
        ),
    )
    created_at: datetime = Field(..., description="UTC row-creation timestamp.")
    updated_at: datetime = Field(..., description="UTC timestamp of the last state update.")
    resolved_at: Optional[datetime] = Field(
        default=None,
        description="UTC timestamp set the moment the task entered a terminal state.",
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Opaque JSON bucket for proprietary failure-category / requested-action "
            "payload and resolution metadata. The OperationsQueue drawer renders "
            "this via JsonMetadataExplorer."
        ),
    )

    # ---- JOIN convenience fields (sourced from PhoneNumber ⟕ Entity) ----
    phone_number: Optional[str] = Field(
        default=None,
        description="Echoed from PhoneNumber.phone_number via JOIN.",
    )
    entity_id: Optional[str] = Field(
        default=None,
        description="Echoed from PhoneNumber.entity_id via JOIN.",
    )
    entity_type: Optional[str] = Field(
        default=None,
        description="Echoed from Entity.entity_type via JOIN.",
    )
    client_id: Optional[str] = Field(
        default=None,
        description=(
            "Integer client partition identifier sourced from the owning Entity. "
            "Opaque on the backend; frontend resolves the display name."
        ),
    )

    model_config = ConfigDict(from_attributes=True)


class PipelineTaskListResponse(BaseModel):
    """
    Paginated envelope for GET /api/v1/tasks.

    Mirrors the PhoneListResponse / ActionLogListResponse shape so the
    frontend's `paginationAdapter.unwrapPage()` strips the envelope
    identically across all three list endpoints.
    """

    items: List[PipelineTaskResponse] = Field(
        ...,
        description="PipelineTask rows for the current page.",
    )
    total: int = Field(
        ...,
        description="Total number of rows matching the applied filters.",
    )
    page: int = Field(..., description="1-based current page number.", ge=1)
    page_size: int = Field(..., description="Number of records per page.", ge=1)


class OpenTaskRequest(BaseModel):
    """
    Request body for POST /api/v1/tasks.

    Opens a new pending task. The `requested_by` field carries the
    operator_id from the frontend's auth seam (or an engine identifier
    string for automation-opened tasks).

    `source_action_log_id` is validated against `phone_id`: if the
    referenced ActionLog exists, it must belong to the same phone or the
    request is rejected as 422.

    Phase AUTH-B: `requested_by` is now OPTIONAL.
      - Operator-driven calls (logged-in users) → field is ignored;
        the endpoint stamps `current_user.username` on the row.
      - Automation calls (no session) → field is read verbatim
        (e.g. `'automation:retry_engine'`). This is the SOLE
        ungated task endpoint precisely because automation needs to
        open tasks without a session.
    """

    phone_id: str = Field(..., description="FK to the target PhoneNumber.")
    task_type: str = Field(
        ...,
        min_length=1,
        description=(
            "Task classification token. Free-form string (no enum at the API "
            "boundary so new task_type values can be introduced without a "
            "contract change)."
        ),
    )
    # Phase AUTH-B: optional. Operators with a session don't get to
    # set this — the endpoint overrides with current_user.username.
    # Automation (no session) sets the engine identifier here.
    requested_by: Optional[str] = Field(
        default=None,
        min_length=1,
        description=(
            "Automation-only field carrying the engine identifier "
            "(e.g. 'automation:retry_engine'). IGNORED when a logged-"
            "in operator opens the task — current_user.username wins."
        ),
    )
    source_action_log_id: Optional[str] = Field(
        default=None,
        description=(
            "Optional FK to the originating ActionLog. Required for "
            "task_type='remediation_failure' by convention, but the backend "
            "does not enforce per-type required fields."
        ),
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Opaque JSON payload — failure category tokens, requested-action "
            "parameters, etc. Stored verbatim on the new task."
        ),
    )


# ===========================================================================
# DOMAIN H — TABLE EXPORT (Phase EXP)
# ===========================================================================
# Generic Excel-export contracts shared by every exportable tabular view.
# Each table has its own endpoint (POST /api/v1/{table}/export) but the
# request and column-descriptor shapes are identical.


class TableExportColumn(BaseModel):
    """
    One column descriptor inside a TableExportRequest.

    The frontend supplies BOTH the structural `key` (what to look up
    server-side) AND the operator-facing `label` (what to write into
    the .xlsx header row). Keeping the label here — rather than
    server-side — preserves the Secrets-Free Mandate: the backend
    never stores Hebrew display strings, but operators still see
    Hebrew column headers in their exported files because the request
    body carries them through.
    """

    key: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description=(
            "Column identifier. Either a flat field on the row "
            "(`phone_number`, `status`) or a dotted path into the "
            "opaque `extra_data` blob (`extra_data.first_name`). "
            "Validated against the per-table allowlist server-side; "
            "out-of-allowlist keys are rejected with 422."
        ),
    )
    label: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description=(
            "Display string written verbatim into the .xlsx header "
            "row. Typically a Hebrew string from the frontend's "
            "exportCatalog. The backend does NOT validate or "
            "translate this — it's pass-through data."
        ),
    )
    format: Optional[str] = Field(
        default="text",
        pattern="^(text|number|number2|datetime)$",
        description=(
            "Cell-type token. `text` (default), `number`, `number2` "
            "(2-decimal float), or `datetime`. Drives openpyxl cell "
            "typing so operators can sort and filter natively in Excel."
        ),
    )


class TableExportRequest(BaseModel):
    """
    Request body for POST /api/v1/{table}/export.

    The `filters` shape mirrors the corresponding list endpoint's
    query params — same keys, same semantics — so "what you see is
    what you export" is enforced at the query layer. Unknown filter
    keys are ignored server-side (forward-compatible).
    """

    filters: dict = Field(
        default_factory=dict,
        description=(
            "Same key/value shape as the list endpoint's query string. "
            "Example for /phones: "
            "`{verification_status: 'pending', client_id: 1, q: '+972'}`."
        ),
    )
    columns: List[TableExportColumn] = Field(
        ...,
        min_length=1,
        max_length=50,
        description=(
            "1..50 column descriptors. Order in the list is the "
            "column order in the exported sheet."
        ),
    )
    filename_hint: Optional[str] = Field(
        default=None,
        max_length=40,
        description=(
            "Optional operator-supplied label inserted into the "
            "default `{table}_{label}_{date}.xlsx` filename. Safe-"
            "sanitized server-side to A-Za-z0-9_-."
        ),
    )


class BulkResolveTaskRequest(BaseModel):
    """
    Request body for POST /api/v1/tasks/bulk-status.

    Lets a manager settle many tasks in one round-trip — e.g., after
    handling a wave of related approval requests offline, mark all of
    them resolved with one click rather than N drawer-opens.

    Per-task failures (task already terminal, task missing) land in the
    response's `failed_rows`. Only request-shape errors (empty id list,
    bad outcome, etc.) raise 4xx — matches the Phase E1 bulk-ingestion
    resilience contract.
    """

    task_ids: List[str] = Field(
        ...,
        min_length=1,
        max_length=200,
        description=(
            "PKs to settle. 1..200 entries per request. Larger batches "
            "should be split client-side — 200 is the UI ceiling and "
            "also the per-request transaction budget."
        ),
    )
    outcome: str = Field(
        ...,
        pattern="^(resolved|rejected)$",
        description=(
            "Terminal status to write on every settled task. Must be "
            "'resolved' or 'rejected' — same vocabulary as the singular "
            "resolve endpoint."
        ),
    )
    # Phase AUTH-B: operator_id removed. Endpoint reads from the
    # session via Depends(require_admin).
    resolution_note: Optional[str] = Field(
        default=None,
        description=(
            "Optional free-text justification. Merged into every "
            "settled task's `extra_data['resolution_note']`. Stored "
            "as a single shared string across all settled tasks — the "
            "audit trail records the batch decision."
        ),
    )


class BulkResolveTaskFailedRow(BaseModel):
    """One per-task failure inside a BulkResolveTaskResponse."""

    task_id: str = Field(..., description="The id that failed to settle.")
    error: str = Field(
        ...,
        description=(
            "Operator-friendly cause of failure (Hebrew or English). "
            "Examples: 'PipelineTask id=42 is already in terminal status "
            "resolved.', 'PipelineTask with id=999 was not found in the "
            "system.'"
        ),
    )


class BulkResolveTaskResponse(BaseModel):
    """
    Response shape for POST /api/v1/tasks/bulk-status.

    Returns HTTP 200 even when failed_count > 0 — partial success is
    the documented contract, mirroring `BulkIngestSummary`. Operators
    see exactly which tasks settled and which didn't, plus the reason
    per failure.
    """

    success_count: int = Field(..., ge=0, description="Tasks settled to the requested outcome.")
    failed_count:  int = Field(..., ge=0, description="Equals len(failed_rows); convenience.")
    success_ids:   List[str] = Field(
        default_factory=list,
        description="Task ids that settled successfully, in submission order.",
    )
    failed_rows:   List[BulkResolveTaskFailedRow] = Field(
        default_factory=list,
        description="Per-task failure details. Empty when failed_count == 0.",
    )


class ResolveTaskRequest(BaseModel):
    """
    Request body for POST /api/v1/tasks/{id}/resolve.

    Terminally settles a task. `outcome` selects the terminal status
    ('resolved' or 'rejected').

    Phase AUTH-B: operator_id removed. The endpoint requires
    Admin auth; `current_user.username` becomes the
    `pipeline_task.resolved_by` value.
    """

    outcome: str = Field(
        ...,
        pattern="^(resolved|rejected)$",
        description=(
            "Terminal status to write. Must be 'resolved' or 'rejected'. "
            "Other terminal vocabulary may be added by relaxing this regex."
        ),
    )
    resolution_note: Optional[str] = Field(
        default=None,
        description=(
            "Optional free-text justification. Merged into `extra_data` under "
            "the key 'resolution_note' rather than stored in a structured "
            "column (§Privacy Contract)."
        ),
    )


# ===========================================================================
# DOMAIN F — BULK INGESTION (Phase E1)
# ===========================================================================
# Two operator-facing endpoints share the BulkIngestSummary response shape:
#   POST /api/v1/phones/bulk-text   — shared-context textarea ingestion
#   POST /api/v1/phones/bulk-upload — multipart Excel/CSV (E1-B)
#
# Both follow the same resilience contract: per-row failures are collected
# into `failed_rows` and reported back as part of a 200 response, NOT a
# transaction rollback. Only request-shape errors (e.g. missing target,
# invalid file format) raise 4xx.


class BulkTextIngestRequest(BaseModel):
    """
    Request body for POST /api/v1/phones/bulk-text.

    The operator fills the envelope-context fields ONCE and pastes a
    block of phone numbers into `phone_numbers_raw`. The backend
    tokenizes the block (commas / whitespace / newlines / semicolons),
    normalizes each token, deduplicates within the batch, and creates a
    single Entity with the shared context plus one PhoneNumber per
    surviving token.

    target_entity_id is the OPAQUE INTEGER FK (per Secrets-Free Mandate).
    Frontend resolves the target via clientRegistry + entity picker
    before submitting — the backend does not accept target_phone_number
    here (use POST /ingest if you need that legacy lookup).
    """

    phone_numbers_raw: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description=(
            "Free-form block of phone numbers. Delimiters: comma, semicolon, "
            "or any whitespace including newlines. Each token is normalized "
            "(whitespace + non-digit chars stripped except the leading +) "
            "before insertion."
        ),
    )
    client_id: str = Field(
        ...,
        description=(
            "Opaque integer client partition id. NOT validated against an "
            "allowlist server-side — the frontend clientRegistry is the "
            "source of truth for the integer/name mapping."
        ),
    )
    entity_type: str = Field(
        ...,
        min_length=1,
        description=(
            "Entity classification for the new Entity wrapping every "
            "ingested phone. 'social_envelope' for Vector B clusters; "
            "any other token (family / friend / colleague / target / ...) "
            "for Vector A."
        ),
        examples=["family", "social_envelope"],
    )
    target_entity_id: Optional[str] = Field(
        default=None,
        description=(
            "FK to the primary target Entity this batch's new Entity "
            "should report to. Required for non-'target' entity_types "
            "(checked at the service layer, not the schema, so the error "
            "lands as 422 with a clear message). May be NULL when the "
            "operator is creating a new primary target."
        ),
    )
    ingestion_source: str = Field(
        ...,
        min_length=1,
        examples=["manual", "automated"],
    )
    ingestion_reason: Optional[str] = Field(
        default=None,
        description="Free-form justification, copied onto every ingested phone.",
    )
    entity_extra: Optional[dict] = Field(
        default=None,
        description=(
            "Opaque JSON payload merged into the new Entity's extra_data. "
            "Use for shared envelope metadata (e.g. {'envelope_id': 'EP-001'})."
        ),
    )
    phone_extra_shared: Optional[dict] = Field(
        default=None,
        description=(
            "Opaque JSON payload applied to EVERY PhoneNumber in the batch. "
            "The audit-trail bulk_submission_id (uuid) is automatically "
            "merged in alongside whatever the caller supplies."
        ),
    )


class BulkIngestFailedRow(BaseModel):
    """One per-row failure inside a BulkIngestSummary."""

    row: int = Field(
        ...,
        ge=1,
        description="1-based index of the failing row inside the source.",
    )
    input: str = Field(
        ...,
        description=(
            "Raw value (or excerpt) of the failing row, so the operator "
            "can locate it in their original input. Truncated to 200 chars."
        ),
    )
    error: str = Field(
        ...,
        description="Human-readable cause of the failure (Hebrew or English).",
    )


class BulkIngestSummary(BaseModel):
    """
    Response shape for both /bulk-text and /bulk-upload (E1-B).

    Returns HTTP 200 even when failed_count > 0 — partial success is the
    documented happy path of the resilience contract. The operator UI
    renders the summary inline so they can see exactly which rows
    failed and why.
    """

    success_count: int = Field(..., ge=0, description="Rows successfully inserted.")
    failed_count:  int = Field(..., ge=0, description="Equals len(failed_rows); convenience.")
    phone_ids: List[str] = Field(
        default_factory=list,
        description="PKs of newly-created PhoneNumber rows, in insertion order.",
    )
    entity_ids: List[str] = Field(
        default_factory=list,
        description=(
            "PKs of Entity rows touched by the batch. /bulk-text always "
            "yields a single entity (the shared envelope); /bulk-upload "
            "may yield many."
        ),
    )
    failed_rows: List[BulkIngestFailedRow] = Field(
        default_factory=list,
        description="Per-row failure details. Empty when failed_count == 0.",
    )
    bulk_submission_id: str = Field(
        ...,
        description=(
            "UUID stamped into every ingested phone's extra_data under "
            "the 'bulk_submission_id' key. Operators can later filter on "
            "this value to retrieve everything from one batch."
        ),
    )
