"""
Service-layer tests for BulkIngestionService.ingest_bulk_upload (Phase E1-B).

Covers the resilience contract end-to-end for file uploads:
    - happy path (.csv + .xlsx)
    - per-row format failures
    - missing required fields per row
    - DB-level UNIQUE failure handled per-row
    - file-shape errors raise ValueError (mapped to 422 at the endpoint)
    - audit-trail bulk_submission_id stamped on every created phone
"""

import csv
import io

import pytest
from openpyxl import Workbook

from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from services.bulk_ingestion import (
    BULK_UPLOAD_ALL_COLUMNS,
    BULK_UPLOAD_MAX_ROWS,
    BULK_UPLOAD_REQUIRED_COLUMNS,
    BulkIngestionService,
)
from repositories.storage import SqlStorage


# ---------------------------------------------------------------------------
# Fixtures + helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def bulk(session):
    """Service wired with an in-memory SQLite session."""
    return BulkIngestionService(storage=SqlStorage(session))


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


def _seed_entity(session):
    e = Entity(relation_type="primary", deleted_at=not_deleted())
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


# ===========================================================================
# Happy paths
# ===========================================================================


class TestHappyPath:
    def test_csv_two_valid_rows(self, bulk, session):
        e = _seed_entity(session)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551101", e.id, "manual"],
            ["+14155551102", e.id, "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0
        assert len(summary["phone_ids"]) == 2

    def test_xlsx_happy_path(self, bulk, session):
        e = _seed_entity(session)
        data = _xlsx_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551110", e.id, "manual"],
            ["+14155551111", e.id, "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.xlsx")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0

    def test_audit_trail_stamped_on_phones(self, bulk, session):
        e = _seed_entity(session)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551130", e.id, "manual"],
            ["+14155551131", e.id, "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        sid = summary["bulk_submission_id"]
        assert sid
        for pid in summary["phone_ids"]:
            phone = session.get(PhoneNumber, pid)
            assert phone.extra_data["bulk_submission_id"] == sid


# ===========================================================================
# Per-row failures
# ===========================================================================


class TestPerRowFailures:
    def test_invalid_phone_format_lands_in_failed_rows(self, bulk, session):
        e = _seed_entity(session)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551150", e.id, "manual"],
            ["NOTAPHONE",    e.id, "manual"],
            ["+14155551151", e.id, "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2

    def test_missing_phone_lands_in_failed_rows(self, bulk, session):
        e = _seed_entity(session)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["",             e.id, "manual"],
            ["+14155551170", e.id, "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "phone_number" in summary["failed_rows"][0]["error"].lower()

    def test_within_batch_duplicate_flagged(self, bulk, session):
        e = _seed_entity(session)
        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551190", e.id, "manual"],
            ["+14155551190", e.id, "manual"],  # duplicate
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "row 1" in summary["failed_rows"][0]["error"]

    def test_unique_constraint_violation_handled_per_row(self, bulk, session):
        e = _seed_entity(session)
        # Pre-seed an existing phone.
        session.add(PhoneNumber(
            entity_id=e.id,
            phone_number="+14155551200",
            ingestion_source="manual",
            score=0.0,
            deleted_at=not_deleted(),
        ))
        session.commit()

        data = _csv_bytes([
            list(BULK_UPLOAD_REQUIRED_COLUMNS),
            ["+14155551201", e.id, "manual"],
            ["+14155551200", e.id, "manual"],  # collides
            ["+14155551202", e.id, "manual"],
        ])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2


# ===========================================================================
# File-shape errors (ValueError → 422 at endpoint)
# ===========================================================================


class TestFileShapeErrors:
    def test_unsupported_extension_raises(self, bulk):
        with pytest.raises(ValueError, match="Unsupported file extension"):
            bulk.ingest_bulk_upload(b"hello", "upload.txt")

    def test_csv_missing_required_column_raises(self, bulk):
        data = _csv_bytes([
            ["phone_number"],  # missing entity_id + ingestion_source
            ["+14155551220"],
        ])
        with pytest.raises(ValueError, match="missing required columns"):
            bulk.ingest_bulk_upload(data, "upload.csv")

    def test_xlsx_missing_required_column_raises(self, bulk):
        data = _xlsx_bytes([
            ["phone_number"],
            ["+14155551230"],
        ])
        with pytest.raises(ValueError, match="missing required columns"):
            bulk.ingest_bulk_upload(data, "upload.xlsx")

    def test_unparseable_xlsx_raises(self, bulk):
        with pytest.raises(ValueError):
            bulk.ingest_bulk_upload(b"not a workbook", "upload.xlsx")

    def test_too_many_rows_raises(self, bulk):
        rows = [list(BULK_UPLOAD_REQUIRED_COLUMNS)]
        for i in range(BULK_UPLOAD_MAX_ROWS + 1):
            rows.append([f"+1415555{i:04d}00", "entity-id", "manual"])
        data = _csv_bytes(rows)
        with pytest.raises(ValueError, match="Too many rows"):
            bulk.ingest_bulk_upload(data, "upload.csv")


# ===========================================================================
# Edge cases
# ===========================================================================


class TestEdgeCases:
    def test_empty_data_rows_returns_clean_summary(self, bulk):
        data = _csv_bytes([list(BULK_UPLOAD_REQUIRED_COLUMNS)])
        summary = bulk.ingest_bulk_upload(data, "upload.csv")
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 0
        assert summary["entity_ids"] == []
        assert summary["phone_ids"] == []
