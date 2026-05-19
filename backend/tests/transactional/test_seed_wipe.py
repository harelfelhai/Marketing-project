"""
Transactional integrity tests for the seed script's wipe routine.

Regression coverage for the bug surfaced during DX manual smoke testing:

    sqlite3.IntegrityError: FOREIGN KEY constraint failed
    [SQL: DELETE FROM entity WHERE entity.id = ?]

Cause: without `relationship()` declarations on the SQLModel models,
SQLAlchemy's unit-of-work cannot infer the FK dependency graph at commit
time and may reorder DELETE statements alphabetically. The first wipe
worked because the new pipeline_task table was empty; the second --reset
hit the reorder and crashed because phones were being flushed after their
owning entities.

Fix (committed in 3ce5bc0): session.flush() after each table's batch so
SQL hits the DB in declared order. These tests assert that:

    1. A single wipe over a fully-populated DB succeeds.
    2. Two consecutive wipes interleaved with full re-seeds both succeed
       (this is the exact regression case from the smoke test).
    3. The wipe is idempotent against an empty DB.
    4. The wipe leaves zero rows in every table.
"""

from datetime import datetime, timezone

import pytest
from sqlmodel import select

from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from scripts.seed_db import _wipe


# ---------------------------------------------------------------------------
# Local fixture — a minimal full-graph dataset that exercises every FK on
# every table the wipe touches. Kept here rather than promoted to conftest
# because no other test needs the four-way relational web.
# ---------------------------------------------------------------------------

@pytest.fixture()
def populated_db(session):
    """
    Inserts a minimal but FK-complete dataset:
      - 1 primary entity
      - 1 associated entity (target_entity_id → primary)
      - 1 phone per entity
      - 1 action_log on the primary's phone
      - 1 pipeline_task pointing at both the phone AND the action_log
    """
    primary = Entity(entity_type="target", client_id=1, relation_type="primary")
    session.add(primary)
    session.flush()

    associated = Entity(
        entity_type="family",
        client_id=1,
        relation_type="associated",
        target_entity_id=primary.id,
    )
    session.add(associated)
    session.flush()

    primary_phone = PhoneNumber(
        entity_id=primary.id,
        phone_number="+15550000010",
        ingestion_source="manual",
    )
    associated_phone = PhoneNumber(
        entity_id=associated.id,
        phone_number="+15550000011",
        ingestion_source="manual",
    )
    session.add_all([primary_phone, associated_phone])
    session.flush()

    log = ActionLog(
        phone_id=primary_phone.id,
        action_type="action_type_a",
        status="failed",
    )
    session.add(log)
    session.flush()

    task = PipelineTask(
        phone_id=primary_phone.id,
        source_action_log_id=log.id,
        task_type="remediation_failure",
        status="pending",
        requested_by="automation:retry_engine",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(task)
    session.commit()

    return {
        "primary":           primary,
        "associated":        associated,
        "primary_phone":     primary_phone,
        "associated_phone":  associated_phone,
        "log":               log,
        "task":              task,
    }


def _count_rows(session):
    return {
        "entity":        len(session.exec(select(Entity)).all()),
        "phone_number":  len(session.exec(select(PhoneNumber)).all()),
        "action_log":    len(session.exec(select(ActionLog)).all()),
        "pipeline_task": len(session.exec(select(PipelineTask)).all()),
    }


def _reseed(session, populated_db_factory):
    """Build a fresh four-table dataset on the given session."""
    primary = Entity(entity_type="target", client_id=2, relation_type="primary")
    session.add(primary)
    session.flush()
    phone = PhoneNumber(
        entity_id=primary.id,
        phone_number="+15550000020",
        ingestion_source="manual",
    )
    session.add(phone)
    session.flush()
    log = ActionLog(
        phone_id=phone.id,
        action_type="action_type_b",
        status="sent",
    )
    session.add(log)
    session.flush()
    task = PipelineTask(
        phone_id=phone.id,
        source_action_log_id=log.id,
        task_type="approval_required",
        status="pending",
        requested_by="mock_operator_02",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(task)
    session.commit()


# ===========================================================================
# Tests
# ===========================================================================


class TestSeedWipe:
    def test_single_wipe_clears_all_four_tables(self, session, populated_db):
        """Baseline — one wipe call over a fully-populated DB succeeds and
        leaves zero rows in every table that has FK relationships."""
        # Sanity: data exists before wipe.
        before = _count_rows(session)
        assert before["entity"]        >= 2
        assert before["phone_number"]  >= 2
        assert before["action_log"]    >= 1
        assert before["pipeline_task"] >= 1

        _wipe(session)

        after = _count_rows(session)
        assert after == {
            "entity":        0,
            "phone_number":  0,
            "action_log":    0,
            "pipeline_task": 0,
        }

    def test_wipe_then_repopulate_then_wipe_again_succeeds(self, session, populated_db):
        """
        REGRESSION — the exact smoke-test failure mode:
            seed --reset  (first wipe + insert)  → succeeds
            seed --reset  (second wipe + insert) → IntegrityError on entity DELETE

        Pre-fix this raised sqlite3.IntegrityError on the second wipe because
        SQLAlchemy reordered DELETEs and tried entity before phone_number.
        Post-fix (session.flush() between batches), both wipes succeed.
        """
        # First wipe — over populated_db's fixture data.
        _wipe(session)
        assert _count_rows(session)["entity"] == 0

        # Re-seed with a fresh four-table dataset (mimics seed_db.py's insert).
        _reseed(session, populated_db)
        repopulated = _count_rows(session)
        assert repopulated["entity"]        >= 1
        assert repopulated["phone_number"]  >= 1
        assert repopulated["action_log"]    >= 1
        assert repopulated["pipeline_task"] >= 1

        # Second wipe — this is the call that crashed pre-fix.
        _wipe(session)

        # All four tables empty again.
        assert _count_rows(session) == {
            "entity":        0,
            "phone_number":  0,
            "action_log":    0,
            "pipeline_task": 0,
        }

    def test_wipe_on_empty_db_is_idempotent(self, session):
        """Wiping an already-empty DB must succeed silently (no FK errors,
        no exceptions). This is the "fresh app.db just after create_all"
        case that runs on every dev's first seed."""
        _wipe(session)
        _wipe(session)  # twice in a row — still fine.
        assert _count_rows(session) == {
            "entity":        0,
            "phone_number":  0,
            "action_log":    0,
            "pipeline_task": 0,
        }

    def test_wipe_preserves_no_orphans_after_cross_table_fk(self, session, populated_db):
        """
        The pipeline_task in `populated_db` references BOTH phone_number AND
        action_log via FKs. After the wipe, neither parent row may remain —
        otherwise the wipe ordering would have skipped pipeline_task and
        left a half-deleted graph.
        """
        _wipe(session)

        # Verify FK targets are gone (no orphans waiting to be cleaned up).
        assert session.exec(select(PipelineTask)).all() == []
        assert session.exec(select(ActionLog)).all()    == []
        assert session.exec(select(PhoneNumber)).all()  == []
        assert session.exec(select(Entity)).all()       == []
