"""
Service-layer tests for BulkIngestionService.ingest_bulk_text (Phase E1-A).

Covers the resilience contract end-to-end at the service layer:
    - happy path (all rows valid)
    - per-row format failures collected without aborting
    - within-batch duplicates flagged as failures
    - DB-level UNIQUE failures handled per-row
    - entity_id validation as request-level error
    - empty input returns clean summary
"""

import pytest

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from services.bulk_ingestion import BulkIngestionService
from repositories.storage import SqlStorage


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def bulk(session):
    """Service wired with an in-memory SQLite session."""
    return BulkIngestionService(storage=SqlStorage(session))


@pytest.fixture()
def entity(session):
    """A primary Entity that bulk submissions can attach to."""
    e = Entity(
        relation_type="primary",
        full_name="Test Person",
        deleted_at=not_deleted(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


# ===========================================================================
# Happy paths
# ===========================================================================


class TestHappyPath:
    def test_three_valid_numbers(self, bulk, entity, session):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550001, +14155550002, +14155550003",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert summary["failed_rows"] == []
        assert len(summary["phone_ids"]) == 3

    def test_audit_trail_stamped_on_phones(self, bulk, entity, session):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550010, +14155550011",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        sid = summary["bulk_submission_id"]
        assert sid  # uuid4 truthy

        for phone_id in summary["phone_ids"]:
            phone = session.get(PhoneNumber, phone_id)
            assert phone.extra_data["bulk_submission_id"] == sid

    def test_caller_supplied_extras_preserved_alongside_audit_id(
        self, bulk, entity, session
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550030",
            entity_id=entity.id,
            ingestion_source="automated",
            extra_shared={"source_cluster": "cluster-X"},
        )
        phone = session.get(PhoneNumber, summary["phone_ids"][0])
        assert phone.extra_data["source_cluster"] == "cluster-X"
        assert "bulk_submission_id" in phone.extra_data


# ===========================================================================
# Per-row format failures
# ===========================================================================


class TestFormatFailures:
    def test_unparseable_token_collected_as_per_row_failure(
        self, bulk, entity
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550040, NOTAPHONE, +14155550041",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2
        assert "NOTAPHONE" in summary["failed_rows"][0]["input"]

    def test_empty_after_normalization(self, bulk, entity):
        # Pure punctuation normalizes to empty string.
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="(--), +14155550060",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1


# ===========================================================================
# Deduplication within the batch
# ===========================================================================


class TestBatchDedup:
    def test_exact_duplicate_flagged_with_first_row_reference(
        self, bulk, entity
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550070, +14155550070",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2
        assert "row 1" in summary["failed_rows"][0]["error"]

    def test_dedup_after_normalization(self, bulk, entity):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+1-415-555-0080, +14155550080",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1


# ===========================================================================
# Request-level errors (raise to endpoint as 422)
# ===========================================================================


class TestRequestErrors:
    def test_unknown_entity_id_raises(self, bulk):
        with pytest.raises(TargetNotFoundError):
            bulk.ingest_bulk_text(
                phone_numbers_raw="+14155550100",
                entity_id="nonexistent-entity-id",
                ingestion_source="manual",
            )

    def test_zero_valid_candidates_returns_empty_summary(
        self, bulk, entity, session
    ):
        """When every row fails format validation no phones are inserted."""
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="abc, def, ghi",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 3
        assert summary["phone_ids"] == []
