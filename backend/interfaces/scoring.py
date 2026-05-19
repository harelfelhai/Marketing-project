"""
interfaces/scoring.py — Abstract contract for Phase DY: Priority Scoring.

`BaseScoringStrategy.compute_priority(...)` is the single mathematical
seam between the open-source pipeline and a deployment's proprietary
business logic. The open-source mock ships a workable hybrid formula;
internal teams swap in their own strategy by setting `SCORING_MODULE`
in the environment.

ARCHITECTURAL ROLE
------------------
Phase DY introduces a stored, denormalised `priority_score` column on
`PhoneNumber`. The score is a pure function of three inputs:

    1. confidence_score  — float on the PhoneNumber itself.
    2. relation_type     — string from the owning Entity (entity_type).
                            Examples: 'self', 'spouse', 'family', 'friend',
                            'colleague', 'associate'. 'self' / None
                            indicates the entity IS the primary target.
    3. customer_tier     — integer pulled from the ROOT target Entity's
                            `extra_data['customer_tier']`. ScoringService
                            walks the `target_entity_id` chain up to the
                            root before extracting this value.

The strategy is intentionally stateless: it receives all three inputs
as arguments and returns a single float. Database I/O is the service
layer's responsibility (`services/scoring.py`).

PRIVACY BOUNDARY
----------------
The actual weight tables and formula coefficients are the secret. This
ABC + the mock module define the contract; the proprietary strategy
defines the numbers. The open-source repo never carries the production
weight matrix — it lives in the internal deployment's overridden module.

INTERNAL ENGINEER CHECKLIST
-----------------------------
To mount a proprietary scoring strategy:
    1. Create a module accessible on PYTHONPATH.
    2. Define `class ScoringStrategy(BaseScoringStrategy)`.
    3. Implement `compute_priority(...)` with your weights/formula.
    4. Set env var `SCORING_MODULE=your.module.path`.
    5. Restart the application — every score recalculation will use
       the new strategy, no other code change needed.
"""

from abc import ABC, abstractmethod
from typing import Optional


class BaseScoringStrategy(ABC):
    """
    Stateless strategy that maps (confidence, relation, tier) → priority.

    Called from `services/scoring.py::ScoringService.recalculate_for_phone`
    once per recalculation. Implementations MUST be deterministic and free
    of side effects (no DB writes, no external HTTP) so the service layer
    can call them inside transactions without coordination concerns.
    """

    @abstractmethod
    def compute_priority(
        self,
        confidence_score: float,
        relation_type: Optional[str],
        customer_tier: Optional[int],
    ) -> float:
        """
        Compute the final priority score for one PhoneNumber row.

        Args:
            confidence_score (float):
                Reliability of the number, 0.0 → 100.0 by convention.
                Already-validated by the caller — strategies receive a
                non-NULL value (the column defaults to the configured
                baseline on ingest, so NULL only appears for pre-DY rows
                that have not been touched since migration).

            relation_type (Optional[str]):
                Free-form relation token from the owning Entity's
                `entity_type` column. Examples: 'target', 'family',
                'friend', 'colleague'. 'target' indicates the entity is
                itself the primary (no parent hop). May be None on
                malformed/legacy data — strategies must apply a sensible
                fallback (typically `RELATION_WEIGHTS.get(rel, default)`).

            customer_tier (Optional[int]):
                Integer tier of the root target Entity's owning client,
                extracted by ScoringService from
                `root_entity.extra_data['customer_tier']`. None when the
                root entity carries no tier hint — apply a sensible
                fallback (typically the middle tier weight).

        Returns:
            float:
                The final priority score. Convention: in the same
                numerical range as `confidence_score` (0.0 → 100.0) so
                priority and confidence are visually comparable in the
                UI. Strategies that need a different scale may return
                values outside this range; the API layer treats the
                output as opaque.

        Examples:
            # Pure pass-through (degenerate strategy, useful for tests):
            def compute_priority(self, confidence, relation, tier):
                return confidence

            # Mock hybrid (see modules/mock_scoring.py):
            def compute_priority(self, confidence, relation, tier):
                rel_weight  = RELATION_WEIGHTS.get(relation, 0.5)
                tier_weight = TIER_WEIGHTS.get(tier,    0.5)
                return confidence * (0.6 * rel_weight + 0.4 * tier_weight)
        """
        pass
