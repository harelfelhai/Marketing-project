"""
services/verification.py — Phase 3: Verification & Quality Audit services.

Contains two classes:

    VerificationService  — atomic DB writer for verification verdicts
    VerificationEngine   — background scheduler that selects eligible numbers
                           and drives them through the verification strategy

The quality evaluation ALGORITHM is deliberately NOT here — it lives in the
injected `BaseVerificationStrategy` implementation (see `interfaces/verification.py`).
This module only manages WHEN to evaluate and HOW to persist the result.
"""

from datetime import timedelta, timezone
from typing import Optional, TYPE_CHECKING

from exceptions import PhoneNumberNotFoundError
from interfaces.verification import BaseVerificationStrategy
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import utc_now
from repositories.storage import Storage

# Forward-only typing import. The ScoringService is optional at the
# VerificationService construction boundary (tests + legacy call sites
# may omit it), and a hard import here would create a circular reference
# via dependencies.py.
if TYPE_CHECKING:
    from services.scoring import ScoringService


class VerificationService:
    """
    Atomic database writer for Phase 3 (Verification) field updates.

    This service is the SOLE writer to the Phase 3 block on the
    `PhoneNumber` table:
        - `verification_status`
        - `verification_source`
        - `verification_reason`
        - `verified_at`
        - `extra_data` (merged with existing contents)

    Called by:
        - `VerificationEngine.process_eligible_numbers()` (automated path)
        - A future router endpoint for operator manual verdicts (manual path)

    By funnelling all Phase 3 writes through one class, the system
    guarantees that the Phase 3 block is always updated atomically and
    consistently, regardless of whether the trigger was automated or manual.
    """

    def __init__(
        self,
        storage: Storage,
        scoring_service: Optional["ScoringService"] = None,
    ) -> None:
        """
        Args:
            storage         (Storage):                  Repository bundle.
            scoring_service (Optional[ScoringService]): Phase DY scoring
                hook. When provided, every successful verdict triggers a
                priority recalculation right after the verdict write.
                When None, scoring is skipped.
        """
        self.phones = storage.phones
        self.entities = storage.entities
        self.scoring_service = scoring_service

    def update_verification_verdict(
        self,
        phone_id: str,
        status: str,
        source: str,
        reason: str,
        extra_metadata: Optional[dict] = None,
    ) -> PhoneNumber:
        """
        Write a verification verdict to the Phase 3 block of a PhoneNumber row.

        This method updates `verification_status`, `verification_source`,
        `verification_reason`, and `verified_at` atomically. If `extra_metadata`
        is provided, it is MERGED into the existing `PhoneNumber.extra_data`
        dict (not replaced), preserving any Phase 1 ingestion metadata that
        was already stored there.

        INTERNAL HOOK:
            If the internal verification strategy produces rich structured
            metadata (e.g. scoring breakdowns, carrier lookup results), pass
            it via `extra_metadata`. It will be merged under the existing
            `extra_data` keys. Avoid key collisions with Phase 1 metadata
            by using a namespaced key (e.g. `{"verification": {...}}`).

        Args:
            phone_id       (int):            PK of the PhoneNumber row to update.
            status         (str):            The quality verdict to write.
                                              Written to `verification_status`.
                                              Example values: "verified_good", "verified_bad".
            source         (str):            Who produced the verdict.
                                              Written to `verification_source`.
                                              Example values: "manual", "automated".
            reason         (str):            Human-readable justification.
                                              Written to `verification_reason`.
            extra_metadata (Optional[dict]): Structured metadata from the verification
                                              strategy. Merged into `PhoneNumber.extra_data`.
                                              Default: None (no extra_data mutation).

        Returns:
            PhoneNumber: The updated, committed `PhoneNumber` ORM object with
                         the Phase 3 block fully populated.

        Raises:
            PhoneNumberNotFoundError: If `phone_id` does not exist in the DB.
        """
        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        # Write the Phase 3 block fields. utc_now() returns a tz-aware
        # value compatible with the migrated UTCDateTime column.
        phone.verification_status = status
        phone.verification_source = source
        phone.verification_reason = reason
        phone.verified_at = utc_now()

        # Merge extra_metadata into existing extra_data (non-destructive).
        if extra_metadata:
            merged = dict(phone.extra_data or {})
            merged.update(extra_metadata)
            phone.extra_data = merged

        phone = self.phones.update(phone)

        # Phase DY scoring hook — recalc priority right after the verdict.
        if self.scoring_service is not None:
            self.scoring_service.recalculate_for_phone(phone_id)
            phone = self.phones.get(phone_id)
        return phone

    # ======================================================================
    # Phase DY-4 — Two-axis verdict + envelope identification
    # ======================================================================

    def apply_two_axis_verdict(
        self,
        phone_id: str,
        phone_axis: Optional[str]      = None,   # 'confirm' | 'refute' | None
        relation_axis: Optional[str]   = None,   # 'confirm' | 'refute' | None
        identification: Optional[dict] = None,   # {first_name, last_name, relation}
        resolution_note: Optional[str] = None,
        extra_metadata: Optional[dict] = None,
    ) -> PhoneNumber:
        """
        Apply Phase DY-4 two-axis operator feedback in a single transaction.

        Each parameter is independent — operators can submit feedback on
        one axis only, both axes, only the identification block, or any
        combination. At least one of the three must be provided; an empty
        call raises ValueError (caller's responsibility to enforce 422).

        Axis writes — Vector A (named entity):
            phone_axis='confirm'    → confidence_score = 100
            phone_axis='refute'     → confidence_score = 0
            relation_axis='confirm' → verification_status='verified_good'
            relation_axis='refute'  → verification_status='verified_bad' +
                                       target_entity_id severed

        Axis writes — Vector B (social_envelope) — DY-4-D propagation:
            For envelopes, the two axes COLLAPSE because the entity is just
            a placeholder for "whoever owns this phone in the network".
            Confirming phone-in-network is therefore also confirming
            person-to-target. The service applies these implications
            automatically:

            phone_axis='confirm' on envelope:
                → confidence_score = 100
                → verification_status='verified_good' (propagated)
            phone_axis='refute' on envelope:
                → confidence_score = 0
                → verification_status='verified_bad' (propagated)
                → target_entity_id severed (the entire envelope assertion
                  is refuted, not just the line)

        Identification block (envelope-only) — DY-4-D propagation:
            relation in {spouse, family, friend, …} (any non-'unrelated'):
                → entity_type = relation
                → verification_status='verified_good' (operator stated
                  the relation, which is the person-to-target axis)
            relation = 'unrelated':
                → entity_type = 'unrelated'
                → verification_status='verified_bad'
                → target_entity_id severed
            relation omitted (partial identify):
                → entity_type = 'identified_envelope'
                → IF confidence_score is already high (≥ 80, meaning
                  phone-in-network was previously OR concurrently
                  confirmed), verification_status='verified_good' is
                  propagated — the previously-verified envelope status
                  carries onto the now-named owner.
                → ELSE verification_status stays at its current value
                  (operator named someone but never audited the envelope).
            Names are merged into entity.extra_data {first_name, last_name}
            keys (Secrets-Free Mandate — structural columns stay generic).

        Scoring is recalculated INSIDE the same transaction so all writes
        + the priority refresh land atomically.

        Returns:
            PhoneNumber: The updated phone row, fully refreshed.

        Raises:
            PhoneNumberNotFoundError: phone_id does not exist.
            ValueError: empty submission (no axis and no identification).
        """
        if phone_axis is None and relation_axis is None and not identification:
            raise ValueError(
                "apply_two_axis_verdict requires at least one of: "
                "phone_axis, relation_axis, identification."
            )

        phone = self.phones.get(phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        # Cache the owning entity once — we may need it for envelope
        # propagation, relation severance, and identification promotion.
        # `is_envelope_at_start` captures the state BEFORE this submission
        # mutates entity_type, so phone_axis propagation triggers correctly
        # even when the same submission also identifies the owner.
        entity = self.entities.get(phone.entity_id)
        is_envelope_at_start = (
            entity is not None and entity.entity_type == "social_envelope"
        )
        entity_dirty = False

        now = utc_now()

        # ---- Phone axis (with envelope-aware propagation) ----
        if phone_axis == "confirm":
            phone.confidence_score = 100.0
            phone.confidence_updated_at = now
            if is_envelope_at_start:
                # DY-4-D: phone-in-network = person-to-target for envelopes.
                phone.verification_status = "verified_good"
                phone.verification_source = "manual"
                phone.verification_reason = (
                    resolution_note or "Operator confirmed phone is in target network"
                )
                phone.verified_at = now
        elif phone_axis == "refute":
            phone.confidence_score = 0.0
            phone.confidence_updated_at = now
            if is_envelope_at_start:
                # DY-4-D: refuting envelope placement = refuting the whole
                # assertion, including the implied relation-to-target.
                phone.verification_status = "verified_bad"
                phone.verification_source = "manual"
                phone.verification_reason = (
                    resolution_note or "Operator rejected envelope placement"
                )
                phone.verified_at = now
                if entity is not None:
                    entity.target_entity_id = None
                    entity_dirty = True

        # ---- Relation axis (Vector A only; UI hides this for envelopes) ----
        if relation_axis == "confirm":
            phone.verification_status = "verified_good"
            phone.verification_source = "manual"
            phone.verification_reason = resolution_note or "Operator confirmed relation"
            phone.verified_at = now
        elif relation_axis == "refute":
            phone.verification_status = "verified_bad"
            phone.verification_source = "manual"
            phone.verification_reason = resolution_note or "Operator severed relation"
            phone.verified_at = now
            if entity is not None:
                entity.target_entity_id = None
                entity_dirty = True

        # ---- Identification (envelope → named / identified_envelope) ----
        if identification and is_envelope_at_start and entity is not None:
            ident_relation = identification.get("relation")

            if ident_relation == "unrelated":
                # Failure Type I via identify: name the owner AND mark
                # unrelated. Matches relation_axis=refute semantics.
                entity.entity_type = "unrelated"
                phone.verification_status = "verified_bad"
                phone.verification_source = "manual"
                phone.verification_reason = (
                    resolution_note or "Operator identified owner as unrelated"
                )
                phone.verified_at = now
                entity.target_entity_id = None
            elif ident_relation:
                # Full identification — operator stated the relation, which
                # is the person-to-target axis. DY-4-D: also verified_good.
                entity.entity_type = ident_relation
                phone.verification_status = "verified_good"
                phone.verification_source = "manual"
                phone.verification_reason = (
                    resolution_note
                    or f"Operator identified owner with relation '{ident_relation}'"
                )
                phone.verified_at = now
            else:
                # Partial identify — name only, no relation.
                entity.entity_type = "identified_envelope"
                # DY-4-D: propagate verified_good IF the envelope's phone-
                # in-network was previously OR concurrently confirmed. The
                # confidence_score check uses the value AFTER this submit's
                # phone_axis writes.
                current_conf = phone.confidence_score
                if current_conf is not None and current_conf >= 80.0:
                    phone.verification_status = "verified_good"
                    phone.verification_source = "manual"
                    phone.verification_reason = (
                        resolution_note
                        or "Operator named owner; envelope previously confirmed"
                    )
                    phone.verified_at = now
                # else: verification_status untouched — operator named
                # someone but never audited the envelope placement.

            # Merge name fields into entity.extra_data (Secrets-Free Mandate —
            # structural columns stay generic; proprietary identity bits
            # live in extra_data).
            merged = dict(entity.extra_data or {})
            if identification.get("first_name"):
                merged["first_name"] = identification["first_name"]
            if identification.get("last_name"):
                merged["last_name"] = identification["last_name"]
            entity.extra_data = merged
            entity_dirty = True

        # ---- extra_metadata merge into phone.extra_data ----
        if extra_metadata:
            merged_phone = dict(phone.extra_data or {})
            merged_phone.update(extra_metadata)
            phone.extra_data = merged_phone

        # Persist the entity first (if touched), then the phone.
        if entity_dirty and entity is not None:
            self.entities.update(entity)
        phone = self.phones.update(phone)

        # Recalculate priority after the writes so confidence and
        # entity_type changes propagate into the score.
        if self.scoring_service is not None:
            self.scoring_service.recalculate_for_phone(phone_id)
            phone = self.phones.get(phone_id)
        return phone


class VerificationEngine:
    """
    Background engine that drives automated Phase 3 verification.

    Called periodically by the APScheduler job in `workers/scheduler.py`.
    Each tick:
        1. Queries for PhoneNumbers that are eligible for verification.
        2. Calls the injected `BaseVerificationStrategy` for each one.
        3. Persists the verdict via `VerificationService`.

    ELIGIBILITY CRITERIA (time-based verification window):
        A PhoneNumber is eligible for automated verification when ALL of:
            a) `verification_status == "pending"` (not yet evaluated).
            b) The number has at least one ActionLog row with status="sent"
               (it has been through Phase 2 at least once).
            c) The most recent "sent" ActionLog row is older than
               `verification_window_days` (the pipeline has had time to
               gather feedback from external systems).

    INTERNAL HOOK:
        The eligibility window (`verification_window_days`) can be tuned via
        the constructor arg or via a config value. Internal teams may also
        replace the eligibility query entirely by subclassing this engine and
        overriding `_fetch_eligible_phone_ids()`.
    """

    def __init__(
        self,
        storage: Storage,
        strategy: BaseVerificationStrategy,
        verification_service: VerificationService,
        verification_window_days: int = 7,
    ) -> None:
        """
        Args:
            storage                  (Storage):                    Repository bundle.
            strategy                 (BaseVerificationStrategy):   The injected quality
                                                                    evaluation algorithm.
            verification_service     (VerificationService):        The verdict writer.
            verification_window_days (int):                        Minimum number of days since
                                                                    the last "sent" ActionLog
                                                                    before a number is eligible.
        """
        self.phones = storage.phones
        self.action_logs = storage.action_logs
        self.strategy = strategy
        self.verification_service = verification_service
        self.verification_window_days = verification_window_days

    def _fetch_eligible_phone_ids(self) -> list[str]:
        """
        PhoneNumber IDs meeting the verification eligibility criteria:
            1. `verification_status == "pending"`
            2. At least one `ActionLog` with `status == "sent"` for this phone.
            3. The most recent "sent" `ActionLog.executed_at` is older than
               `verification_window_days` days ago.

        Resolved application-side (the storage seam has no GROUP BY): the
        per-phone last-sent timestamp is reduced from the 'sent' action logs
        in Python, then pending phones are filtered against the cutoff. The
        volume is bounded by the active queue, so the cost is negligible.
        """
        cutoff = utc_now() - timedelta(days=self.verification_window_days)

        def _aware(dt):
            # Mongo returns tz-aware datetimes; a naive value (e.g. a test
            # fixture or a legacy row) is treated as UTC so the comparison
            # below never mixes naive and aware operands.
            if dt is not None and dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt

        # Reduce: per-phone max executed_at over 'sent' logs.
        last_sent: dict[str, object] = {}
        for log in self.action_logs.list({"status": "sent"}):
            ts = _aware(log.executed_at)
            if ts is None:
                continue
            prev = last_sent.get(log.phone_id)
            if prev is None or ts > prev:
                last_sent[log.phone_id] = ts

        eligible: list[str] = []
        for phone in self.phones.list({"verification_status": "pending"}):
            ts = last_sent.get(phone.id)
            if ts is not None and ts <= cutoff:
                eligible.append(phone.id)
        return eligible

    def process_eligible_numbers(self) -> int:
        """
        Run the verification strategy against all eligible phone numbers.

        For each eligible phone_id:
            1. Call `self.strategy.evaluate_quality(phone_id)` to get verdict.
            2. Call `self.verification_service.update_verification_verdict()`
               to persist the result.
            3. On exception: log and continue (fail-safe batch processing).

        INTERNAL HOOK:
            If your deployment requires batching or concurrency limits
            (e.g. rate-limiting external API calls inside `evaluate_quality`),
            add chunking or async throttling logic around the for-loop below.
            The `_fetch_eligible_phone_ids()` method can also be overridden in
            a subclass to implement more sophisticated eligibility criteria.

        Returns:
            int: The number of phone numbers that were successfully evaluated
                 and updated in this tick.
        """
        eligible_ids = self._fetch_eligible_phone_ids()
        success_count = 0

        for phone_id in eligible_ids:
            try:
                # Delegate quality assessment entirely to the injected strategy.
                # The strategy returns a typed VerificationVerdict — opaque here.
                verdict = self.strategy.evaluate_quality(phone_id)

                self.verification_service.update_verification_verdict(
                    phone_id=phone_id,
                    status=verdict.status,
                    source="automated",
                    reason=verdict.reason,
                    extra_metadata=verdict.metadata,
                )
                success_count += 1

            except Exception:
                # INTERNAL HOOK: Replace with your observability/alerting logic.
                # A single bad evaluation must not abort the rest of the batch.
                continue

        return success_count
