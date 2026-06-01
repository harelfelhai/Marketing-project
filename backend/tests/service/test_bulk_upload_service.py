"""
Service-layer tests for BulkIngestionService.ingest_bulk_upload (Phase E1-B).

Covers the resilience contract end-to-end for file uploads:
    - happy path (.csv + .xlsx)
    - per-row format failures
    - missing required fields per row
    - DB-level UNIQUE failure handled per-row
    - target_entity_id existence is a PER-ROW failure (not a request-level
      error like in bulk-text), since each row carries its own target
    - file-shape errors raise ValueError (mapped to 422 at the endpoint)
    - audit-trail bulk_submission_id stamped on every created Entity + Phone
    - one Entity created per surviving row (NOT one shared envelope)
"""

import csv
import io

import pytest
from openpyxl import Workbook

from models.entity import Entity
from models.phone_number import PhoneNumber
from modules.mock_scoring import ScoringStrategy
from services.bulk_ingestion import (
    BULK_UPLOAD_ALL_COLUMNS,
    BULK_UPLOAD_MAX_ROWS,
    BULK_UPLOAD_REQUIRED_COLUMNS,
    BulkIngestionService,
)
from services.scoring import ScoringService
from repositories.storage import SqlStorage


# ---------------------------------------------------------------------------
# Fixtures + helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def bulk(session):
    """Service wired with the open-source mock scoring strategy."""
    scoring = ScoringService(storage=SqlStorage(session), strategy=ScoringStrategy())
    return BulkIngestionService(session=session, scoring_service=scoring)


