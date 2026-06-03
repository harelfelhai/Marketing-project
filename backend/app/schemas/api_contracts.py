"""
app/schemas/api_contracts.py — HTTP request and response Pydantic contracts.

This module defines the EXTERNAL API boundary: the exact shapes of data the
REST layer accepts from callers and guarantees to return.

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
# DOMAIN A — INGESTION
# ===========================================================================


class IngestionResponse(BaseModel):
    """
    Response contract for POST /api/v1/phones/quick.

    Serialises the newly created PhoneNumber row immediately after it is
    committed.
    """

    id: str = Field(..., description="Surrogate PK of the new PhoneNumber row.")
    phone_number: str = Field(..., description="The ingested phone number (as stored).")
    entity_id: str = Field(..., description="PK of the Entity record that owns this number.")
    verification_status: str = Field(
        ...,
        description="Always 'pending' on fresh ingestion.",
    )
    ingestion_source: str = Field(
        ...,
        description="Origin channel of this ingestion (e.g. 'manual', 'automated').",
    )
    phone_type: Optional[str] = Field(
        default=None,
        description="Phone type classification (e.g. 'mobile', 'home', 'work', 'other').",
    )
    score: float = Field(..., description="Initial score (0.0 on insert).")

    model_config = ConfigDict(from_attributes=True)


class PhoneUpdateRequest(BaseModel):
    """
    Request body for PATCH /api/v1/phones/{phone_id}/admin.

    Only the fields listed here may be mutated by external callers.
    A null value means "leave unchanged" — this is a true partial update.
    """

    phone_type: Optional[str] = Field(
        default=None,
        description="Phone type classification.",
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description=(
            "Opaque JSON blob update. Replaces (does NOT merge with) the existing "
            "`PhoneNumber.extra_data` value."
        ),
    )
    score: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Operator-supplied score override.",
    )


# ===========================================================================
# DOMAIN C — VERIFICATION
# ===========================================================================


class VerificationVerdictRequest(BaseModel):
    """
    Request body for POST /api/v1/verification/verdict.

    Carries a human operator's manual quality judgment about a phone number.
    """

    phone_id: str = Field(..., description="PK of the PhoneNumber row being judged.")
    status: str = Field(
        ...,
        description=(
            "Verdict status. Values: 'pending', 'verified', 'rejected'."
        ),
        examples=["verified"],
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description="Optional metadata merged into PhoneNumber.extra_data.",
    )


# ===========================================================================
# DOMAIN D — QUERIES, MONITORING & SYSTEM CONTROLS
# ===========================================================================


class EntitySummary(BaseModel):
    """
    Compact representation of an Entity record, embedded inside phone responses.
    """

    id: str = Field(..., description="Entity surrogate PK.")
    relation_type: str = Field(
        ...,
        description="Relation category (e.g. 'primary', 'family', 'friend').",
    )
    target_entity_id: Optional[str] = Field(
        default=None,
        description="FK to the primary target Entity. Null if this entity IS the target.",
    )
    full_name: Optional[str] = Field(default=None, description="Full name of the entity.")
    identifier_1: Optional[str] = Field(default=None, description="Primary identifier.")
    identifier_2: Optional[str] = Field(default=None, description="Secondary identifier.")

    model_config = ConfigDict(from_attributes=True)


class PhoneSummary(BaseModel):
    """
    Compact PhoneNumber row returned as an item in PhoneListResponse.
    """

    id: str = Field(..., description="PhoneNumber surrogate PK.")
    phone_number: str = Field(..., description="The stored phone number string.")
    entity_id: str = Field(..., description="FK to the owning Entity.")
    phone_type: Optional[str] = Field(
        default=None,
        description="Phone type classification.",
    )
    verification_status: str = Field(
        ...,
        description="Quality state: 'pending' | 'verified' | 'rejected'.",
    )
    ingestion_source: str = Field(
        ...,
        description="Origin channel of this ingestion.",
    )
    score: float = Field(..., description="Phone score (0.0 → higher is better).")
    # JOIN convenience fields
    relation_type: Optional[str] = Field(
        default=None,
        description="Relation type of the owning Entity.",
    )
    full_name: Optional[str] = Field(
        default=None,
        description="Full name of the owning Entity.",
    )
    identifier_1: Optional[str] = Field(default=None)
    identifier_2: Optional[str] = Field(default=None)


class PhoneListResponse(BaseModel):
    """Paginated envelope for GET /api/v1/phones."""

    items: List[PhoneSummary] = Field(..., description="Phone records for the current page.")
    total: int = Field(..., description="Total number of records matching the applied filters.")
    page: int = Field(..., description="1-based current page number.", ge=1)
    page_size: int = Field(..., description="Number of records per page.", ge=1)


class PhoneDetailsResponse(BaseModel):
    """Full-detail response for GET /api/v1/phones/{phone_id}."""

    id: str = Field(..., description="PhoneNumber surrogate PK.")
    phone_number: str = Field(..., description="The stored phone number string.")
    entity_id: str = Field(..., description="FK to the owning Entity.")
    phone_type: Optional[str] = Field(default=None, description="Phone type classification.")
    ingestion_source: str = Field(..., description="Origin channel of this ingestion.")
    verification_status: str = Field(..., description="Quality state.")
    score: float = Field(..., description="Phone score.")
    extra_data: Optional[dict] = Field(default=None, description="Opaque JSON bucket.")
    entity: EntitySummary = Field(..., description="Summary of the owning Entity.")

    model_config = ConfigDict(from_attributes=True)


class PhoneUpdateResponse(BaseModel):
    """Response contract for PATCH /api/v1/phones/{phone_id}/admin."""

    phone: IngestionResponse = Field(..., description="The PhoneNumber row after the PATCH.")


# ---------------------------------------------------------------------------
# System controls
# ---------------------------------------------------------------------------


class WorkerRunResponse(BaseModel):
    """Response contract for POST /api/v1/system/workers/run."""

    worker_name: str = Field(..., description="Name of the worker that was executed.")
    processed_count: int = Field(..., description="Number of records successfully processed.")
    started_at: datetime = Field(..., description="UTC timestamp before execution.")
    completed_at: datetime = Field(..., description="UTC timestamp after execution.")


# ---------------------------------------------------------------------------
# System Settings
# ---------------------------------------------------------------------------


class StorageBackendOption(BaseModel):
    """One storage backend the System Settings tab may surface."""

    id: str = Field(..., description="Opaque backend id ('sql' | 'mongo').")
    available: bool = Field(..., description="True when this backend is wired and selectable.")


class VocabularyUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/vocabulary/{name}."""

    items: list[str] = Field(
        ...,
        description="Ordered list of vocabulary strings to persist.",
    )


