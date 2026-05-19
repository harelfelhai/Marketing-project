"""
services/export.py — Phase EXP: tabular view → .xlsx export.

One service, one method per exportable table. Each method:
    1. Builds the same query the LIST endpoint uses (so filters mean
       exactly what they do on screen).
    2. Counts first; if the count exceeds MAX_EXPORT_ROWS the call
       returns a ValueError → 422 at the endpoint layer.
    3. Flattens rows into dicts (model fields + JOINed fields + the
       opaque extra_data blob preserved as-is).
    4. Calls the shared `_serialize_xlsx` helper to produce bytes.

The helper writes a two-sheet workbook:
    `data`              — header row + N data rows
    `export_metadata`   — applied filters + total row count + UTC
                          timestamp + bulk_export_id (uuid)

PRIVACY CONTRACT
----------------
The per-table ALLOWED_EXPORT_COLUMNS_* sets are the security boundary.
Any column key not in the set is rejected with ValueError before any
DB work happens — so a malformed request can't dump arbitrary
extra_data subkeys (e.g. `extra_data.api_key`) the operator was never
meant to see in a file.
"""

import io
import re
import uuid
from datetime import datetime, timezone
from typing import Iterable

from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import func, or_, select as sa_select
from sqlalchemy.orm import aliased
from sqlmodel import Session

from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from services.export_formatters import format_value, resolve_column


# ---------------------------------------------------------------------------
# Caps + allowlists
# ---------------------------------------------------------------------------

# Hard cap on rows per export. openpyxl serialization is fast at this
# scale (<2s for 10K rows × 15 cols) and the memory profile stays sane.
# Operators wanting more must narrow filters first; the endpoint
# surfaces a friendly 422 explaining how many rows they tried to grab.
MAX_EXPORT_ROWS = 10_000


# Operator-allowed export columns for /phones. Anything outside this
# set is rejected — this is the privacy gate that prevents arbitrary
# extra_data subkey dumping. New keys land here ONLY by explicit
# review.
ALLOWED_EXPORT_COLUMNS_PHONES: frozenset[str] = frozenset({
    # Identity + structural
    "id", "phone_number", "entity_id",
    # Entity JOIN
    "entity_type", "client_id",
    # Phase 1 ingestion block
    "ingestion_source", "ingestion_reason", "ingested_at",
    # Phase 3 verification block
    "verification_status", "verification_source", "verification_reason",
    "verified_at",
    # Phase DY scoring block
    "confidence_score", "priority_score",
    "confidence_updated_at", "priority_updated_at",
    "customer_tier",
    # Other mutable fields
    "classification_type",
    "created_at", "updated_at",
    # Allowlisted extra_data subkeys (Phase E2 + DX audit fields)
    "extra_data.first_name", "extra_data.last_name",
    "extra_data.customer_tier", "extra_data.bulk_submission_id",
    "extra_data.envelope_id", "extra_data.row_token",
})


# Operator-allowed export columns for /tasks.
ALLOWED_EXPORT_COLUMNS_TASKS: frozenset[str] = frozenset({
    # Task identity + structural
    "id", "task_type", "status", "source_action_log_id",
    # Phone + Entity JOIN
    "phone_id", "phone_number", "entity_id", "entity_type", "client_id",
    # Attribution
    "requested_by", "resolved_by",
    # Timestamps
    "created_at", "updated_at", "resolved_at",
    # Allowlisted extra_data subkeys
    "extra_data.failure_category", "extra_data.suggested_remediation",
    "extra_data.requested_action_type", "extra_data.operator_note",
    "extra_data.resolution_note", "extra_data.resolution_outcome",
})


