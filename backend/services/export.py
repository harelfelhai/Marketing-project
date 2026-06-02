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
extra_data subkeys the operator was never meant to see in a file.
"""

import io
import re
import uuid
from datetime import datetime, timezone
from typing import Iterable

from openpyxl import Workbook
from openpyxl.styles import Font

from models.types import SOFT_DELETE_SENTINEL
from repositories.storage import Storage
from services.export_formatters import format_value, resolve_column


# ---------------------------------------------------------------------------
# Caps + allowlists
# ---------------------------------------------------------------------------

# Hard cap on rows per export.
MAX_EXPORT_ROWS = 10_000


# Operator-allowed export columns for /phones.
ALLOWED_EXPORT_COLUMNS_PHONES: frozenset[str] = frozenset({
    # Identity + structural
    "id", "phone_number", "entity_id",
    # Entity JOIN
    "relation_type", "full_name", "identifier_1", "identifier_2",
    # Ingestion block
    "ingestion_source", "phone_type",
    # Verification block
    "verification_status",
    # Scoring
    "score",
    # Timestamps
    "deleted_at",
    # Allowlisted extra_data subkeys
    "extra_data.bulk_submission_id",
})


# Operator-allowed export columns for /tasks.
ALLOWED_EXPORT_COLUMNS_TASKS: frozenset[str] = frozenset({
    # Task identity + structural
    "id", "task_type", "status",
    # Phone + Entity
    "phone_id", "phone_number", "entity_id",
    # Entity JOIN
    "full_name", "identifier_1", "identifier_2", "relation_type",
    # Allowlisted extra_data subkeys
    "extra_data.failure_category", "extra_data.suggested_remediation",
    "extra_data.operator_note", "extra_data.resolution_note",
})


# Filename hint sanitizer
_FILENAME_HINT_CLEAN = re.compile(r"[^A-Za-z0-9_-]+")


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ExportService:
    """
    Per-request writer-free service that turns filter+column requests
    into .xlsx bytes.

    No mutator methods — exports are read-only.
    """

    def __init__(self, storage: Storage) -> None:
        self.entities = storage.entities
        self.phones = storage.phones
        self.tasks = storage.tasks

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
            filters       (dict):       Recognised keys:
                                          verification_status,
                                          ingestion_source, phone_type, q.
            columns       (list[dict]): TableExportColumn-shaped dicts.
            filename_hint (Optional[str]): Operator-supplied label.

        Returns:
            (bytes, str): The .xlsx bytes + the suggested filename.

        Raises:
            ValueError: any column key is outside the allowlist, OR the
                filter set yields > MAX_EXPORT_ROWS rows.
        """
        self._validate_columns(columns, ALLOWED_EXPORT_COLUMNS_PHONES)
        f = filters or {}

        phone_where: dict = {"deleted_at": SOFT_DELETE_SENTINEL}
        if f.get("verification_status"):
            phone_where["verification_status"] = f["verification_status"]
        if f.get("ingestion_source"):
            phone_where["ingestion_source"] = f["ingestion_source"]
        if f.get("phone_type"):
            phone_where["phone_type"] = f["phone_type"]

        phones = self.phones.list(phone_where)
        entities = self._entity_map(phones)

        needle = (f.get("q") or "").strip().lower() or None

        matched = []
        for phone in phones:
            entity = entities.get(phone.entity_id)
            if entity is None or entity.deleted_at != SOFT_DELETE_SENTINEL:
                continue
            if needle is not None:
                hay = " ".join(str(x or "") for x in (
                    phone.phone_number,
                    entity.full_name,
                    entity.identifier_1,
                    entity.identifier_2,
                )).lower()
                if needle not in hay:
                    continue
            matched.append((phone, entity))

        total = len(matched)
        if total > MAX_EXPORT_ROWS:
            raise ValueError(
                f"Too many rows: {total} (max {MAX_EXPORT_ROWS}). "
                "Narrow filters and try again."
            )

        matched = matched[:MAX_EXPORT_ROWS]

        flattened = [
            self._flatten_phone_row(phone, entity)
            for phone, entity in matched
        ]
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
        f = filters or {}

        task_where: dict = {"deleted_at": SOFT_DELETE_SENTINEL}
        if f.get("status"):
            task_where["status"] = f["status"]
        if f.get("task_type"):
            task_where["task_type"] = f["task_type"]
        if f.get("phone_id") not in (None, ""):
            task_where["phone_id"] = f["phone_id"]
        if f.get("exclude_terminal") and not f.get("status"):
            task_where["status"] = {"nin": ["done", "rejected"]}

        tasks = self.tasks.list(task_where)

        phone_ids = list({t.phone_id for t in tasks})
        phones = (
            {p.id: p for p in self.phones.list({"id": {"in": phone_ids}})}
            if phone_ids else {}
        )
        entity_ids = list({p.entity_id for p in phones.values()})
        entities = (
            {e.id: e for e in self.entities.list({"id": {"in": entity_ids}})}
            if entity_ids else {}
        )

        needle = (f.get("q") or "").strip().lower() or None

        matched = []
        for task in tasks:
            phone = phones.get(task.phone_id)
            if phone is None or phone.deleted_at != SOFT_DELETE_SENTINEL:
                continue
            entity = entities.get(phone.entity_id)
            if entity is None or entity.deleted_at != SOFT_DELETE_SENTINEL:
                continue
            if needle is not None:
                hay = " ".join(str(x or "") for x in (
                    phone.phone_number,
                    entity.full_name,
                    entity.identifier_1,
                )).lower()
                if needle not in hay:
                    continue
            matched.append((task, phone, entity))

        total = len(matched)
        if total > MAX_EXPORT_ROWS:
            raise ValueError(
                f"Too many rows: {total} (max {MAX_EXPORT_ROWS}). "
                "Narrow filters and try again."
            )

        matched = matched[:MAX_EXPORT_ROWS]

        flattened = [
            self._flatten_task_row(task, phone, entity)
            for task, phone, entity in matched
        ]
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
    # Application-side join helper
    # ----------------------------------------------------------------

    def _entity_map(self, phones):
        """Batch-fetch the entities owning `phones`. Returns entities_by_id."""
        entity_ids = list({p.entity_id for p in phones})
        if not entity_ids:
            return {}
        return {e.id: e for e in self.entities.list({"id": {"in": entity_ids}})}

    # ----------------------------------------------------------------
    # Row flatteners (private; per table)
    # ----------------------------------------------------------------

    @staticmethod
    def _flatten_phone_row(phone, entity) -> dict:
        flat = phone.model_dump()
        flat["relation_type"] = entity.relation_type
        flat["full_name"] = entity.full_name
        flat["identifier_1"] = entity.identifier_1
        flat["identifier_2"] = entity.identifier_2
        return flat

    @staticmethod
    def _flatten_task_row(task, phone, entity) -> dict:
        flat = task.model_dump()
        flat["phone_number"] = phone.phone_number
        flat["full_name"] = entity.full_name
        flat["identifier_1"] = entity.identifier_1
        flat["identifier_2"] = entity.identifier_2
        flat["relation_type"] = entity.relation_type
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
        """Build the two-sheet workbook and return its bytes."""
        wb = Workbook()
        ws = wb.active
        ws.title = "data"

        header_labels = [c["label"] for c in columns]
        ws.append(header_labels)
        for cell in ws[1]:
            cell.font = Font(bold=True)

        for row in rows:
            cells = []
            for c in columns:
                raw = resolve_column(row, c["key"])
                cells.append(format_value(raw, c.get("format", "text")))
            ws.append(cells)

        meta = wb.create_sheet(title="export_metadata")
        meta.append(["field", "value"])
        for cell in meta[1]:
            cell.font = Font(bold=True)
        meta.append(["total_rows", total])
        meta.append(["exported_rows", len(rows)])
        meta.append(["exported_at_utc", datetime.now(timezone.utc).isoformat()])
        meta.append(["bulk_export_id", str(uuid.uuid4())])
        meta.append(["", ""])
        meta.append(["applied_filters", ""])
        for k, v in applied_filters.items():
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
        allowed = set(allowlist)
        bad = [c["key"] for c in columns if c["key"] not in allowed]
        if bad:
            raise ValueError(
                f"Columns not allowed for export: {', '.join(sorted(set(bad)))}"
            )

    @staticmethod
    def _build_filename(table: str, hint: str | None) -> str:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
        parts = [table]
        if hint:
            cleaned = _FILENAME_HINT_CLEAN.sub("_", hint).strip("_")
            if cleaned:
                parts.append(cleaned[:40])
        parts.append(stamp)
        return "_".join(parts) + ".xlsx"