class VocabularyResponse(BaseModel):
    """Response for GET/PUT /api/v1/system/settings/vocabulary/{name}."""

    name: str = Field(..., description="Vocabulary name (e.g. 'relation_types').")
    items: list[str] = Field(..., description="Current vocabulary items.")


class SystemSettingsResponse(BaseModel):
    """
    Response contract for GET/PUT /api/v1/system/settings.
    """

    storage_backend: str = Field(
        ..., description="Currently selected storage backend id."
    )
    backends: list[StorageBackendOption] = Field(
        ..., description="Catalog of known backends with availability flags."
    )
    display_fields: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Per-surface visible-field selections.",
    )
    display_labels: dict[str, dict[str, str]] = Field(
        default_factory=dict,
        description=(
            "Per-surface column-label overrides: { surface: { field_key: label } }. "
            "Opaque to the backend; the frontend applies these over its default "
            "labels so admins can rename columns without a code change."
        ),
    )
    filter_fields: dict[str, list[str]] = Field(
        default_factory=dict,
        description=(
            "Per-surface active-filter selections: { surface: [filter_key, ...] }. "
            "Same opaque-to-backend contract as display_fields."
        ),
    )
    custom_filters: dict[str, list[dict]] = Field(
        default_factory=dict,
        description=(
            "Per-surface admin-defined filters beyond the built-in catalog: "
            "{ surface: [ {key, label, field, widget, ...}, ... ] }. `field` is "
            "the backend filter path (a column name or a dotted extra_data key). "
            "Stored opaquely; labels/options are interpreted only client-side."
        ),
    )
    ingestion_fields: dict[str, list[dict]] = Field(
        default_factory=dict,
        description=(
            "Per-surface admin-defined dynamic ingestion fields: "
            "{ 'entity'|'phone': [ {key, label, widget, options}, ... ] }. Each "
            "`key` is the extra_data key the captured value is stored under. "
            "Stored opaquely; rendered + collected client-side into extra_data."
        ),
    )
    vocabularies: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Current vocabulary lists keyed by vocabulary name.",
    )
    mongo_configured: bool = Field(
        default=False,
        description="True when an admin has stored a MongoDB connection URL.",
    )
    api_configured: bool = Field(
        default=False,
        description="True when an admin has stored an HTTP/REST api_backend config.",
    )
    api_config: Optional[dict] = Field(
        default=None,
        description=(
            "The stored api_backend config with the auth TOKEN redacted "
            "(replaced by auth.has_token). base_url + per-table paths/field_maps "
            "are returned so the multi-field config is editable; the secret "
            "never leaves the server. None when not configured."
        ),
    )
    applies_on_restart: bool = Field(
        ...,
        description="When True, a change is saved but takes effect on next restart.",
    )


class SystemSettingsUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings."""

    storage_backend: str = Field(
        ..., description="Backend id to activate. Must be a known, available backend."
    )


class MongoUrlUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/mongo-url."""

    url: str = Field(
        ...,
        description=(
            "MongoDB connection string. The URL is validated by attempting a live "
            "connection before being stored. Never returned to the client."
        ),
    )


class ApiConfigUpdate(BaseModel):
    """
    Request body for PUT /api/v1/system/settings/api-config.

    Configures the HTTP/REST ("api") storage backend. The config is validated
    and connection-tested before being stored; the `auth.token` is held
    server-side and never returned (only a redacted view + `api_configured`
    flag are surfaced). Omitting the token preserves the previously stored one.
    """

    base_url: str = Field(..., description="Base URL of the remote API, e.g. https://host/v1.")
    tables: Dict[str, dict] = Field(
        ...,
        description=(
            "Per-table descriptors keyed by aggregate name (entity, phone_number, "
            "pipeline_task, user, session, notification_subscription, "
            "notification_delivery). Each may set: path, rows_path, item_path, "
            "field_map, methods, path_templates, query_params, headers, "
            "body_wrapper, pagination — all optional and generic."
        ),
    )
    auth: Optional[dict] = Field(
        default=None,
        description=(
            "Optional auth: { header, token } for header/bearer, and/or "
            "{ username, password } for HTTP Basic. token + password are stored "
            "server-side only (never returned)."
        ),
    )
    headers: Optional[dict] = Field(
        default=None, description="Optional global headers applied to every request."
    )
    query_params: Optional[dict] = Field(
        default=None,
        description="Optional global query params on every request (e.g. api_key).",
    )
    timeout_s: Optional[float] = Field(
        default=None, description="Optional per-request timeout in seconds (default 10)."
    )


class DisplayFieldsUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/display-fields."""

    surface: str = Field(
        ..., description="Surface id whose visible fields are being set (e.g. 'entities')."
    )
    fields: list[str] = Field(
        ..., description="Ordered list of visible field keys for the surface."
    )


class DisplayLabelsUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/display-labels."""

    surface: str = Field(
        ..., description="Surface id whose column labels are being overridden (e.g. 'entities')."
    )
    labels: dict[str, str] = Field(
        ...,
        description=(
            "Map of field_key -> custom label. Keys absent from this map keep "
            "their frontend default label. An empty map clears all overrides."
        ),
    )


class FilterFieldsUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/filter-fields."""

    surface: str = Field(
        ..., description="Surface id whose active filters are being set (e.g. 'phones')."
    )
    fields: list[str] = Field(
        ..., description="Ordered list of active filter keys for the surface."
    )


class CustomFiltersUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/custom-filters."""

    surface: str = Field(
        ..., description="Surface id whose custom filters are being set (e.g. 'phones')."
    )
    filters: list[dict] = Field(
        ...,
        description=(
            "Ordered list of custom filter descriptors. Each must carry at "
            "least a string `key` and `field`; label/widget/options are opaque."
        ),
    )