# Filename hint sanitizer — keep only safe filesystem chars so an
# operator typing arbitrary Hebrew / punctuation can't break the
# Content-Disposition header.
_FILENAME_HINT_CLEAN = re.compile(r"[^A-Za-z0-9_-]+")


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ExportService:
    """
    Per-request writer-free service that turns filter+column requests
    into .xlsx bytes. Constructed via the `get_export_service`
    factory in `dependencies.py`.

    No mutator methods — exports are read-only. The session is held
    for query execution only.
    """

    def __init__(self, session: Session) -> None:
        self.session = session

    # ----------------------------------------------------------------
    # Public — Phones export
    # ----------------------------------------------------------------

    def export_phones(
        self,
        filters: dict,
        columns: list[dict],
        filename_hint: str | None = None,
    ) -> tuple[bytes, str]:
        """
        Export the /phones table to .xlsx.

        Args:
            filters       (dict):       Same shape as GET /phones query
                                          params. Recognised keys:
                                          verification_status,
                                          ingestion_source, entity_type,
                                          classification_type, client_id, q.
            columns       (list[dict]): TableExportColumn-shaped dicts
                                          ({key, label, format}). Order
                                          drives sheet column order.
            filename_hint (Optional[str]): Operator-supplied label.

        Returns:
            (bytes, str): The .xlsx bytes + the suggested filename.

        Raises:
            ValueError: any column key is outside the allowlist, OR the
                filter set yields > MAX_EXPORT_ROWS rows.
        """
        self._validate_columns(columns, ALLOWED_EXPORT_COLUMNS_PHONES)

        # Build the same JOIN shape the list endpoint uses, so customer_tier
        # can be extracted from the root target's extra_data per Phase DY.
        RootEntity = aliased(Entity)
        base = (
            sa_select(
                PhoneNumber,
                Entity.entity_type,
                Entity.client_id,
                Entity.extra_data.label("immediate_extra"),
                RootEntity.extra_data.label("root_extra"),
            )
            .join(Entity, PhoneNumber.entity_id == Entity.id)
            .outerjoin(RootEntity, Entity.target_entity_id == RootEntity.id)
        )
        count_base = (
            sa_select(func.count(PhoneNumber.id))
            .join(Entity, PhoneNumber.entity_id == Entity.id)
        )

        # Apply the same filters as list_phones. Unknown filter keys
        # are silently ignored — forward-compatible with future filter
        # additions (the validator runs on `columns`, not `filters`).
        f = filters or {}
        for clause in self._phone_filter_clauses(f):
            base = base.where(clause)
            count_base = count_base.where(clause)

        total: int = self.session.execute(count_base).scalar_one()
        if total > MAX_EXPORT_ROWS:
            raise ValueError(
                f"Too many rows: {total} (max {MAX_EXPORT_ROWS}). "
                "Narrow filters and try again."
            )

        # Fetch up to the cap; sort newest-first to match the table's
        # default reading order (priority sort would skew the export
        # for operators who haven't reconfigured it).
        rows = self.session.execute(
            base.order_by(PhoneNumber.ingested_at.desc()).limit(MAX_EXPORT_ROWS)
        ).all()

        flattened = [self._flatten_phone_row(r) for r in rows]
        applied_filters = {k: v for k, v in f.items() if v not in (None, "")}

        xlsx_bytes = self._serialize_xlsx(
            rows=flattened,
            columns=columns,
            total=total,
            applied_filters=applied_filters,
        )
        filename = self._build_filename("phones", filename_hint)
        return xlsx_bytes, filename

    # ----------------------------------------------------------------
    # Public — Tasks export
    # ----------------------------------------------------------------

    def export_tasks(
        self,
        filters: dict,
        columns: list[dict],
        filename_hint: str | None = None,
    ) -> tuple[bytes, str]:
        """
        Export the /tasks table to .xlsx. Same contract as export_phones.

        Recognised filter keys: status, task_type, phone_id, q,
        exclude_terminal (bool).
        """
        self._validate_columns(columns, ALLOWED_EXPORT_COLUMNS_TASKS)

        base = (
            sa_select(
                PipelineTask,
                PhoneNumber.phone_number,
                PhoneNumber.entity_id,
                Entity.entity_type,
                Entity.client_id,
            )
            .join(PhoneNumber, PipelineTask.phone_id == PhoneNumber.id)
            .join(Entity, PhoneNumber.entity_id == Entity.id)
        )
        count_base = (
            sa_select(func.count(PipelineTask.id))
            .join(PhoneNumber, PipelineTask.phone_id == PhoneNumber.id)
            .join(Entity, PhoneNumber.entity_id == Entity.id)
        )

        f = filters or {}
        for clause in self._task_filter_clauses(f):
            base = base.where(clause)
            count_base = count_base.where(clause)

        total: int = self.session.execute(count_base).scalar_one()
        if total > MAX_EXPORT_ROWS:
            raise ValueError(
                f"Too many rows: {total} (max {MAX_EXPORT_ROWS}). "
                "Narrow filters and try again."
            )

        rows = self.session.execute(
            base.order_by(PipelineTask.created_at.desc()).limit(MAX_EXPORT_ROWS)
        ).all()

        flattened = [self._flatten_task_row(r) for r in rows]
        applied_filters = {k: v for k, v in f.items() if v not in (None, "")}

        xlsx_bytes = self._serialize_xlsx(
            rows=flattened,
            columns=columns,
            total=total,
            applied_filters=applied_filters,
        )
        filename = self._build_filename("tasks", filename_hint)
        return xlsx_bytes, filename

    # ----------------------------------------------------------------
    # Filter-clause builders (private; per table)
    # ----------------------------------------------------------------

    @staticmethod
    def _phone_filter_clauses(f: dict) -> list:
        """Translate `filters` dict into SQLAlchemy WHERE clauses.

        Same recognition logic the GET /phones endpoint uses. Unknown
        keys are silently ignored so future filter additions are
        forward-compatible without breaking older clients.
        """
        # UAT round-3: exports never include soft-deleted rows.
        out = [
            PhoneNumber.deleted_at.is_(None),
            Entity.deleted_at.is_(None),
        ]
        if f.get("verification_status"):
            out.append(PhoneNumber.verification_status == f["verification_status"])
        if f.get("ingestion_source"):
            out.append(PhoneNumber.ingestion_source == f["ingestion_source"])
        if f.get("entity_type"):
            out.append(Entity.entity_type == f["entity_type"])
        if f.get("classification_type"):
            out.append(PhoneNumber.classification_type == f["classification_type"])
        if f.get("client_id") is not None and f.get("client_id") != "":
            out.append(Entity.client_id == f["client_id"])
        # Phase AUTH-C — multi-value personalization filter.
        cids = f.get("client_ids")
        if cids:
            out.append(Entity.client_id.in_(cids))
        q = f.get("q")
        if q:
            like = f"%{q}%"
            # Mirrors the FilterBar placeholder: phone_number OR entity_id
            # OR client_id substring. client name is a frontend-resolved
            # concept and intentionally not searched here (operators
            # filter by client via the dropdown).
            out.append(or_(
                PhoneNumber.phone_number.ilike(like),
                func.cast(Entity.client_id, type_=PhoneNumber.phone_number.type).ilike(like),
                func.cast(PhoneNumber.entity_id, type_=PhoneNumber.phone_number.type).ilike(like),
            ))
        return out

    @staticmethod
    def _task_filter_clauses(f: dict) -> list:
        # UAT round-3: exports skip rows whose phone or entity is gone.
        out = [
            PhoneNumber.deleted_at.is_(None),
            Entity.deleted_at.is_(None),
        ]
        if f.get("status"):
            out.append(PipelineTask.status == f["status"])
        if f.get("task_type"):
            out.append(PipelineTask.task_type == f["task_type"])
        if f.get("phone_id") is not None and f.get("phone_id") != "":
            out.append(PipelineTask.phone_id == f["phone_id"])
        if f.get("exclude_terminal") and not f.get("status"):
            # Mirrors the list endpoint contract: explicit status wins.
            out.append(PipelineTask.status.notin_(["resolved", "rejected"]))
        # Phase AUTH-C — multi-value personalization filter.
        cids = f.get("client_ids")
        if cids:
            out.append(Entity.client_id.in_(cids))
        q = f.get("q")
        if q:
            like = f"%{q}%"
            out.append(or_(
                PhoneNumber.phone_number.ilike(like),
                PipelineTask.requested_by.ilike(like),
                PipelineTask.resolved_by.ilike(like),
                func.cast(Entity.client_id, type_=PhoneNumber.phone_number.type).ilike(like),
            ))
        return out

    # ----------------------------------------------------------------
    # Row flatteners (private; per table)
    # ----------------------------------------------------------------

    @staticmethod
    def _flatten_phone_row(row) -> dict:
        """
        Build a column-resolvable dict from one (PhoneNumber, etype,
        client_id, immediate_extra, root_extra) tuple.

        `customer_tier` is computed here (single place) so it lands on
        the same row dict as everything else and column projection
        becomes a pure lookup.
        """
        phone, entity_type, client_id, immediate_extra, root_extra = row
        effective_extra = root_extra if root_extra is not None else immediate_extra
        customer_tier = None
        if effective_extra is not None:
            raw_tier = effective_extra.get("customer_tier")
            if raw_tier is not None:
                try:
                    customer_tier = int(raw_tier)
                except (TypeError, ValueError):
                    customer_tier = None

        # Start from the SQLModel's dict so every column on PhoneNumber
        # is addressable (id, phone_number, ingested_at, etc.). Then
        # layer JOIN fields and the computed customer_tier on top.
        flat = phone.model_dump()
        flat["entity_type"] = entity_type
        flat["client_id"] = client_id
        flat["customer_tier"] = customer_tier

        # UAT round-3 fix: the export allowlist exposes BOTH phone-level
        # (`extra_data.row_token`, `extra_data.bulk_submission_id`) and
        # ENTITY-level (`extra_data.first_name`, `extra_data.last_name`,
        # `extra_data.envelope_id`, …) subkeys under the same dotted
        # prefix. Previously `flat["extra_data"]` carried only the phone
        # blob, so entity-level columns silently exported as empty cells.
        # Merge the entity blob in first, phone blob second — phone keys
        # win on conflict (rare; nothing actually overlaps in practice).
        flat["extra_data"] = {
            **(effective_extra or {}),
            **(phone.extra_data or {}),
        }
        return flat

    @staticmethod
    def _flatten_task_row(row) -> dict:
        task, phone_number, entity_id, entity_type, client_id = row
        flat = task.model_dump()
        flat["phone_number"] = phone_number
        flat["entity_id"] = entity_id
        flat["entity_type"] = entity_type
        flat["client_id"] = client_id
        return flat

    # ----------------------------------------------------------------
    # Workbook builder
    # ----------------------------------------------------------------

    @staticmethod
    def _serialize_xlsx(
        rows: list[dict],
        columns: list[dict],
        total: int,
        applied_filters: dict,
    ) -> bytes:
        """
        Build the two-sheet workbook and return its bytes.

        Sheet 1 — `data`:
            Row 1   = bold header (labels from `columns` in order)
            Rows 2+ = data rows; per-column values resolved + formatted

        Sheet 2 — `export_metadata`:
            Auditing context: applied filters, total row count, UTC
            timestamp, bulk_export_id (uuid).
        """
        wb = Workbook()
        ws = wb.active
        ws.title = "data"

        # Header row.
        header_labels = [c["label"] for c in columns]
        ws.append(header_labels)
        # Bold the header so operators can immediately spot column names.
        for cell in ws[1]:
            cell.font = Font(bold=True)

        # Data rows. Each row resolves once per column key + format.
        for row in rows:
            cells = []
            for c in columns:
                raw = resolve_column(row, c["key"])
                cells.append(format_value(raw, c.get("format", "text")))
            ws.append(cells)

        # Metadata sheet — always present (even when rows == 0) so the
        # operator can correlate the export with audit logs later.
        meta = wb.create_sheet(title="export_metadata")
        meta.append(["field", "value"])
        for cell in meta[1]:
            cell.font = Font(bold=True)
        meta.append(["total_rows", total])
        meta.append(["exported_rows", len(rows)])
        meta.append(["exported_at_utc", datetime.now(timezone.utc).isoformat()])
        meta.append(["bulk_export_id", str(uuid.uuid4())])
        meta.append(["", ""])    # spacer
        meta.append(["applied_filters", ""])
        for k, v in applied_filters.items():
            # openpyxl can only put scalars in cells — coerce lists +
            # dicts to JSON-ish strings so multi-value filters
            # (e.g. Phase AUTH-C's client_ids=[1,3]) round-trip into
            # the audit sheet rather than crashing the export.
            if isinstance(v, (list, dict)):
                v = str(v)
            meta.append([f"  {k}", v])

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    # ----------------------------------------------------------------
    # Validation + filename helpers
    # ----------------------------------------------------------------

    @staticmethod
    def _validate_columns(columns: list[dict], allowlist: Iterable[str]) -> None:
        """
        Reject the whole request if ANY requested key is outside the
        per-table allowlist. We fail fast — partial-allowlist exports
        risk operators believing they got more data than they did.
        """
        allowed = set(allowlist)
        bad = [c["key"] for c in columns if c["key"] not in allowed]
        if bad:
            raise ValueError(
                f"Columns not allowed for export: {', '.join(sorted(set(bad)))}"
            )

    @staticmethod
    def _build_filename(table: str, hint: str | None) -> str:
        """
        `{table}_{hint?}_{YYYY-MM-DD}_{HHMM}.xlsx`

        Hint is sanitized to a safe filename slug so Content-Disposition
        can never carry a header-injection attack vector.
        """
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
        parts = [table]
        if hint:
            cleaned = _FILENAME_HINT_CLEAN.sub("_", hint).strip("_")
            if cleaned:
                parts.append(cleaned[:40])
        parts.append(stamp)
        return "_".join(parts) + ".xlsx"
