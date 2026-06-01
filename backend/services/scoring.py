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

The service NEVER mutates inputs (`confidence_score` is owned by the
operator + verification pathways), but it does expose
`update_confidence_and_recalc()` as a convenience for the PATCH endpoint
which writes both atomically.

TRANSACTION BOUNDARY
--------------------
Methods accept `commit=True/False`. When called from inside another
service's transaction (e.g. `VerificationService.update_verification_verdict`
or `IngestionService.ingest_circle_member`), pass `commit=False` and let
the outer service control the single commit boundary. This is the
edge-case-C fix from the design review: scoring and the triggering write
land atomically rather than as two separate transactions racing each
other.
"""

from typing import Optional

from sqlmodel import Session

from exceptions import PhoneNumberNotFoundError
from interfaces.scoring import BaseScoringStrategy
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import utc_now


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
        ScoringService(session=db_session, strategy=injected_strategy)
    """

    def __init__(self, session: Session, strategy: BaseScoringStrategy) -> None:
        self.session = session
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
        against accidental cycles (e.g. seed-data bugs); breaks out
        and returns whichever entity we ended up on when the cap hits.
        """
        current = entity
        for _ in range(_MAX_ROOT_TRAVERSAL_DEPTH):
            if current.target_entity_id is None:
                return current
            parent = self.session.get(Entity, current.target_entity_id)
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
            phone_id (int):    PK of the row to recalculate.
            commit   (bool):   True (default) — service commits and refreshes
                               the row itself; safe to call from a context
                               that does not own a transaction. False —
                               write happens in-session only; caller is
                               responsible for the final commit. Use False
                               when chaining inside another service's
                               write (verification, ingestion, PATCH).

        Returns:
            PhoneNumber: The phone row with the updated scoring block.

        Raises:
            PhoneNumberNotFoundError: phone_id does not exist.
        """
        phone = self.session.get(PhoneNumber, phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        entity = self.session.get(Entity, phone.entity_id)
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
        self.session.add(phone)

        if commit:
            self.session.commit()
            self.session.refresh(phone)
        return phone

    def update_confidence_and_recalc(
        self,
        phone_id: str,
        new_confidence: float,
        commit: bool = True,
    ) -> PhoneNumber:
        """
        Atomically: write `confidence_score` + `confidence_updated_at`,
        then recompute `priority_score` + `priority_updated_at`. All four
        fields land in a single commit when `commit=True`.

        Used by:
            - PATCH /phones/{id} when the operator audits confidence.
            - Future automated reliability strategies that mutate
              confidence and need a deterministic priority refresh.

        Args:
            phone_id        (int):   PK of the row to update.
            new_confidence  (float): Operator-supplied confidence value.
            commit          (bool):  See `recalculate_for_phone`.

        Returns:
            PhoneNumber: The updated phone row.

        Raises:
            PhoneNumberNotFoundError: phone_id does not exist.
        """
        phone = self.session.get(PhoneNumber, phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        now = utc_now()
        phone.confidence_score = float(new_confidence)
        phone.confidence_updated_at = now
        self.session.add(phone)
        # Recompute priority in the same session — pass commit=False so
        # both writes land in one transaction. The outer flag controls
        # whether THIS method commits at the end.
        self.recalculate_for_phone(phone_id, commit=False)

        if commit:
            self.session.commit()
            self.session.refresh(phone)
        return phone

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