class IngestionFieldsUpdate(BaseModel):
    """Request body for PUT /api/v1/system/settings/ingestion-fields."""

    surface: str = Field(
        ..., description="Ingestion surface: 'entity' or 'phone'."
    )
    fields: list[dict] = Field(
        ...,
        description=(
            "Ordered list of dynamic field descriptors. Each must carry at "
            "least a non-empty string `key` (the extra_data key); "
            "label/widget/options are opaque."
        ),
    )


# ---------------------------------------------------------------------------
# Unified client read-model ("person + their phones")
# ---------------------------------------------------------------------------


class ClientMetrics(BaseModel):
    """Per-client phone roll-up rendered on the Client Hub card."""
    total: int
    pending: int
    verified: int
    rejected: int


class ClientAggregateResponse(BaseModel):
    """
    One unified client view: the root entity, its member entities, every
    phone across the circle, and the metric roll-up.
    """
    root_entity_id: str
    root: Optional[dict] = None
    members: list[dict] = Field(default_factory=list)
    phones: list[dict] = Field(default_factory=list)
    metrics: ClientMetrics


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class DashboardMetricsResponse(BaseModel):
    """Response contract for GET /api/v1/dashboard/metrics."""

    total_phones: int = Field(..., description="Total PhoneNumber rows in the database.")
    phones_by_verification_status: Dict[str, int] = Field(
        ...,
        description="Record count per verification_status value.",
    )
    total_tasks: int = Field(..., description="Total PipelineTask rows in the database.")
    tasks_by_status: Dict[str, int] = Field(
        ...,
        description="Record count per task status value.",
    )


# ===========================================================================
# DOMAIN E — OPERATIONS TASK QUEUE (Phase DX)
# ===========================================================================


class PipelineTaskResponse(BaseModel):
    """
    Flat task row — same shape returned by list, detail, and write endpoints.
    """

    id: str = Field(..., description="PipelineTask surrogate PK.")
    phone_id: str = Field(..., description="FK to the PhoneNumber this task is about.")
    phone_number: str = Field(..., description="Denormalized phone number string.")
    entity_id: str = Field(..., description="Denormalized entity FK.")
    task_type: str = Field(..., description="Task classification token.")
    status: str = Field(
        ...,
        description="Lifecycle state: 'pending' | 'done' | 'rejected'.",
    )
    extra_data: Optional[dict] = Field(default=None, description="Opaque JSON bucket.")
    # JOIN convenience fields
    full_name: Optional[str] = Field(default=None, description="Full name from Entity.")
    identifier_1: Optional[str] = Field(default=None)
    identifier_2: Optional[str] = Field(default=None)

    model_config = ConfigDict(from_attributes=True)


class PipelineTaskListResponse(BaseModel):
    """Paginated envelope for GET /api/v1/tasks."""

    items: List[PipelineTaskResponse] = Field(
        ..., description="PipelineTask rows for the current page.",
    )
    total: int = Field(..., description="Total number of rows matching the applied filters.")
    page: int = Field(..., description="1-based current page number.", ge=1)
    page_size: int = Field(..., description="Number of records per page.", ge=1)


class OpenTaskRequest(BaseModel):
    """Request body for POST /api/v1/tasks."""

    phone_id: str = Field(..., description="FK to the target PhoneNumber.")
    task_type: str = Field(
        ...,
        min_length=1,
        description="Task classification token.",
    )
    extra_data: Optional[dict] = Field(
        default=None,
        description="Opaque JSON payload stored on the new task.",
    )


class ResolveTaskRequest(BaseModel):
    """Request body for POST /api/v1/tasks/{id}/resolve."""

    outcome: str = Field(
        ...,
        pattern="^(done|rejected)$",
        description="Terminal status to write. Must be 'done' or 'rejected'.",
    )
    resolution_note: Optional[str] = Field(
        default=None,
        description="Optional free-text justification merged into extra_data.",
    )


