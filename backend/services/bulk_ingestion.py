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

import re
import uuid
from typing import Optional, TYPE_CHECKING

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber

if TYPE_CHECKING:
    from services.scoring import ScoringService


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
