"""
Service-layer tests for ScoringService (Phase DY).

The service has one job: given a phone_id, walk to the root target
entity, extract `customer_tier` from `extra_data`, call the injected
strategy, and write `priority_score` + `priority_updated_at`.

These tests focus on the database-state contract — formula math is
covered separately in tests/unit/test_scoring_formula.py.
"""

import math
from datetime import datetime, timezone

import pytest

from exceptions import PhoneNumberNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from modules.mock_scoring import ScoringStrategy
from services.scoring import ScoringService


# ---------------------------------------------------------------------------
# Local fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def scoring(session):
    """ScoringService wired with the open-source mock strategy."""
    return ScoringService(session=session, strategy=ScoringStrategy())


@pytest.fixture()
def root_with_tier(session):
    """A root target entity carrying customer_tier=1 in its extra_data."""
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=1,
        extra_data={"customer_tier": 1, "segment": "x"},
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@pytest.fixture()
def primary_phone(session, root_with_tier):
    p = PhoneNumber(
        entity_id=root_with_tier.id,
        phone_number="+15550000100",
        ingestion_source="manual",
        confidence_score=80.0,  # explicit, ignoring column default
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@pytest.fixture()
def associated_phone(session, root_with_tier):
    """A phone owned by an 'associated' entity pointing at root_with_tier."""
    assoc = Entity(
        entity_type="family",
        relation_type="associated",
        target_entity_id=root_with_tier.id,
        client_id=1,
    )
    session.add(assoc)
    session.flush()
    p = PhoneNumber(
        entity_id=assoc.id,
        phone_number="+15550000200",
        ingestion_source="manual",
        confidence_score=80.0,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


# ===========================================================================
# Happy paths
# ===========================================================================


class TestRecalculateForPhone:
    def test_writes_priority_score_and_timestamp(self, scoring, primary_phone, session):
        result = scoring.recalculate_for_phone(primary_phone.id)
        # confidence=80, relation='target' (1.0), tier=1 (1.0)
        # → 80 × (0.6×1.0 + 0.4×1.0) = 80.0
        assert math.isclose(result.priority_score, 80.0)
        assert result.priority_updated_at is not None
        assert result.priority_updated_at.tzinfo is not None  # tz-aware

    def test_idempotent_for_same_inputs(self, scoring, primary_phone):
        first = scoring.recalculate_for_phone(primary_phone.id).priority_score
        second = scoring.recalculate_for_phone(primary_phone.id).priority_score
        assert math.isclose(first, second)

    def test_associated_phone_uses_immediate_entity_type_as_relation(
        self, scoring, associated_phone
    ):
        # Associated entity_type='family' (0.7), tier comes from ROOT (1.0).
        # confidence=80 → 80 × (0.6×0.7 + 0.4×1.0) = 80 × 0.82 = 65.6
        result = scoring.recalculate_for_phone(associated_phone.id)
        assert math.isclose(result.priority_score, 65.6)


# ===========================================================================
# Root-entity traversal
# ===========================================================================


class TestRootTraversal:
    def test_traverses_one_hop_to_extract_tier(self, scoring, associated_phone, session):
        # The phone's immediate entity is 'associated' with no customer_tier
        # of its own — service must walk to the root to find tier=1.
        result = scoring.recalculate_for_phone(associated_phone.id)
        # If traversal had failed, tier would default to 0.5 and the score
        # would be 80 × (0.6×0.7 + 0.4×0.5) = 80 × 0.62 = 49.6.
        # Verify we got the tier=1 number instead (65.6).
        assert math.isclose(result.priority_score, 65.6)

    def test_root_with_missing_tier_uses_fallback(self, scoring, session):
        # Root entity has no customer_tier key at all.
        root = Entity(entity_type="target", relation_type="primary", extra_data={})
        session.add(root)
        session.flush()
        p = PhoneNumber(entity_id=root.id, phone_number="+15550000300",
                        ingestion_source="manual", confidence_score=100.0)
        session.add(p); session.commit(); session.refresh(p)

        result = scoring.recalculate_for_phone(p.id)
        # confidence=100, relation='target'=1.0, tier=None→0.5
        # → 100 × (0.6×1.0 + 0.4×0.5) = 100 × 0.8 = 80.0
        assert math.isclose(result.priority_score, 80.0)

    def test_root_with_null_extra_data_is_safe(self, scoring, session):
        root = Entity(entity_type="target", relation_type="primary", extra_data=None)
        session.add(root)
        session.flush()
        p = PhoneNumber(entity_id=root.id, phone_number="+15550000400",
                        ingestion_source="manual", confidence_score=50.0)
        session.add(p); session.commit(); session.refresh(p)

        # Must not raise.
        result = scoring.recalculate_for_phone(p.id)
        assert math.isfinite(result.priority_score)

    def test_root_with_malformed_tier_value_is_safe(self, scoring, session):
        # extra_data['customer_tier'] is not an integer — service should
        # ignore it and fall back to the unknown-tier weight, not crash.
        root = Entity(entity_type="target", relation_type="primary",
                      extra_data={"customer_tier": "not-an-int"})
        session.add(root)
        session.flush()
        p = PhoneNumber(entity_id=root.id, phone_number="+15550000500",
                        ingestion_source="manual", confidence_score=50.0)
        session.add(p); session.commit(); session.refresh(p)
        result = scoring.recalculate_for_phone(p.id)
        # Falls back to UNKNOWN_TIER_WEIGHT (0.5).
        # 50 × (0.6×1.0 + 0.4×0.5) = 50 × 0.8 = 40.0
        assert math.isclose(result.priority_score, 40.0)


# ===========================================================================
# Error paths
# ===========================================================================


class TestRecalculateErrors:
    def test_unknown_phone_id_raises(self, scoring):
        with pytest.raises(PhoneNumberNotFoundError):
            scoring.recalculate_for_phone(99999)


# ===========================================================================
# Transaction boundary — commit flag
# ===========================================================================


class TestCommitFlag:
    def test_commit_true_persists_and_refreshes(self, scoring, primary_phone, session):
        result = scoring.recalculate_for_phone(primary_phone.id, commit=True)
        # Round-trip through a fresh session view — the change MUST be
        # visible after closing the session's identity map.
        session.expire_all()
        reloaded = session.get(PhoneNumber, primary_phone.id)
        assert math.isclose(reloaded.priority_score, result.priority_score)

    def test_commit_false_leaves_pending_in_session(self, scoring, primary_phone, session):
        result = scoring.recalculate_for_phone(primary_phone.id, commit=False)
        # In-memory state has changed.
        assert math.isclose(result.priority_score, 80.0)
        # But the row in storage is still at the column default of 0.0.
        # Use raw SQL to bypass the session's identity map.
        from sqlalchemy import text
        raw_value = session.execute(
            text("SELECT priority_score FROM phone_number WHERE id = :id"),
            {"id": primary_phone.id},
        ).scalar_one()
        assert raw_value == 0.0
        # Caller commits and the value persists.
        session.commit()
        raw_value_after = session.execute(
            text("SELECT priority_score FROM phone_number WHERE id = :id"),
            {"id": primary_phone.id},
        ).scalar_one()
        assert math.isclose(raw_value_after, 80.0)


# ===========================================================================
# update_confidence_and_recalc — atomic confidence + priority write
# ===========================================================================


class TestUpdateConfidenceAndRecalc:
    def test_writes_all_four_fields_atomically(self, scoring, primary_phone, session):
        result = scoring.update_confidence_and_recalc(
            phone_id=primary_phone.id,
            new_confidence=95.0,
        )
        assert math.isclose(result.confidence_score, 95.0)
        assert result.confidence_updated_at is not None
        assert result.confidence_updated_at.tzinfo is not None
        # Priority reflects the NEW confidence.
        # 95 × (0.6×1.0 + 0.4×1.0) = 95.0
        assert math.isclose(result.priority_score, 95.0)
        assert result.priority_updated_at is not None

    def test_unknown_phone_id_raises(self, scoring):
        with pytest.raises(PhoneNumberNotFoundError):
            scoring.update_confidence_and_recalc(99999, 60.0)


# ===========================================================================
# tz-aware timestamps end-to-end
# ===========================================================================


class TestTimestampsAreTzAware:
    def test_priority_updated_at_carries_utc_tzinfo(self, scoring, primary_phone):
        result = scoring.recalculate_for_phone(primary_phone.id)
        ts = result.priority_updated_at
        assert ts.tzinfo is not None
        # Offset is zero (UTC) regardless of backend storage shape.
        assert ts.utcoffset().total_seconds() == 0

    def test_confidence_updated_at_carries_utc_tzinfo(self, scoring, primary_phone):
        result = scoring.update_confidence_and_recalc(primary_phone.id, 70.0)
        ts = result.confidence_updated_at
        assert ts.tzinfo is not None
        assert ts.utcoffset().total_seconds() == 0
