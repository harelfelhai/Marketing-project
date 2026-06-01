"""
Service-layer tests for BulkIngestionService.ingest_bulk_text (Phase E1-A).

Covers the resilience contract end-to-end at the service layer:
    - happy path (all rows valid)
    - per-row format failures collected without aborting
    - within-batch duplicates flagged as failures
    - DB-level UNIQUE failures handled per-row via savepoints
    - target_entity_id validation as request-level error
    - Phase DY scoring hook triggered for every successful insert
    - audit-trail bulk_submission_id stamped on entity AND every phone
    - empty input / all-invalid input returns clean summary with no
      orphan Entity created
"""

import pytest

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from modules.mock_scoring import ScoringStrategy
from services.bulk_ingestion import BulkIngestionService
from services.scoring import ScoringService
from repositories.storage import SqlStorage


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def bulk(session):
    """Service wired with the open-source mock scoring strategy."""
    scoring = ScoringService(storage=SqlStorage(session), strategy=ScoringStrategy())
    return BulkIngestionService(storage=SqlStorage(session), scoring_service=scoring)


@pytest.fixture()
def primary_target(session):
    """A primary target Entity that bulk submissions can attach to."""
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=1,
        extra_data={"customer_tier": 1},
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


# ===========================================================================
# Happy paths
# ===========================================================================


class TestHappyPath:
    def test_three_valid_numbers(self, bulk, primary_target, session):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550001, +14155550002, +14155550003",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert summary["failed_rows"] == []
        assert len(summary["phone_ids"]) == 3
        assert len(summary["entity_ids"]) == 1
        # All three phones are attached to the SAME Entity (shared envelope).
        new_entity_id = summary["entity_ids"][0]
        for phone_id in summary["phone_ids"]:
            phone = session.get(PhoneNumber, phone_id)
            assert phone.entity_id == new_entity_id

    def test_audit_trail_stamped_on_entity_and_phones(
        self, bulk, primary_target, session
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550010, +14155550011",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        sid = summary["bulk_submission_id"]
        assert sid  # uuid4 truthy

        # Entity carries the audit id.
        entity = session.get(Entity, summary["entity_ids"][0])
        assert entity.extra_data["bulk_submission_id"] == sid

        # Every phone carries the same audit id.
        for phone_id in summary["phone_ids"]:
            phone = session.get(PhoneNumber, phone_id)
            assert phone.extra_data["bulk_submission_id"] == sid

    def test_scoring_hook_runs_for_every_phone(
        self, bulk, primary_target, session
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550020, +14155550021",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        for phone_id in summary["phone_ids"]:
            phone = session.get(PhoneNumber, phone_id)
            # Phase DY scoring hook fires per row → priority_score
            # populated (non-zero) and priority_updated_at set.
            assert phone.priority_score > 0
            assert phone.priority_updated_at is not None

    def test_caller_supplied_extras_preserved_alongside_audit_id(
        self, bulk, primary_target, session
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550030",
            client_id=1,
            entity_type="social_envelope",
            target_entity_id=primary_target.id,
            ingestion_source="automated",
            entity_extra={"envelope_id": "EP-200"},
            phone_extra_shared={"source_cluster": "cluster-X"},
        )
        entity = session.get(Entity, summary["entity_ids"][0])
        # Operator-supplied key + audit-trail key both present.
        assert entity.extra_data["envelope_id"] == "EP-200"
        assert "bulk_submission_id" in entity.extra_data
        # Same on phone.
        phone = session.get(PhoneNumber, summary["phone_ids"][0])
        assert phone.extra_data["source_cluster"] == "cluster-X"
        assert "bulk_submission_id" in phone.extra_data


# ===========================================================================
# Per-row format failures
# ===========================================================================


class TestFormatFailures:
    def test_unparseable_token_collected_as_per_row_failure(
        self, bulk, primary_target
    ):
        # "NOTAPHONE" has no digits; the normalizer drops every char and
        # yields an empty string, which lands in the "Empty after
        # normalization" bucket. The operator-facing point is the same
        # (row 2 failed and is identified by its raw input).
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550040, NOTAPHONE, +14155550041",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2
        assert "NOTAPHONE" in summary["failed_rows"][0]["input"]

    def test_short_digit_strings_accepted_under_digits_only_policy(
        self, bulk, primary_target
    ):
        # Product decision (UAT freeze): the only requirement is "digits
        # only". The previous 7..15 length window was removed because
        # operators ingest mixed formats (national short codes, E.164
        # long form). All three rows below survive — even the 5-digit
        # "12345" — because they normalize to pure digits.
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550042, 12345, +14155550043",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0

    def test_single_digit_after_plus_is_still_valid(self, bulk, primary_target):
        # "+1" normalizes to "+1" — under the digits-only policy this
        # passes (one digit is "digits only"). Pre-UAT this would have
        # failed the 7-digit minimum.
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+1, +14155550050",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0

    def test_empty_after_normalization(self, bulk, primary_target):
        # Pure punctuation that normalizes to empty string.
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="(--), +14155550060",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1


# ===========================================================================
# Deduplication within the batch
# ===========================================================================


class TestBatchDedup:
    def test_exact_duplicate_flagged_with_first_row_reference(
        self, bulk, primary_target
    ):
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550070, +14155550070",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2
        assert "row 1" in summary["failed_rows"][0]["error"]

    def test_dedup_after_normalization(self, bulk, primary_target):
        # Same number written two different ways — both normalize to the
        # same canonical form, so the second is a duplicate.
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+1-415-555-0080, +14155550080",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1


# ===========================================================================
# DB-level failures (UNIQUE constraint)
# ===========================================================================


class TestUniqueConstraintFailure:
    def test_duplicate_against_existing_db_row_handled_per_row(
        self, bulk, primary_target, session
    ):
        # Pre-seed an existing phone.
        existing_entity = Entity(entity_type="family", client_id=1)
        session.add(existing_entity)
        session.flush()
        existing_phone = PhoneNumber(
            entity_id=existing_entity.id,
            phone_number="+14155550090",
            ingestion_source="manual",
        )
        session.add(existing_phone)
        session.commit()

        # Now bulk-ingest, with one row that collides with the seeded number.
        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="+14155550091, +14155550090, +14155550092",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        # Two surviving inserts, one DB-level UNIQUE failure on row 2.
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2
        # Error message is operator-friendly (not raw SQL).
        assert (
            "exists" in summary["failed_rows"][0]["error"].lower()
            or "unique" in summary["failed_rows"][0]["error"].lower()
        )


# ===========================================================================
# Request-level errors (raise to endpoint as 422)
# ===========================================================================


class TestRequestErrors:
    def test_unknown_target_entity_id_raises(self, bulk):
        with pytest.raises(TargetNotFoundError):
            bulk.ingest_bulk_text(
                phone_numbers_raw="+14155550100",
                client_id=1,
                entity_type="family",
                target_entity_id=99999,    # does not exist
                ingestion_source="manual",
            )

    def test_zero_valid_candidates_returns_empty_summary_no_entity(
        self, bulk, primary_target, session
    ):
        """When every row fails format validation, no Entity should be
        created (orphan-avoidance)."""
        entities_before = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        n_before = len(entities_before)

        summary = bulk.ingest_bulk_text(
            phone_numbers_raw="abc, def, ghi",
            client_id=1,
            entity_type="family",
            target_entity_id=primary_target.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 3
        assert summary["entity_ids"] == []
        assert summary["phone_ids"] == []

        # NO new Entity created when zero rows survived.
        entities_after = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        assert len(entities_after) == n_before
