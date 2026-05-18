"""
Phase DY — Unit tests for the mock ScoringStrategy formula.

The formula is:
    priority = confidence × (α × relation_weight + β × tier_weight)
with α=0.6, β=0.4, the lookup tables in modules/mock_scoring.py.

These tests pin the contract so the open-source mock cannot drift
silently. Internal proprietary strategies are tested by their owning
teams against their own constants — this file only covers the mock.
"""

import math

import pytest

from interfaces.scoring import BaseScoringStrategy
from modules.mock_scoring import (
    ALPHA_RELATION,
    BETA_TIER,
    RELATION_WEIGHTS,
    ScoringStrategy,
    TIER_WEIGHTS,
    UNKNOWN_RELATION_WEIGHT,
    UNKNOWN_TIER_WEIGHT,
)


# ---------------------------------------------------------------------------
# Sanity / construction
# ---------------------------------------------------------------------------


class TestStrategyConstruction:
    def test_implements_base_contract(self):
        s = ScoringStrategy()
        assert isinstance(s, BaseScoringStrategy)

    def test_coefficients_sum_to_one(self):
        # Documented invariant — keeps the boost bounded by max
        # (relation_weight, tier_weight) when both weights are 1.0.
        assert math.isclose(ALPHA_RELATION + BETA_TIER, 1.0)


# ---------------------------------------------------------------------------
# Known-input formula values
# ---------------------------------------------------------------------------


class TestHybridFormula:
    @pytest.fixture()
    def s(self):
        return ScoringStrategy()

    def test_full_authority_input(self, s):
        # target + tier 1 + confidence 100 = max possible score.
        result = s.compute_priority(100.0, "target", 1)
        expected = 100.0 * (0.6 * 1.0 + 0.4 * 1.0)
        assert math.isclose(result, expected)
        assert math.isclose(result, 100.0)

    def test_zero_confidence_kills_score(self, s):
        # Hybrid model gate: confidence 0 → priority 0 regardless of
        # how strong the relation and tier are.
        assert s.compute_priority(0.0, "target", 1) == 0.0
        assert s.compute_priority(0.0, "spouse", 1) == 0.0

    def test_family_tier2_midrange(self, s):
        # confidence=80, relation='family' (0.7), tier=2 (0.7)
        # = 80 × (0.6×0.7 + 0.4×0.7) = 80 × 0.7 = 56.0
        result = s.compute_priority(80.0, "family", 2)
        assert math.isclose(result, 56.0)

    def test_associate_tier3_low(self, s):
        # confidence=50, relation='associate' (0.3), tier=3 (0.4)
        # = 50 × (0.6×0.3 + 0.4×0.4) = 50 × (0.18+0.16) = 50 × 0.34 = 17.0
        result = s.compute_priority(50.0, "associate", 3)
        assert math.isclose(result, 17.0)


# ---------------------------------------------------------------------------
# Fallbacks for unknown / missing inputs
# ---------------------------------------------------------------------------


class TestFallbacks:
    @pytest.fixture()
    def s(self):
        return ScoringStrategy()

    def test_unknown_relation_uses_default_weight(self, s):
        # An unrecognised entity_type ('vendor') should not crash — falls
        # back to UNKNOWN_RELATION_WEIGHT.
        result = s.compute_priority(100.0, "vendor", 1)
        expected = 100.0 * (ALPHA_RELATION * UNKNOWN_RELATION_WEIGHT
                            + BETA_TIER * TIER_WEIGHTS[1])
        assert math.isclose(result, expected)

    def test_none_relation_uses_default_weight(self, s):
        result = s.compute_priority(100.0, None, 1)
        expected = 100.0 * (ALPHA_RELATION * UNKNOWN_RELATION_WEIGHT
                            + BETA_TIER * TIER_WEIGHTS[1])
        assert math.isclose(result, expected)

    def test_unknown_tier_uses_default_weight(self, s):
        result = s.compute_priority(100.0, "target", 99)
        expected = 100.0 * (ALPHA_RELATION * RELATION_WEIGHTS["target"]
                            + BETA_TIER * UNKNOWN_TIER_WEIGHT)
        assert math.isclose(result, expected)

    def test_none_tier_uses_default_weight(self, s):
        result = s.compute_priority(100.0, "target", None)
        expected = 100.0 * (ALPHA_RELATION * RELATION_WEIGHTS["target"]
                            + BETA_TIER * UNKNOWN_TIER_WEIGHT)
        assert math.isclose(result, expected)

    def test_both_unknown(self, s):
        # Worst case for unknown inputs — both fall back. Should still
        # produce a finite, non-negative float (not crash).
        result = s.compute_priority(50.0, "mystery", None)
        assert math.isfinite(result)
        assert result >= 0.0


# ---------------------------------------------------------------------------
# Output range / type sanity
# ---------------------------------------------------------------------------


class TestOutputShape:
    @pytest.fixture()
    def s(self):
        return ScoringStrategy()

    def test_returns_float(self, s):
        result = s.compute_priority(50, "family", 2)
        assert isinstance(result, float)

    def test_handles_integer_confidence(self, s):
        # Some seed paths pass int confidence — must not raise.
        result = s.compute_priority(75, "target", 1)
        assert isinstance(result, float)

    @pytest.mark.parametrize("confidence", [25.0, 50.0, 75.0, 100.0])
    def test_monotonic_in_confidence(self, s, confidence):
        # Holding relation + tier constant, priority strictly tracks
        # confidence (multiplicative gate property).
        base = s.compute_priority(1.0, "friend", 2)
        result = s.compute_priority(confidence, "friend", 2)
        assert math.isclose(result, base * confidence)
