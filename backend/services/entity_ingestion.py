"""
services/entity_ingestion.py — Phase E2 entity-centric ingestion service.

Owns the single-entry channel in Phase E2-A. Bulk-text and bulk-upload
channels will land alongside this service in subsequent PRs (E2-B); the
class is intentionally structured to grow additional public methods
without churning the existing single-entry contract.

DISTINCTION FROM IngestionService
---------------------------------
`IngestionService.ingest_circle_member()` is PHONE-centric — it creates
an Entity + PhoneNumber atomically because the caller already holds a
phone number. `EntityIngestionService.create_single()` is PERSON-centric
— it creates an Entity standalone, with NO phone, so the system's
scraping and framing layers can start hunting for the person's numbers.

The two services intentionally do NOT share a base class: their
transaction shapes and downstream hooks differ enough that combining
them would introduce branches that obscure each path.

PRIVACY CONTRACT
----------------
Human-readable name fields (first_name, last_name) are merged into
`Entity.extra_data` rather than landing on schema-level columns. This
keeps the SQL schema speaking only in opaque integers and controlled
vocabulary, exactly as the Secrets-Free Mandate requires.
"""

import csv
import io
import uuid
from typing import Any, Optional

import openpyxl
from openpyxl import Workbook
from sqlalchemy.exc import IntegrityError

from exceptions import TargetNotFoundError
from interfaces.relation_types import ASSOCIATED_RELATIONS, RelationType
from models.entity import Entity


# ---------------------------------------------------------------------------
# Bulk-upload constants (Phase E2-B)
# ---------------------------------------------------------------------------

# Required header columns for the entity bulk-upload sheet. `last_name`
# is intentionally optional — operators submitting single-name rows
# (mononym, no surname known) should not be forced to leave a column
# empty in the header. This mirrors the phone-side template's
# required-vs-optional split.
BULK_ENTITY_REQUIRED_COLUMNS = (
    "first_name",
    "relation_type",
    "target_entity_id",
)
BULK_ENTITY_OPTIONAL_COLUMNS = (
    "last_name",
)
BULK_ENTITY_ALL_COLUMNS = BULK_ENTITY_REQUIRED_COLUMNS + BULK_ENTITY_OPTIONAL_COLUMNS

# Same upload-row cap as the phone-side endpoint — keeps the operator
# UX consistent across both bulk-upload paths.
BULK_ENTITY_MAX_ROWS = 5_000

# Cap on the `input` field of a failed-row entry (mirrors the phone
# bulk service constant). Prevents megabytes of garbage from being
# echoed back in the response body.
_FAILURE_INPUT_CAP = 200


