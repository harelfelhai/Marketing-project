"""
modules/mock_scoring.py — Open-source default ScoringStrategy.

Implements the hybrid (gate + boost) formula agreed for Phase DY:

    priority = confidence_score × ( α × relation_weight + β × tier_weight )

`confidence_score` acts as a multiplicative gate (a low-confidence number
is suppressed regardless of tier/relation); `relation_weight` and
`tier_weight` additively boost trusted numbers via a tunable α/β split.

The weight tables and α/β coefficients are deliberately generic.
Internal teams ship their own `ScoringStrategy` via the `SCORING_MODULE`
env var with their proprietary weight matrix.
"""

from typing import Optional

from interfaces.scoring import BaseScoringStrategy


# ----------------------------------------------------------------------
# Tunable coefficients
# ----------------------------------------------------------------------
# α + β = 1.0. Heuristic: relation matters more than tier on the open
# repo because tier is a coarse client-level signal while relation is
# row-specific. Internal teams may rebalance.

ALPHA_RELATION: float = 0.6
BETA_TIER:      float = 0.4


# ----------------------------------------------------------------------
# Weight lookup tables
# ----------------------------------------------------------------------
# Generic vocabulary. Unknown values fall back to the configured default
# (`UNKNOWN_*_WEIGHT`) rather than raising — the scoring path must be
# robust to data-quality drift in the entity_type / customer_tier inputs.

RELATION_WEIGHTS: dict[str, float] = {
    "target":     1.0,   # The entity IS the primary subject — full weight.
    "self":       1.0,   # Synonym for 'target' in some vocabularies.
    "spouse":     0.9,
    "family":     0.7,
    "friend":     0.5,
    "colleague":  0.4,
    "associate":  0.3,
    "employee":   0.3,
}
UNKNOWN_RELATION_WEIGHT: float = 0.5
"""
Median value — applied when entity_type is None or unrecognised.
Chosen as the midpoint between the most and least authoritative known
relations so unknown rows neither dominate nor disappear.
"""

TIER_WEIGHTS: dict[int, float] = {
    1: 1.0,
    2: 0.7,
    3: 0.4,
}
UNKNOWN_TIER_WEIGHT: float = 0.5
"""
Applied when the root entity has no `customer_tier` key in its
`extra_data`, or the tier value is None / not in the lookup table.
"""


class ScoringStrategy(BaseScoringStrategy):
    """
    Hybrid (gate + boost) priority strategy.

    Stateless — the lookup tables are module-level constants, so a
    single instance can serve many concurrent calls safely.
    """

    def compute_priority(
        self,
        confidence_score: float,
        relation_type: Optional[str],
        customer_tier: Optional[int],
    ) -> float:
        rel_weight  = RELATION_WEIGHTS.get(relation_type, UNKNOWN_RELATION_WEIGHT) \
            if relation_type is not None else UNKNOWN_RELATION_WEIGHT
        tier_weight = TIER_WEIGHTS.get(customer_tier, UNKNOWN_TIER_WEIGHT) \
            if customer_tier is not None else UNKNOWN_TIER_WEIGHT

        boost = (ALPHA_RELATION * rel_weight) + (BETA_TIER * tier_weight)
        return float(confidence_score) * boost
