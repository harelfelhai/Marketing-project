"""
services/bulk_ingestion.py — Phase E1 batch insertion.

The service is the SOLE writer to the bulk-ingestion code path. It owns:
    - tokenization of free-form text input
    - per-row format validation
    - within-batch deduplication
    - per-row savepoint inserts (resilience contract)
    - audit-trail stamping (bulk_submission_id)
    - Phase DY scoring hook integration

The resilience contract — quoting the Phase E1 spec:
    "If a sheet containing 50 lines has 2 rows with invalid phone
    formats or corrupted data, the transaction should NOT roll back
    entirely. Instead, ingest the 48 valid rows and return a descriptive
    execution summary payload to the UI."

Implementation strategy: TWO-PASS.

    Pass 1 (in-memory, no DB writes):
        - Tokenize phone_numbers_raw on commas / semicolons / whitespace.
        - Normalize each token (strip whitespace + cosmetic chars).
        - Format-check each normalized value against PHONE_REGEX.
        - Detect within-batch duplicates.
        - Build a list of (row_idx, raw, normalized) for surviving
          candidates and append everything else to failed_rows.

    Pass 2 (DB writes, per-row savepoints):
        - If 0 candidates survived, return early (no Entity created).
        - Otherwise, create ONE Entity with the shared envelope context.
        - For each candidate, open a SAVEPOINT, attempt PhoneNumber
          insert, trigger Phase DY scoring, then release-or-rollback.
        - DB-level failures (UNIQUE constraint violations, FK errors)
          are caught at the savepoint boundary and recorded as per-row
          failures without affecting the outer transaction.
        - Commit once at the end.

PRIVACY CONTRACT
----------------
client_id, entity_type, target_entity_id remain opaque structural data.
The audit-trail bulk_submission_id is a uuid4 — opaque, non-correlating.
"""

import csv
import io
import re
import uuid
from typing import Optional, TYPE_CHECKING

import openpyxl
from openpyxl import Workbook
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber

if TYPE_CHECKING:
    from services.scoring import ScoringService


# ---------------------------------------------------------------------------
# Bulk-upload constants (Phase E1-B)
# ---------------------------------------------------------------------------

# The Excel/CSV template + uploaded sheet use these column names verbatim.
# Required columns must be present in the header row; optional columns
# may be omitted entirely. Names are English by design (they're the API
# contract — Hebrew translation lives only in the operator-facing
# template "instructions" sheet).
BULK_UPLOAD_REQUIRED_COLUMNS = (
    "phone_number",
    "client_id",
    "entity_type",
    "ingestion_source",
)
BULK_UPLOAD_OPTIONAL_COLUMNS = (
    "target_entity_id",
    "ingestion_reason",
)
BULK_UPLOAD_ALL_COLUMNS = BULK_UPLOAD_REQUIRED_COLUMNS + BULK_UPLOAD_OPTIONAL_COLUMNS

# Cap on uploaded row count — protects the service from a 50k-row sheet
# blocking the request loop in pure-Python openpyxl. Configurable via
# the Settings if a deployment legitimately needs higher.
BULK_UPLOAD_MAX_ROWS = 5_000


# ---------------------------------------------------------------------------
# Tokenization + normalization
# ---------------------------------------------------------------------------

# Splits on any run of commas, semicolons, or whitespace (incl. newlines).
# The pattern is deliberately greedy so an operator pasting tab-delimited
# columns or HTML-pasted text with mixed delimiters lands cleanly.
_TOKEN_SPLIT_RE = re.compile(r"[,\s;]+")

# Strip cosmetic characters from a candidate phone string. We preserve a
# leading '+' (E.164 prefix) and digits; everything else (parens, dashes,
# bidi marks, NBSP, etc.) is dropped before the format check.
_PHONE_CLEAN_RE = re.compile(r"[^\d+]")

# Loose phone-format regex: optional '+' followed by 7..15 digits. We do
# not enforce strict E.164 because scrape sources surface non-standard
# formats and the existing /ingest endpoint accepts them.
_PHONE_REGEX = re.compile(r"^\+?\d{7,15}$")