class EntityIngestionService:
    """
    Single-entry writer for the Phase E2 "+ Add Person" modal.

    Constructed per request via the FastAPI dependency factory in
    `dependencies.get_entity_ingestion_service`. Holds a session
    reference; the caller is responsible for the session's lifecycle.
    """

    def __init__(self, storage) -> None:
        """
        Args:
            storage (Storage): Per-request repository bundle. Writes flow
                through the entities repo so the service runs identically
                on SQL and MongoDB.
        """
        self.entities = storage.entities

    def create_single(
        self,
        *,
        first_name: str,
        relation_type: str,
        target_entity_id: str,
        last_name: Optional[str] = None,
        strong_identifier: Optional[str] = None,
        extra_data: Optional[dict] = None,
        created_by_user_id: Optional[str] = None,
    ) -> Entity:
        """
        Create one Entity row associated with an existing root target.

        Lifecycle:
            a) TARGET VALIDATION
               Resolve `target_entity_id` against `Entity` and verify it
               is a ROOT target (`target.target_entity_id IS NULL`).
               Either condition failing raises `TargetNotFoundError` for
               uniform 422 translation at the endpoint layer.

            b) CLIENT INHERITANCE
               The new entity's `client_id` is copied from the target,
               not accepted on the request. This prevents partition
               drift between a target and its associated entities.

            c) NAME MERGE
               `first_name` and `last_name` are merged into the supplied
               `extra_data` (or a fresh dict). The Secrets-Free Mandate
               keeps these names off schema-level columns.

            d) COMMIT
               One INSERT + one COMMIT. The service does not invoke any
               scoring or routing hooks — those are phone-centric and
               this method creates no phone.

        Args:
            first_name (str): Given name. Trimmed of surrounding
                whitespace before storage.
            relation_type (str): Operator-creatable relation token from
                `AssociatedRelationType`. Validation is upstream
                (Pydantic enum on the request body); the service
                receives a known-good value and writes it verbatim to
                `Entity.entity_type`.
            target_entity_id (int): FK to the root target. Validated.
            last_name (Optional[str]): Family name. Trimmed and stored
                only when non-empty after trim.
            extra_data (Optional[dict]): Optional caller-supplied
                metadata. Merged WITH the names; caller keys take
                precedence only when they don't collide with the
                reserved name keys (callers shouldn't supply
                first_name/last_name inside extra_data, but if they
                do, the request-level fields win).

        Returns:
            Entity: The newly inserted, committed Entity row. All
            auto-assigned fields (`id`, `created_at`, `updated_at`)
            are populated.

        Raises:
            TargetNotFoundError: `target_entity_id` is missing from the
                DB or points at a non-root entity. The endpoint maps
                this to 422 Unprocessable Entity.
        """
        # ----------------------------------------------------------------
        # a) TARGET VALIDATION
        # ----------------------------------------------------------------
        target = self.entities.get(target_entity_id)
        if target is None:
            # Same exception class the bulk-text endpoint already maps to
            # 422 — keeps error translation consistent across E1/E2.
            raise TargetNotFoundError(
                target_phone_number=f"entity_id={target_entity_id}"
            )
        if target.target_entity_id is not None:
            # The target exists but is itself an associated entity. Allowing
            # this would create a 3-level chain (new → mid → root) and
            # violate the "two levels max" graph invariant that the scoring
            # service's single-hop root resolution relies on.
            raise TargetNotFoundError(
                target_phone_number=(
                    f"entity_id={target_entity_id} is not a root target "
                    "(its own target_entity_id is non-NULL)"
                )
            )

        # ----------------------------------------------------------------
        # b/c) BUILD ROW — client inheritance + name merge into extra_data.
        # ----------------------------------------------------------------
        # Start from the caller's extras (or empty dict) so any
        # operator-supplied keys survive. Then overlay the names — they
        # are the canonical write here and must not be shadowed by stale
        # values left in the caller payload.
        merged_extra: dict = dict(extra_data or {})
        merged_extra["first_name"] = first_name.strip()
        if last_name is not None:
            trimmed_last = last_name.strip()
            if trimmed_last:
                merged_extra["last_name"] = trimmed_last

        # UAT round-3 — strong_identifier is its own column. Empty
        # strings collapse to None so the DB only stores meaningful
        # values.
        sid = (strong_identifier or "").strip() or None

        # Client membership is derived: pointing target_entity_id at the
        # root IS the client assignment. No separate client_id to set.
        new_entity = Entity(
            relation_type="associated",
            entity_type=relation_type,
            target_entity_id=target.id,
            extra_data=merged_extra,
            strong_identifier=sid,
            created_by_user_id=created_by_user_id,     # Phase AUTH-B
        )

        # ----------------------------------------------------------------
        # d) PERSIST — single-row insert.
        # ----------------------------------------------------------------
        return self.entities.add(new_entity)

    # ----------------------------------------------------------------
    # UAT round-3 — synthetic social envelope (no name)
    # ----------------------------------------------------------------

    def create_envelope(
        self,
        client_id: str,
        *,
        created_by_user_id: Optional[str] = None,
    ):
        """
        Mint an anonymous social-envelope entity under a client.

        Used by the simplified phone-ingestion form when the operator
        picks the "general envelope" option — there's no named owner,
        just a known client and an unknown person near them.

        Two-level model: the envelope is a MEMBER of the client, so it
        points at the client's root entity via `target_entity_id`. Its
        derived `client_id` therefore equals `client_id` (the root).
        `client_id` here names the ROOT/client entity id to attach to —
        NOT a separate partition integer.

        entity_type      = 'social_envelope'
        target_entity_id = client_id (the root entity)
        extra_data       = empty dict (no first/last name)

        Raises ValueError if the named client root does not exist or is
        not itself a root (so envelopes can't dangle off a member).
        """
        root = self.entities.get(client_id)
        if root is None:
            raise TargetNotFoundError(target_phone_number=f"client_id={client_id}")
        if root.target_entity_id is not None:
            # The attach point must be a root (a client), not a member.
            raise TargetNotFoundError(
                target_phone_number=f"client_id={client_id} is not a root client"
            )
        ent = Entity(
            entity_type=RelationType.SOCIAL_ENVELOPE.value,
            relation_type="associated",
            target_entity_id=client_id,
            extra_data={},
            created_by_user_id=created_by_user_id,
        )
        return self.entities.add(ent)

    # ----------------------------------------------------------------
    # Public — bulk-text entry point (Phase E2-B)
    # ----------------------------------------------------------------

    def ingest_bulk_text(
        self,
        *,
        rows: list[dict],
        default_relation_type: str,
        default_target_entity_id: str,
        created_by_user_id: Optional[str] = None,
    ) -> dict:
        """
        Insert one Entity row per item in `rows` with per-row resilience.

        Two-pass execution mirrors the phone-side bulk-text contract:

            Pass 1 (in-memory)
                - Resolve the request-level default target. A missing /
                  non-root default aborts the WHOLE submission with
                  TargetNotFoundError (mapped to 422 at the endpoint).
                - Pre-load every per-row target override in ONE query,
                  building a cache so Pass 2 has zero per-row lookups.
                - Validate each row's first_name, relation_type, and
                  target. Failures append to `failed_rows`.

            Pass 2 (DB writes)
                - For each surviving candidate, open a SAVEPOINT,
                  INSERT the Entity, release-or-rollback.
                - Per-row IntegrityError lands in `failed_rows` without
                  affecting the outer transaction.
                - One COMMIT at the end persists all surviving rows
                  atomically.

        Args:
            rows (list[dict]): Curated payload from the inline editor
                grid. Each dict carries keys `row_token`, `first_name`,
                `last_name`, `relation_type`, `target_entity_id` — the
                Pydantic layer is the source of truth for shapes.
            default_relation_type (str): Modal-level default applied to
                any row whose `relation_type` is None. Validated by the
                Pydantic enum upstream; arriving as a known-good token.
            default_target_entity_id (int): Modal-level default applied
                to any row whose `target_entity_id` is None.

        Returns:
            dict: BulkIngestSummary-shaped (matches the existing
            `phones/bulk-*` response). `phone_ids` is ALWAYS empty
            (entity ingestion creates no phones).

        Raises:
            TargetNotFoundError: The request-level default target does
                not exist OR is not a root target. The endpoint maps
                this to 422 — per-row override failures DO NOT raise.
        """
        submission_id = str(uuid.uuid4())

        # ----------------------------------------------------------------
        # Pre-flight — validate the request-level default target.
        # ----------------------------------------------------------------
        default_target = self.entities.get(default_target_entity_id)
        if default_target is None:
            raise TargetNotFoundError(
                target_phone_number=f"entity_id={default_target_entity_id}"
            )
        if default_target.target_entity_id is not None:
            raise TargetNotFoundError(
                target_phone_number=(
                    f"entity_id={default_target_entity_id} is not a root "
                    "target (its own target_entity_id is non-NULL)"
                )
            )

        # ----------------------------------------------------------------
        # Pre-resolve per-row target overrides in ONE query to avoid the
        # N+1 lookup that would otherwise happen inside Pass 1. The
        # default target is added to the cache so Pass 1's lookup loop
        # has a single uniform shape.
        # ----------------------------------------------------------------
        override_ids: set[str] = {
            r["target_entity_id"]
            for r in rows
            if r.get("target_entity_id") is not None
            and r["target_entity_id"] != default_target_entity_id
        }
        target_lookup: dict[str, Entity] = {default_target.id: default_target}
        if override_ids:
            for ent in self.entities.list({"id": {"in": list(override_ids)}}):
                target_lookup[ent.id] = ent

        # ----------------------------------------------------------------
        # Pass 1 — in-memory validation, build the candidate list.
        # ----------------------------------------------------------------
        failed_rows: list[dict] = []
        candidates: list[dict] = []

        for idx, row in enumerate(rows, start=1):
            token = (row.get("row_token") or "")[:_FAILURE_INPUT_CAP]

            first = (row.get("first_name") or "").strip()
            if not first:
                failed_rows.append({
                    "row": idx,
                    "input": token,
                    "error": "first_name is required",
                })
                continue

            relation = row.get("relation_type") or default_relation_type
            # The Pydantic enum already filtered illegal request-level
            # values, but a defensive check here protects callers that
            # construct rows in code (e.g. tests) without the enum.
            if relation not in ASSOCIATED_RELATIONS:
                failed_rows.append({
                    "row": idx,
                    "input": token,
                    "error": (
                        f"Invalid relation_type '{relation}' (allowed: "
                        f"{', '.join(sorted(ASSOCIATED_RELATIONS))})"
                    ),
                })
                continue

            override_tgt = row.get("target_entity_id")
            tgt_id = override_tgt if override_tgt is not None else default_target_entity_id
            tgt = target_lookup.get(tgt_id)
            if tgt is None:
                failed_rows.append({
                    "row": idx,
                    "input": token,
                    "error": f"target_entity_id={tgt_id} not found",
                })
                continue
            if tgt.target_entity_id is not None:
                failed_rows.append({
                    "row": idx,
                    "input": token,
                    "error": (
                        f"target_entity_id={tgt_id} is not a root target"
                    ),
                })
                continue

            last = row.get("last_name")
            last_trim = last.strip() if isinstance(last, str) else None

            candidates.append({
                "row": idx,
                "row_token": row.get("row_token") or "",
                "first_name": first,
                "last_name": last_trim or None,
                "relation_type": relation,
                "target": tgt,
                # UAT round-3 — strong_identifier is now a first-class
                # Entity column. extra_data still carries any other
                # caller-supplied opaque metadata.
                "strong_identifier": (row.get("strong_identifier") or "").strip() or None,
                "extra_data": row.get("extra_data") or {},
            })

        # ----------------------------------------------------------------
        # Pass 2 — per-row inserts. Each add is independent; a per-row DB
        # error is recorded without aborting the batch (the resilience
        # contract). The repo seam commits each write, so there is no
        # nested-transaction savepoint to manage — the per-row try/except
        # is the backend-agnostic equivalent.
        # ----------------------------------------------------------------
        entity_ids: list[str] = []
        for c in candidates:
            try:
                extra: dict[str, Any] = {
                    "first_name": c["first_name"],
                    "bulk_submission_id": submission_id,
                }
                if c["last_name"]:
                    extra["last_name"] = c["last_name"]
                if c["row_token"]:
                    # Round-trip the original token so failed-row reports
                    # can correlate back to the operator's grid input.
                    extra["row_token"] = c["row_token"]
                # UAT round-3 — per-row caller blob (strong_identifier,
                # etc.). Merge IN after the name/token defaults so the
                # caller's keys win on conflict.
                if c.get("extra_data"):
                    extra.update(c["extra_data"])

                ent = Entity(
                    relation_type="associated",
                    entity_type=c["relation_type"],
                    target_entity_id=c["target"].id,
                    extra_data=extra,
                    strong_identifier=c.get("strong_identifier"),
                    created_by_user_id=created_by_user_id,     # Phase AUTH-B
                )
                self.entities.add(ent)
                entity_ids.append(ent.id)
            except IntegrityError as exc:
                detail = str(exc.orig) if exc.orig else "Database constraint violation"
                failed_rows.append({
                    "row": c["row"],
                    "input": c["row_token"][:_FAILURE_INPUT_CAP],
                    "error": f"DB error: {detail[:120]}",
                })

        failed_rows.sort(key=lambda r: r["row"])
        return {
            "success_count":      len(entity_ids),
            "failed_count":       len(failed_rows),
            "phone_ids":          [],
            "entity_ids":         entity_ids,
            "failed_rows":        failed_rows,
            "bulk_submission_id": submission_id,
        }

    # ----------------------------------------------------------------
    # Public — bulk-upload entry point (Phase E2-B)
    # ----------------------------------------------------------------

    def ingest_bulk_upload(
        self,
        file_bytes: bytes,
        filename: str,
        created_by_user_id: Optional[str] = None,
    ) -> dict:
        """
        Parse an Excel (.xlsx) or CSV file and insert one Entity per row.

        Each row is its own ingestion context: own target_entity_id, own
        relation_type. No request-level defaults — the file is the full
        statement of intent. (Operators who want shared defaults should
        use the bulk-text endpoint with the inline grid.)

        Args:
            file_bytes (bytes): Raw file content from the upload.
            filename   (str):   Original filename — used only to pick
                                the parser (.xlsx vs .csv) and to echo
                                back in error messages.

        Returns:
            dict: BulkIngestSummary-shaped dict.

        Raises:
            ValueError: malformed file, wrong extension, missing
                required columns, or row cap exceeded. The endpoint
                maps this to 422.
        """
        submission_id = str(uuid.uuid4())

        lower = filename.lower()
        if lower.endswith(".csv"):
            rows = self._parse_csv(file_bytes)
        elif lower.endswith(".xlsx"):
            rows = self._parse_xlsx(file_bytes)
        else:
            raise ValueError(
                f"Unsupported file extension: '{filename}'. Allowed: .xlsx, .csv"
            )

        if len(rows) > BULK_ENTITY_MAX_ROWS:
            raise ValueError(
                f"Too many rows: {len(rows)} (max {BULK_ENTITY_MAX_ROWS})"
            )

        # ----------------------------------------------------------------
        # Pre-resolve target FKs in one pass to avoid N+1 lookups.
        # ----------------------------------------------------------------
        candidate_target_ids: set[str] = set()
        for row in rows:
            tgt = row.get("target_entity_id")
            if tgt not in (None, ""):
                candidate_target_ids.add(str(tgt).strip())
        target_lookup: dict[str, Entity] = {}
        if candidate_target_ids:
            for ent in self.entities.list({"id": {"in": list(candidate_target_ids)}}):
                target_lookup[ent.id] = ent

        # ----------------------------------------------------------------
        # Pass 1 — per-row format / FK validation.
        # ----------------------------------------------------------------
        failed_rows: list[dict] = []
        candidates: list[tuple[int, dict]] = []

        for row_idx, row in enumerate(rows, start=1):
            first = str(row.get("first_name") or "").strip()
            if not first:
                failed_rows.append({
                    "row": row_idx,
                    "input": _safe_input_str(row),
                    "error": "Missing first_name",
                })
                continue

            relation = str(row.get("relation_type") or "").strip()
            if relation not in ASSOCIATED_RELATIONS:
                failed_rows.append({
                    "row": row_idx,
                    "input": _safe_input_str(row),
                    "error": (
                        f"Invalid relation_type '{relation}' (allowed: "
                        f"{', '.join(sorted(ASSOCIATED_RELATIONS))})"
                    ),
                })
                continue

            tgt_raw = row.get("target_entity_id")
            if tgt_raw in (None, ""):
                failed_rows.append({
                    "row": row_idx,
                    "input": _safe_input_str(row),
                    "error": "Missing target_entity_id",
                })
                continue
            tgt_id = str(tgt_raw).strip()

            tgt = target_lookup.get(tgt_id)
            if tgt is None:
                failed_rows.append({
                    "row": row_idx,
                    "input": _safe_input_str(row),
                    "error": f"target_entity_id={tgt_id} not found",
                })
                continue
            if tgt.target_entity_id is not None:
                failed_rows.append({
                    "row": row_idx,
                    "input": _safe_input_str(row),
                    "error": (
                        f"target_entity_id={tgt_id} is not a root target"
                    ),
                })
                continue

            last_raw = row.get("last_name")
            last = str(last_raw).strip() if last_raw not in (None, "") else None

            candidates.append((row_idx, {
                "first_name":    first,
                "last_name":     last,
                "relation_type": relation,
                "target":        tgt,
            }))

        # ----------------------------------------------------------------
        # Pass 2 — per-row insert. Each add commits independently; a
        # per-row DB error is recorded without aborting the batch.
        # ----------------------------------------------------------------
        entity_ids: list[str] = []
        for row_idx, c in candidates:
            try:
                extra: dict[str, Any] = {
                    "first_name":         c["first_name"],
                    "bulk_submission_id": submission_id,
                }
                if c["last_name"]:
                    extra["last_name"] = c["last_name"]
                ent = Entity(
                    relation_type="associated",
                    entity_type=c["relation_type"],
                    target_entity_id=c["target"].id,
                    extra_data=extra,
                    strong_identifier=c.get("strong_identifier"),
                    created_by_user_id=created_by_user_id,     # Phase AUTH-B
                )
                self.entities.add(ent)
                entity_ids.append(ent.id)
            except IntegrityError as exc:
                detail = str(exc.orig) if exc.orig else "Database constraint violation"
                failed_rows.append({
                    "row":   row_idx,
                    "input": _safe_input_str({
                        "first_name":       c["first_name"],
                        "last_name":        c["last_name"],
                        "relation_type":    c["relation_type"],
                        "target_entity_id": c["target"].id,
                    }),
                    "error": f"DB error: {detail[:120]}",
                })

        failed_rows.sort(key=lambda r: r["row"])
        return {
            "success_count":      len(entity_ids),
            "failed_count":       len(failed_rows),
            "phone_ids":          [],
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
        Parse a CSV upload into a list of dict rows.

        UTF-8-SIG is the default decoding to handle Excel's BOM exports.
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
            c for c in BULK_ENTITY_REQUIRED_COLUMNS if c not in reader.fieldnames
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

        read_only + data_only modes for streaming-style access and to
        read formula RESULTS instead of `=A1+B1` literals.
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

        rows_iter = ws.iter_rows(values_only=True)
        header_row = None
        for row in rows_iter:
            if any(cell is not None and str(cell).strip() for cell in row):
                header_row = row
                break
        if header_row is None:
            raise ValueError("Workbook is empty")

        header = [str(c).strip() if c is not None else "" for c in header_row]
        missing = [c for c in BULK_ENTITY_REQUIRED_COLUMNS if c not in header]
        if missing:
            raise ValueError(
                f"Workbook header missing required columns: {', '.join(missing)}"
            )

        result = []
        for row in rows_iter:
            if not any(cell is not None and str(cell).strip() for cell in row):
                continue
            row_dict: dict[str, Any] = {}
            for col_name, cell in zip(header, row):
                if not col_name:
                    continue
                if isinstance(cell, str):
                    cell = cell.strip() or None
                row_dict[col_name] = cell
            result.append(row_dict)
        return result

    # ----------------------------------------------------------------
    # Template generation (Phase E2-B)
    # ----------------------------------------------------------------

    def generate_template_xlsx(self) -> bytes:
        """
        Build the entity bulk-upload template in memory.

        Three sheets:
            1. "data" — header row + 2 example rows the operator
               replaces with real data.
            2. "valid_targets" — REFERENCE list of every current root
               target (entity_type='target', target_entity_id IS NULL),
               showing the integer FKs the operator can copy into the
               data sheet's `target_entity_id` column. Each row shows
               only structural identifiers (target_entity_id,
               client_id) per the Secrets-Free Mandate; the operator's
               frontend clientRegistry resolves the integer client_id
               to a display name.
            3. "instructions" — Hebrew operator notes describing each
               column.

        The reference sheet is computed at download time from a live
        DB query, so it always reflects the current state of the
        target table (no stale checked-in artifact). Static methods
        would have made this impossible — generating the template
        requires the session.
        """
        wb = Workbook()
        ws = wb.active
        ws.title = "data"

        # Header row. The column order is REQUIRED-then-OPTIONAL, so:
        #   first_name, relation_type, target_entity_id, last_name
        ws.append(list(BULK_ENTITY_ALL_COLUMNS))
        # Two example rows in the same column order as the header.
        # `target_entity_id` is deliberately a numeric placeholder (0);
        # the operator looks up the correct id in the valid_targets
        # sheet and edits the cell before upload.
        ws.append(["Jane", "family",    0, "Doe"])
        ws.append(["Sam",  "colleague", 0, "Chen"])

        # Reference sheet — live snapshot of every root target.
        ref = wb.create_sheet(title="valid_targets")
        ref.append(["target_entity_id", "client_id"])
        targets = self.entities.list({
            "target_entity_id": None,
            "entity_type": RelationType.TARGET.value,
        })
        # Deterministic order (client_id then id) — stable template output.
        targets.sort(key=lambda t: (t.client_id, t.id))
        for t in targets:
            ref.append([t.id, t.client_id])

        # Instructions sheet — Hebrew operator notes.
        ins = wb.create_sheet(title="instructions")
        ins.append(["שדה", "תיאור", "חובה"])
        ins.append(["first_name",       "שם פרטי של האדם החדש",                                            "כן"])
        ins.append(["last_name",        "שם משפחה (אופציונלי — מקובל גם רק שם פרטי)",                       "לא"])
        ins.append(["relation_type",    "סוג קרבה לישות הראשית: family / friend / colleague / spouse",     "כן"])
        ins.append(["target_entity_id", "מזהה מספרי של הישות הראשית. ראה גיליון valid_targets לערכים תקפים", "כן"])

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
    `input` field of a per-row failure entry. Capped at _FAILURE_INPUT_CAP
    characters so a row with megabytes of garbage in one cell can't blow
    up the response payload.
    """
    parts = []
    for col in BULK_ENTITY_ALL_COLUMNS:
        val = row.get(col)
        if val is not None and val != "":
            parts.append(f"{col}={val}")
    rendered = " | ".join(parts)
    return rendered[:_FAILURE_INPUT_CAP] if rendered else "(empty row)"