def _csv_bytes(rows: list[list]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _xlsx_bytes(rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ===========================================================================
# Happy paths
# ===========================================================================


def _seed_roots(session, n=2):
    """Insert `n` root target entities; return their string ids."""
    roots = []
    for _ in range(n):
        r = Entity(entity_type="target", relation_type="primary")
        session.add(r)
        roots.append(r)
    session.commit()
    for r in roots:
        session.refresh(r)
    return [r.id for r in roots]


class TestHappyPath:
    def test_csv_three_valid_rows_creates_three_entities(self, bulk, session):
        r1, r2 = _seed_roots(session, 2)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551101", r1, "family", "manual"],
            ["+14155551102", r1, "friend", "manual"],
            ["+14155551103", r2, "social_envelope", "automated"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        # E1-B model: one Entity per row (NOT one shared envelope).
        assert len(summary["entity_ids"]) == 3
        assert len(summary["phone_ids"]) == 3

    def test_xlsx_happy_path(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _xlsx_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551110", r1, "family", "manual"],
            ["+14155551111", r1, "friend", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.xlsx")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0
        assert len(summary["entity_ids"]) == 2

    def test_scoring_hook_fires_per_row(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551120", r1, "family", "manual"],
            ["+14155551121", r1, "friend", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        for pid in summary["phone_ids"]:
            phone = session.get(PhoneNumber, pid)
            assert phone.priority_score > 0
            assert phone.priority_updated_at is not None

    def test_audit_trail_stamped_on_entity_and_phones(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551130", r1, "family", "manual"],
            ["+14155551131", r1, "friend", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        sid = summary["bulk_submission_id"]
        assert sid
        # Every created Entity carries the audit id.
        for eid in summary["entity_ids"]:
            entity = session.get(Entity, eid)
            assert entity.extra_data["bulk_submission_id"] == sid
        # Every created phone carries the same audit id.
        for pid in summary["phone_ids"]:
            phone = session.get(PhoneNumber, pid)
            assert phone.extra_data["bulk_submission_id"] == sid

    def test_optional_columns_consumed(self, bulk, session):
        # Pre-seed a primary target so the target_entity_id link is valid.
        target = Entity(entity_type="target", relation_type="primary", client_id=1)
        session.add(target); session.commit(); session.refresh(target)

        data = _csv_bytes([
            list(BULK_UPLOAD_ALL_COLUMNS),
            ["+14155551140", "1", "family", "manual", str(target.id), "Mother"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        entity = session.get(Entity, summary["entity_ids"][0])
        assert entity.target_entity_id == target.id
        phone = session.get(PhoneNumber, summary["phone_ids"][0])
        assert phone.ingestion_reason == "Mother"


# ===========================================================================
# Per-row failures
# ===========================================================================


class TestPerRowFailures:
    def test_invalid_phone_format_lands_in_failed_rows(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551150", r1, "family", "manual"],
            ["NOTAPHONE",   r1, "family", "manual"],
            ["+14155551151", r1, "family", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2

    def test_missing_required_field_lands_in_failed_rows(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551160", r1, "family", "manual"],
            ["+14155551161", r1, "",       "manual"],   # entity_type missing
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "entity_type" in summary["failed_rows"][0]["error"]

    def test_missing_phone_lands_in_failed_rows(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["",            r1, "family", "manual"],
            ["+14155551170", r1, "family", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "phone_number" in summary["failed_rows"][0]["error"].lower()

    def test_missing_client_id_lands_in_failed_rows(self, bulk, session):
        # The old int-format validation for client_id is gone. A genuinely
        # MISSING required client_id is what now lands a row in failed_rows.
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551180", "", "family", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 1
        assert "client_id" in summary["failed_rows"][0]["error"]

    def test_within_batch_duplicate_flagged(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551190", r1, "family", "manual"],
            ["+14155551190", r1, "family", "manual"],   # duplicate
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "row 1" in summary["failed_rows"][0]["error"]

    def test_unique_constraint_violation_handled_per_row(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        # Pre-seed an existing phone.
        existing_entity = Entity(entity_type="family", target_entity_id=r1)
        session.add(existing_entity); session.flush()
        session.add(PhoneNumber(
            entity_id=existing_entity.id,
            phone_number="+14155551200",
            ingestion_source="manual",
        ))
        session.commit()

        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551201", r1, "family", "manual"],
            ["+14155551200", r1, "family", "manual"],   # collides
            ["+14155551202", r1, "family", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2

    def test_unknown_target_entity_id_per_row_failure(self, bulk, session):
        (r1,) = _seed_roots(session, 1)
        # Different contract from bulk-text: target_entity_id is on each
        # row, so a bad value is a per-row failure (not request-level).
        data = _csv_bytes([
            list(BULK_UPLOAD_ALL_COLUMNS),
            ["+14155551210", r1, "family", "manual", "99999", "bad target"],
            ["+14155551211", r1, "family", "manual", "",      "ok"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 1
        assert "99999" in summary["failed_rows"][0]["error"]


# ===========================================================================
# File-shape errors (ValueError → 422 at endpoint)
# ===========================================================================


class TestFileShapeErrors:
    def test_unsupported_extension_raises(self, bulk):
        with pytest.raises(ValueError, match="Unsupported file extension"):
            bulk.ingest_bulk_upload(b"hello", "upload.txt")

    def test_csv_missing_required_column_raises(self, bulk):
        data = _csv_bytes([
            ["phone_number", "client_id"],   # missing entity_type + ingestion_source
            ["+14155551220", "1"],
        ])
        with pytest.raises(ValueError, match="missing required columns"):
            bulk.ingest_bulk_upload(data, "upload.csv")

    def test_xlsx_missing_required_column_raises(self, bulk):
        data = _xlsx_bytes([
            ["phone_number", "client_id", "entity_type"],
            ["+14155551230", 1, "family"],
        ])
        with pytest.raises(ValueError, match="missing required columns"):
            bulk.ingest_bulk_upload(data, "upload.xlsx")

    def test_unparseable_xlsx_raises(self, bulk):
        with pytest.raises(ValueError):
            bulk.ingest_bulk_upload(b"not a workbook", "upload.xlsx")

    def test_too_many_rows_raises(self, bulk):
        # Build a CSV with BULK_UPLOAD_MAX_ROWS + 1 data rows.
        rows = [list(BULK_UPLOAD_REQUIRED_COLUMNS)]
        for i in range(BULK_UPLOAD_MAX_ROWS + 1):
            rows.append([f"+1415555{i:04d}00", "1", "family", "manual"])
        data = _csv_bytes(rows)
        with pytest.raises(ValueError, match="Too many rows"):
            bulk.ingest_bulk_upload(data, "upload.csv")


# ===========================================================================
# Empty / all-failed edge cases
# ===========================================================================


class TestEdgeCases:
    def test_empty_data_rows_returns_clean_summary(self, bulk):
        # Header only, no data rows.
        data = _csv_bytes([list(BULK_UPLOAD_REQUIRED_COLUMNS)])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 0
        assert summary["entity_ids"] == []
        assert summary["phone_ids"] == []

    def test_all_rows_invalid_creates_no_entity(self, bulk, session):
        # All three rows fail Pass 1; NO Entity created (orphan avoidance).
        entities_before = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        n_before = len(entities_before)

        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["abc", "1", "family", "manual"],
            ["def", "1", "family", "manual"],
            ["ghi", "1", "family", "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 3

        entities_after = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        assert len(entities_after) == n_before