# Cap on `input` echoing in failure rows — protects the response payload
# from operators pasting megabytes of garbage.
_FAILURE_INPUT_CAP = 200


def _tokenize(raw: str) -> list[tuple[int, str]]:
    """
    Split `raw` into (row_idx, token) pairs preserving order.

    row_idx is 1-based and counts tokens (not bytes), so failure messages
    can point the operator at "row 12" of their input.

    Empty tokens are skipped. The split is delimiter-agnostic (any mix of
    commas / semicolons / whitespace works).
    """
    pairs: list[tuple[int, str]] = []
    idx = 0
    for token in _TOKEN_SPLIT_RE.split(raw):
        if not token:
            continue
        idx += 1
        pairs.append((idx, token))
    return pairs


def _normalize(token: str) -> str:
    """
    Strip cosmetic chars from a phone token. Returns the cleaned form.

    Examples:
        "+1 (415) 555-1111"  → "+14155551111"
        " 052-1234567 "      → "0521234567"
        "‎+972524567890"     → "+972524567890"  (bidi mark stripped)
    """
    return _PHONE_CLEAN_RE.sub("", token.strip())


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class BulkIngestionService:
    """
    Sole writer to the bulk-ingestion path. Constructed per request via
    the FastAPI dependency factory in `app/api/deps.py`.

    The class is intentionally lightweight — most of the heavy lifting
    is in the module-level `_tokenize` / `_normalize` helpers so the
    parsing logic stays testable without a DB session.
    """

    def __init__(
        self,
        session: Session,
        scoring_service: Optional["ScoringService"] = None,
    ) -> None:
        """
        Args:
            session         (Session):          Active DB session.
            scoring_service (ScoringService):   Phase DY hook. When provided,
                every successfully-inserted phone gets a priority recalc
                INSIDE its savepoint so the new row carries a meaningful
                priority_score immediately (not the column default 0.0).
                When None, scoring is skipped (used by some tests).
        """
        self.session = session
        self.scoring_service = scoring_service

    # ----------------------------------------------------------------
    # Public — bulk-text entry point
    # ----------------------------------------------------------------

    def ingest_bulk_text(
        self,
        phone_numbers_raw: str,
        client_id: int,
        entity_type: str,
        ingestion_source: str,
        target_entity_id: Optional[int] = None,
        ingestion_reason: Optional[str] = None,
        entity_extra: Optional[dict] = None,
        phone_extra_shared: Optional[dict] = None,
    ) -> dict:
        """
        Execute the two-pass bulk-text ingestion.

        Returns a dict matching the BulkIngestSummary Pydantic shape so
        the endpoint can validate-and-return without an intermediate
        conversion step.

        Raises:
            TargetNotFoundError: target_entity_id was provided but does
                not exist. The endpoint maps this to 422 (request-shape
                error, NOT a per-row failure).
        """
        submission_id = str(uuid.uuid4())

        # ----------------------------------------------------------------
        # Pre-flight — target_entity_id validation. If invalid, fail the
        # whole submission (request-level error per the spec). Per-row
        # failures only apply to row-shape problems, not envelope errors.
        # ----------------------------------------------------------------
        if target_entity_id is not None:
            target = self.session.get(Entity, target_entity_id)
            if target is None:
                raise TargetNotFoundError(
                    target_phone_number=f"entity_id={target_entity_id}"
                )

        # ----------------------------------------------------------------
        # Pass 1 — tokenize, normalize, validate format, detect dupes.
        # ----------------------------------------------------------------
        failed_rows: list[dict] = []
        candidates: list[tuple[int, str, str]] = []   # (row, raw, normalized)
        seen: dict[str, int] = {}                     # normalized → first row

        for row, raw in _tokenize(phone_numbers_raw):
            normalized = _normalize(raw)
            if not normalized:
                failed_rows.append({
                    "row": row,
                    "input": raw[:_FAILURE_INPUT_CAP],
                    "error": "Empty after normalization",
                })
                continue
            if not _PHONE_REGEX.match(normalized):
                failed_rows.append({
                    "row": row,
                    "input": raw[:_FAILURE_INPUT_CAP],
                    "error": "Invalid phone format",
                })
                continue
            if normalized in seen:
                first_seen_row = seen[normalized]
                failed_rows.append({
                    "row": row,
                    "input": raw[:_FAILURE_INPUT_CAP],
                    "error": f"Duplicate of row {first_seen_row} in this batch",
                })
                continue
            seen[normalized] = row
            candidates.append((row, raw, normalized))

        # ----------------------------------------------------------------
        # Pass 2 — DB writes. If no surviving candidates, return early
        # without creating the Entity (avoids orphan-entity cleanup logic).
        # ----------------------------------------------------------------
        if not candidates:
            return {
                "success_count":      0,
                "failed_count":       len(failed_rows),
                "phone_ids":          [],
                "entity_ids":         [],
                "failed_rows":        failed_rows,
                "bulk_submission_id": submission_id,
            }

        # Create the shared Entity. Merge audit-trail metadata into its
        # extra_data alongside whatever the caller supplied.
        entity_extra_merged = dict(entity_extra or {})
        entity_extra_merged["bulk_submission_id"] = submission_id
        new_entity = Entity(
            client_id=client_id,
            relation_type="associated" if entity_type != "target" else "primary",
            entity_type=entity_type,
            target_entity_id=target_entity_id,
            extra_data=entity_extra_merged,
        )
        self.session.add(new_entity)
        self.session.flush()  # populate new_entity.id without committing

        phone_extra_with_audit = dict(phone_extra_shared or {})
        phone_extra_with_audit["bulk_submission_id"] = submission_id

        phone_ids: list[int] = []
        for row, raw, normalized in candidates:
            try:
                # Nested transaction = SQLite SAVEPOINT. On IntegrityError
                # (UNIQUE / FK), the savepoint rolls back automatically
                # via the context manager's __exit__ path.
                with self.session.begin_nested():
                    phone = PhoneNumber(
                        entity_id=new_entity.id,
                        phone_number=normalized,
                        ingestion_source=ingestion_source,
                        ingestion_reason=ingestion_reason,
                        extra_data=dict(phone_extra_with_audit),
                    )
                    self.session.add(phone)
                    self.session.flush()
                    # Phase DY hook — run scoring inside the same savepoint
                    # so a scoring failure rolls back the phone insert too.
                    if self.scoring_service is not None:
                        self.scoring_service.recalculate_for_phone(
                            phone.id, commit=False
                        )
                phone_ids.append(phone.id)
            except IntegrityError as exc:
                # Most common case: UNIQUE constraint on phone_number.
                # Detail comes from the DB driver — we trim it for the
                # operator-facing message.
                detail = str(exc.orig) if exc.orig else "Database constraint violation"
                failed_rows.append({
                    "row": row,
                    "input": raw[:_FAILURE_INPUT_CAP],
                    "error": (
                        "Already exists in the system"
                        if "UNIQUE" in detail.upper() or "unique" in detail.lower()
                        else f"DB error: {detail[:120]}"
                    ),
                })

        # Sort failed_rows by row_idx so the response reads top-to-bottom
        # matching the operator's input (pass-1 + pass-2 failures merge).
        failed_rows.sort(key=lambda r: r["row"])

        self.session.commit()
        return {
            "success_count":      len(phone_ids),
            "failed_count":       len(failed_rows),
            "phone_ids":          phone_ids,
            "entity_ids":         [new_entity.id],
            "failed_rows":        failed_rows,
            "bulk_submission_id": submission_id,
        }

    # ----------------------------------------------------------------
    # Public — bulk-upload entry point (Phase E1-B)
    # ----------------------------------------------------------------

    def ingest_bulk_upload(
        self,
        file_bytes: bytes,
        filename: str,
    ) -> dict:
        """
        Parse an Excel (.xlsx) or CSV file and insert one PhoneNumber
        per row. Unlike bulk-text, each row may target a different
        Entity — rows are NOT collapsed under a single shared envelope.
        For each row, the service either reuses an existing Entity
        (when target_entity_id is supplied AND the row's other context
        fields match the target's owning row) or creates a NEW Entity
        from the row's context.

        For simplicity in this slice: every row → new Entity. Operator
        ergonomics suggest a "reuse existing entity when target_entity_id
        provided AND entity_type/client_id match" future enhancement;
        deferred until a real workflow demands it.

        Args:
            file_bytes (bytes):   Raw file contents from the upload.
            filename   (str):     Original filename — used only to pick
                                  the parser (.xlsx vs .csv) and to echo
                                  back in error messages.

        Returns:
            dict: BulkIngestSummary-shaped dict (same shape as bulk-text).

        Raises:
            ValueError: malformed file, missing required columns, too
                        many rows, unparseable header. The endpoint
                        maps this to 422.
        """
        submission_id = str(uuid.uuid4())

        # Pick the parser by filename extension. We don't sniff the
        # bytes here — the endpoint is responsible for the security
        # check (size cap + extension whitelist). Filenames without an
        # extension hit the default (.xlsx); CSV must be explicit.
        lower = filename.lower()
        if lower.endswith(".csv"):
            rows = self._parse_csv(file_bytes)
        elif lower.endswith(".xlsx"):
            rows = self._parse_xlsx(file_bytes)
        else:
            raise ValueError(
                f"Unsupported file extension: '{filename}'. Allowed: .xlsx, .csv"
            )

        if len(rows) > BULK_UPLOAD_MAX_ROWS:
            raise ValueError(
                f"Too many rows: {len(rows)} (max {BULK_UPLOAD_MAX_ROWS})"
            )

        # ----------------------------------------------------------------
        # Pass 1 — validate per-row shape, build candidates list.
        # ----------------------------------------------------------------
        failed_rows: list[dict] = []
        # candidates: list of (row_idx, row_dict_with_normalized_phone)
        candidates: list[tuple[int, dict]] = []
        seen_phones: dict[str, int] = {}

        for row_idx, row in enumerate(rows, start=1):
            # Strip whitespace from all string values for cleanliness.
            raw_phone = str(row.get("phone_number") or "").strip()
            if not raw_phone:
                failed_rows.append({
                    "row": row_idx,
                    "input": _safe_input_str(row),
                    "error": "Missing phone_number",
                })
                continue
            normalized = _normalize(raw_phone)
            if not normalized or not _PHONE_REGEX.match(normalized):
                failed_rows.append({
                    "row": row_idx,
                    "input": raw_phone[:_FAILURE_INPUT_CAP],
                    "error": "Invalid phone format",
                })
                continue
            # Required-field check (excluding phone_number, already done).
            missing = [
                col for col in BULK_UPLOAD_REQUIRED_COLUMNS[1:]
                if not row.get(col) and row.get(col) != 0
            ]
            if missing:
                failed_rows.append({
                    "row": row_idx,
                    "input": raw_phone[:_FAILURE_INPUT_CAP],
                    "error": f"Missing required field(s): {', '.join(missing)}",
                })
                continue
            # client_id coercion to int.
            try:
                row["client_id"] = int(row["client_id"])
            except (TypeError, ValueError):
                failed_rows.append({
                    "row": row_idx,
                    "input": raw_phone[:_FAILURE_INPUT_CAP],
                    "error": "client_id must be an integer",
                })
                continue
            # Optional target_entity_id coercion.
            tgt = row.get("target_entity_id")
            if tgt not in (None, ""):
                try:
                    row["target_entity_id"] = int(tgt)
                except (TypeError, ValueError):
                    failed_rows.append({
                        "row": row_idx,
                        "input": raw_phone[:_FAILURE_INPUT_CAP],
                        "error": "target_entity_id must be an integer",
                    })
                    continue
            else:
                row["target_entity_id"] = None
            # Within-batch dedup.
            if normalized in seen_phones:
                failed_rows.append({
                    "row": row_idx,
                    "input": raw_phone[:_FAILURE_INPUT_CAP],
                    "error": f"Duplicate of row {seen_phones[normalized]} in this batch",
                })
                continue
            seen_phones[normalized] = row_idx
            row["_normalized_phone"] = normalized
            candidates.append((row_idx, row))

        # ----------------------------------------------------------------
        # Pass 2 — per-row insert with savepoints. Each row gets its
        # own Entity (the bulk-upload mental model is "every row is its
        # own ingestion context").
        # ----------------------------------------------------------------
        phone_ids: list[int] = []
        entity_ids: list[int] = []

        for row_idx, row in candidates:
            try:
                with self.session.begin_nested():
                    # Validate target_entity_id existence per-row. A bad
                    # FK here lands as a per-row failure, NOT a
                    # request-level abort (different from bulk-text).
                    target_id = row.get("target_entity_id")
                    if target_id is not None:
                        if self.session.get(Entity, target_id) is None:
                            raise ValueError(
                                f"target_entity_id={target_id} not found"
                            )

                    entity_extra = {"bulk_submission_id": submission_id}
                    new_entity = Entity(
                        client_id=row["client_id"],
                        relation_type=(
                            "associated" if row["entity_type"] != "target"
                            else "primary"
                        ),
                        entity_type=row["entity_type"],
                        target_entity_id=target_id,
                        extra_data=entity_extra,
                    )
                    self.session.add(new_entity)
                    self.session.flush()

                    phone = PhoneNumber(
                        entity_id=new_entity.id,
                        phone_number=row["_normalized_phone"],
                        ingestion_source=row["ingestion_source"],
                        ingestion_reason=row.get("ingestion_reason"),
                        extra_data={"bulk_submission_id": submission_id},
                    )
                    self.session.add(phone)
                    self.session.flush()
                    if self.scoring_service is not None:
                        self.scoring_service.recalculate_for_phone(
                            phone.id, commit=False
                        )
                phone_ids.append(phone.id)
                entity_ids.append(new_entity.id)
            except (IntegrityError, ValueError) as exc:
                # Both kinds of error land here — IntegrityError from
                # SQLAlchemy (UNIQUE violation, FK violation) and ValueError
                # from our own checks inside the savepoint.
                if isinstance(exc, IntegrityError):
                    detail = str(exc.orig) if exc.orig else "Database constraint violation"
                    msg = (
                        "Already exists in the system"
                        if "UNIQUE" in detail.upper() or "unique" in detail.lower()
                        else f"DB error: {detail[:120]}"
                    )
                else:
                    msg = str(exc)
                failed_rows.append({
                    "row": row_idx,
                    "input": row.get("_normalized_phone", "")[:_FAILURE_INPUT_CAP],
                    "error": msg,
                })

        failed_rows.sort(key=lambda r: r["row"])
        self.session.commit()
        return {
            "success_count":      len(phone_ids),
            "failed_count":       len(failed_rows),
            "phone_ids":          phone_ids,
            "entity_ids":         entity_ids,
            "failed_rows":        failed_rows,
            "bulk_submission_id": submission_id,
        }

    # ----------------------------------------------------------------
    # File parsers — kept as private static methods so they're trivial
    # to test without instantiating the service.
    # ----------------------------------------------------------------

    @staticmethod
    def _parse_csv(file_bytes: bytes) -> list[dict]:
        """
        Parse a CSV upload into a list of dict rows (column → cell value).

        UTF-8-SIG is the default decoding — Excel exports often include
        a BOM. Other encodings would need an explicit charset header on
        the upload; for MVP we don't support them.

        Raises ValueError if the header is missing required columns.
        """
        try:
            text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError(f"CSV not UTF-8 decodable: {exc}") from exc

        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None:
            raise ValueError("CSV is empty or has no header row")
        missing = [
            c for c in BULK_UPLOAD_REQUIRED_COLUMNS if c not in reader.fieldnames
        ]
        if missing:
            raise ValueError(
                f"CSV header missing required columns: {', '.join(missing)}"
            )
        return list(reader)

    @staticmethod
    def _parse_xlsx(file_bytes: bytes) -> list[dict]:
        """
        Parse an .xlsx upload into a list of dict rows.

        Uses openpyxl's read_only + data_only modes for streaming-style
        access and to read formula RESULTS (not the formula text itself
        — paranoid against operators uploading sheets with `=A1+B1`).

        The header row is the FIRST row of the FIRST visible worksheet.
        Required-column presence is validated here; per-row content
        validation runs in the caller.
        """
        try:
            wb = openpyxl.load_workbook(
                io.BytesIO(file_bytes),
                read_only=True,
                data_only=True,
            )
        except Exception as exc:
            raise ValueError(f"Not a valid .xlsx workbook: {exc}") from exc

        ws = wb.active
        if ws is None:
            raise ValueError("Workbook has no active sheet")

        # First non-empty row is the header. Empty leading rows are
        # tolerated (some operators paste a blank "header" row by accident).
        rows_iter = ws.iter_rows(values_only=True)
        header_row = None
        for row in rows_iter:
            if any(cell is not None and str(cell).strip() for cell in row):
                header_row = row
                break
        if header_row is None:
            raise ValueError("Workbook is empty")

        header = [str(c).strip() if c is not None else "" for c in header_row]
        missing = [c for c in BULK_UPLOAD_REQUIRED_COLUMNS if c not in header]
        if missing:
            raise ValueError(
                f"Workbook header missing required columns: {', '.join(missing)}"
            )

        # Build dicts from the remaining rows. Empty rows skipped.
        result = []
        for row in rows_iter:
            if not any(cell is not None and str(cell).strip() for cell in row):
                continue
            row_dict = {}
            for col_name, cell in zip(header, row):
                if not col_name:
                    continue
                # Treat empty string as None for consistency with CSV.
                if isinstance(cell, str):
                    cell = cell.strip() or None
                row_dict[col_name] = cell
            result.append(row_dict)
        return result

    # ----------------------------------------------------------------
    # Template generation (Phase E1-B)
    # ----------------------------------------------------------------

    @staticmethod
    def generate_template_xlsx() -> bytes:
        """
        Generate the Excel upload template in memory and return the bytes.

        Two sheets:
            1. "data" — the header row + 3 example rows operators can
               replace with their own data.
            2. "instructions" — Hebrew operator notes explaining each
               column. The column names themselves stay English (they
               are the API contract; renaming them breaks parsing).

        The bytes are suitable for direct return as a FastAPI
        Response(media_type="application/vnd.openxmlformats-...").
        """
        wb = Workbook()
        ws = wb.active
        ws.title = "data"
        # Header
        ws.append(list(BULK_UPLOAD_ALL_COLUMNS))
        # Three example rows demonstrating the expected shape.
        ws.append(["+14155551111", 1, "family",          "manual",    None, "Spouse — found via referral"])
        ws.append(["+14155551112", 1, "friend",          "manual",    None, "Close friend"])
        ws.append(["+14155551113", 2, "social_envelope", "automated", None, "Cluster scrape, unknown owner"])

        # Instructions sheet — Hebrew notes for operators.
        ins = wb.create_sheet(title="instructions")
        ins.append(["שדה", "תיאור", "חובה"])
        ins.append(["phone_number",     "מספר הטלפון בפורמט בינלאומי (+E.164 מומלץ)",                     "כן"])
        ins.append(["client_id",        "מזהה מספרי של הלקוח (לפי clientRegistry בצד הלקוח)",            "כן"])
        ins.append(["entity_type",      "סוג הישות: target / family / friend / colleague / social_envelope", "כן"])
        ins.append(["ingestion_source", "מקור הקליטה: manual / automated / import / partner_feed",       "כן"])
        ins.append(["target_entity_id", "מזהה הישות הראשית שאליה הקבוצה משויכת. ריק עבור יעד ראשי חדש.", "לא"])
        ins.append(["ingestion_reason", "טקסט חופשי — סיבת/הסבר הקליטה",                                  "לא"])

        # Serialize to bytes via an in-memory stream.
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()


# ---------------------------------------------------------------------------
# Module-level helpers (private to the bulk-upload path)
# ---------------------------------------------------------------------------


def _safe_input_str(row: dict) -> str:
    """
    Build a short, operator-readable echo of a failing row dict for the
    `input` field of BulkIngestFailedRow. Caps total length at
    _FAILURE_INPUT_CAP characters.
    """
    parts = []
    for col in BULK_UPLOAD_ALL_COLUMNS:
        val = row.get(col)
        if val is not None and val != "":
            parts.append(f"{col}={val}")
    rendered = " | ".join(parts)
    return rendered[:_FAILURE_INPUT_CAP] if rendered else "(empty row)"