class BulkResolveTaskRequest(BaseModel):
    """Request body for POST /api/v1/tasks/bulk-status."""

    task_ids: List[str] = Field(
        ...,
        min_length=1,
        max_length=200,
        description="PKs to settle. 1..200 entries per request.",
    )
    outcome: str = Field(
        ...,
        pattern="^(done|rejected)$",
        description="Terminal status to write: 'done' or 'rejected'.",
    )
    resolution_note: Optional[str] = Field(
        default=None,
        description="Optional shared justification merged into every settled task.",
    )


class BulkResolveTaskFailedRow(BaseModel):
    """One per-task failure inside a BulkResolveTaskResponse."""

    task_id: str = Field(..., description="The id that failed to settle.")
    error: str = Field(..., description="Operator-friendly cause of failure.")


class BulkResolveTaskResponse(BaseModel):
    """Response shape for POST /api/v1/tasks/bulk-status."""

    success_count: int = Field(..., ge=0, description="Tasks settled to the requested outcome.")
    failed_count:  int = Field(..., ge=0, description="Equals len(failed_rows); convenience.")
    success_ids:   List[str] = Field(default_factory=list)
    failed_rows:   List[BulkResolveTaskFailedRow] = Field(default_factory=list)


# ===========================================================================
# DOMAIN F — BULK INGESTION (Phase E1)
# ===========================================================================


class BulkTextIngestRequest(BaseModel):
    """Request body for POST /api/v1/phones/bulk-text."""

    phone_numbers_raw: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description=(
            "Free-form block of phone numbers. Delimiters: comma, semicolon, "
            "or any whitespace including newlines."
        ),
    )
    entity_id: str = Field(
        ...,
        description="FK to the existing Entity that owns all ingested phones.",
    )
    ingestion_source: str = Field(
        ...,
        min_length=1,
        examples=["manual", "automated"],
    )
    phone_type: Optional[str] = Field(
        default=None,
        description="Phone type applied to every ingested phone.",
    )
    extra_shared: Optional[dict] = Field(
        default=None,
        description="Opaque JSON payload applied to every PhoneNumber in the batch.",
    )


class BulkIngestFailedRow(BaseModel):
    """One per-row failure inside a BulkIngestSummary."""

    row: int = Field(..., ge=1, description="1-based index of the failing row.")
    input: str = Field(..., description="Raw value of the failing row.")
    error: str = Field(..., description="Human-readable cause of the failure.")


class BulkIngestSummary(BaseModel):
    """
    Response shape for both /bulk-text and /bulk-upload (E1-B).

    Returns HTTP 200 even when failed_count > 0 — partial success is the
    documented happy path.
    """

    success_count: int = Field(..., ge=0, description="Rows successfully inserted.")
    failed_count:  int = Field(..., ge=0, description="Equals len(failed_rows); convenience.")
    phone_ids: List[str] = Field(
        default_factory=list,
        description="PKs of newly-created PhoneNumber rows.",
    )
    entity_ids: List[str] = Field(
        default_factory=list,
        description="PKs of Entity rows touched by the batch.",
    )
    failed_rows: List[BulkIngestFailedRow] = Field(
        default_factory=list,
        description="Per-row failure details.",
    )
    bulk_submission_id: str = Field(
        ...,
        description="UUID stamped into every ingested phone's extra_data.",
    )


# ===========================================================================
# DOMAIN H — TABLE EXPORT (Phase EXP)
# ===========================================================================


class TableExportColumn(BaseModel):
    """One column descriptor inside a TableExportRequest."""

    key: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Column identifier (flat field or dotted extra_data path).",
    )
    label: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Display string written into the .xlsx header row.",
    )
    format: Optional[str] = Field(
        default="text",
        pattern="^(text|number|number2|datetime)$",
        description="Cell-type token: 'text', 'number', 'number2', or 'datetime'.",
    )


class TableExportRequest(BaseModel):
    """Request body for POST /api/v1/{table}/export."""

    filters: dict = Field(
        default_factory=dict,
        description="Same key/value shape as the list endpoint's query string.",
    )
    columns: List[TableExportColumn] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="1..50 column descriptors.",
    )
    filename_hint: Optional[str] = Field(
        default=None,
        max_length=40,
        description="Optional operator-supplied label for the filename.",
    )
