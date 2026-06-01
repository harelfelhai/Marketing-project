"""
services/scoring.py — Phase DY: PhoneNumber priority recalculation.

Sole writer to the four scoring columns on PhoneNumber:
    - confidence_score          (when the caller passes a new value)
    - confidence_updated_at     (alongside confidence_score)
    - priority_score            (always, on every recalculate)
    - priority_updated_at       (always)

Read pipeline:
    1. Load the target PhoneNumber.
    2. Load its owning Entity.
    3. Walk `target_entity_id` chain UP to the root target entity
       (the one with `target_entity_id IS NULL`).
    4. Extract `customer_tier` from the root entity's `extra_data` JSON
       blob (the agreed JSON-pivot location — keeps tier server-side
       without denormalising it onto every entity row).
    5. Call the injected `BaseScoringStrategy` with
       (confidence_score, entity_type, customer_tier).
    6. Write `priority_score` + `priority_updated_at` back onto the phone.

Storage seam
------------
Reads + writes flow through repositories so the service runs identically
on SQL and MongoDB. The `commit=` argument on the public methods is kept
for backwards compatibility with callers but no longer governs atomicity —
each write is its own commit on either backend. The trade-off is documented
on the relevant callers (IngestionService).
"""

from typing import Optional

from exceptions import PhoneNumberNotFoundError
from interfaces.scoring import BaseScoringStrategy
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import utc_now
from repositories.storage import Storage


# Defensive depth limit when walking the target_entity_id chain. The
# current schema only nests one level (associated → primary), but the
# self-referencing FK is unbounded so an operator could conceivably
# introduce a cycle. Limit is intentionally generous — five hops is
# already deeper than any expected real graph.
_MAX_ROOT_TRAVERSAL_DEPTH: int = 5


class ScoringService:
    """
    Atomic recalculator for the Phase DY scoring block on PhoneNumber.

    Construction:
        ScoringService(storage=storage, strategy=injected_strategy)
    """

    def __init__(self, storage: Storage, strategy: BaseScoringStrategy) -> None:
        self.entities = storage.entities
        self.phones = storage.phones
        self.strategy = strategy

    # ======================================================================
    # PRIVATE — root-entity traversal
    # ======================================================================

    def _resolve_root_entity(self, entity: Entity) -> Entity:
        """
        Walk `target_entity_id` up to the root target entity (the one
        with `target_entity_id IS NULL`).

        If the input entity is already a root, returns it unchanged.
        Caps traversal at `_MAX_ROOT_TRAVERSAL_DEPTH` hops to defend
        against accidental cycles; breaks out and returns whichever
        entity we ended up on when the cap hits.
        """
        current = entity
        for _ in range(_MAX_ROOT_TRAVERSAL_DEPTH):
            if current.target_entity_id is None:
                return current
            parent = self.entities.get(current.target_entity_id)
            if parent is None:
                # Dangling FK — defensive break. Treat the current node
                # as the effective root.
                return current
            current = parent
        return current

    # ======================================================================
    # PUBLIC — recalculation entry points
    # ======================================================================

    def recalculate_for_phone(
        self,
        phone_id: str,
        commit: bool = True,
    ) -> PhoneNumber:
        """
        Recompute and write `priority_score` + `priority_updated_at` for
        one PhoneNumber.

        Args:
            phone_id (str):    PK of the row to recalculate.
            commit   (bool):   Kept for callsite compatibility. With the
                               repository seam each write is its own commit,
                               so this argument no longer affects atomicity.

        Returns:
            PhoneNumber: The phone row with the updated scoring block.

        Raises:
            PhoneNumberNotFoundError: phone_id does not exist.
        """
        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        entity = self.entities.get(phone.entity_id)
        # The owning entity is guaranteed to exist via FK at insert time,
        # but a defensive guard keeps the failure mode legible.
        if entity is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        root = self._resolve_root_entity(entity)
        customer_tier = self._extract_tier(root)

        # The relation feeding the formula is the IMMEDIATE entity's
        # entity_type — not the root's. Associated entities carry their
        # relation in their own row ('family', 'friend', etc.); root
        # entities carry 'target'.
        relation_type = entity.entity_type

        new_priority = self.strategy.compute_priority(
            confidence_score=phone.confidence_score,
            relation_type=relation_type,
            customer_tier=customer_tier,
        )

        phone.priority_score = float(new_priority)
        phone.priority_updated_at = utc_now()
        return self.phones.update(phone, commit=commit)

    def update_confidence_and_recalc(
        self,
        phone_id: str,
        new_confidence: float,
        commit: bool = True,
    ) -> PhoneNumber:
        """
        Write `confidence_score` + `confidence_updated_at`, then recompute
        `priority_score` + `priority_updated_at`.

        Used by:
            - PATCH /phones/{id} when the operator audits confidence.
            - Future automated reliability strategies that mutate
              confidence and need a deterministic priority refresh.

        Raises:
            PhoneNumberNotFoundError: phone_id does not exist.
        """
        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        now = utc_now()
        phone.confidence_score = float(new_confidence)
        phone.confidence_updated_at = now
        self.phones.update(phone, commit=False)
        return self.recalculate_for_phone(phone_id, commit=commit)

    # ======================================================================
    # PRIVATE — extra_data tier extraction
    # ======================================================================

    @staticmethod
    def _extract_tier(root_entity: Entity) -> Optional[int]:
        """
        Read `customer_tier` from a root entity's `extra_data` JSON
        blob. Returns None when the key is missing, the blob is None,
        or the value cannot be coerced to int.

        The scoring strategy applies `UNKNOWN_TIER_WEIGHT` for None, so
        a missing tier on the root entity degrades gracefully rather
        than raising.
        """
        extra = root_entity.extra_data or {}
        raw = extra.get("customer_tier")
        if raw is None:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None
