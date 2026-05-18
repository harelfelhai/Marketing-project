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

from datetime import datetime, timedelta
from typing import Optional, TYPE_CHECKING

from sqlmodel import Session, col, func, select

from exceptions import PhoneNumberNotFoundError
from interfaces.verification import BaseVerificationStrategy
from models.action_log import ActionLog
from models.phone_number import PhoneNumber
from models.types import utc_now

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
        session: Session,
        scoring_service: Optional["ScoringService"] = None,
    ) -> None:
        """
        Args:
            session         (Session):                  Active DB session.
            scoring_service (Optional[ScoringService]): Phase DY scoring
                hook. When provided, every successful verdict triggers
                a priority recalculation INSIDE the same transaction
                so verdict + priority land atomically. When None,
                scoring is skipped (used by legacy tests and any caller
                that wants to defer scoring).
        """
        self.session = session
        self.scoring_service = scoring_service

    def update_verification_verdict(
        self,
        phone_id: int,
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
        phone = self.session.get(PhoneNumber, phone_id)
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

        self.session.add(phone)

        # Phase DY scoring hook — recalc priority IN THE SAME TRANSACTION
        # so the verdict and the resulting priority change land
        # atomically (no race between two separate commits).
        if self.scoring_service is not None:
            self.scoring_service.recalculate_for_phone(phone_id, commit=False)

        self.session.commit()
        self.session.refresh(phone)
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
        session: Session,
        strategy: BaseVerificationStrategy,
        verification_service: VerificationService,
        verification_window_days: int = 7,
    ) -> None:
        """
        Args:
            session                  (Session):                    Active DB session.
            strategy                 (BaseVerificationStrategy):   The injected quality
                                                                    evaluation algorithm.
            verification_service     (VerificationService):        The DB writer for verdicts.
            verification_window_days (int):                        Minimum number of days since
                                                                    the last "sent" ActionLog
                                                                    before a number is eligible.
                                                                    Default: 7.
        """
        self.session = session
        self.strategy = strategy
        self.verification_service = verification_service
        self.verification_window_days = verification_window_days

    def _fetch_eligible_phone_ids(self) -> list[int]:
        """
        Query for PhoneNumber IDs that meet the verification eligibility criteria.

        Eligibility conditions:
            1. `PhoneNumber.verification_status == "pending"`
            2. At least one `ActionLog` with `status == "sent"` for this phone.
            3. The most recent "sent" `ActionLog.executed_at` is older than
               `self.verification_window_days` days ago.

        Returns:
            list[int]: Ordered list of eligible `PhoneNumber.id` values.
                       Empty list if no numbers are eligible.
        """
        cutoff = datetime.utcnow() - timedelta(days=self.verification_window_days)

        # Subquery: for each phone_id, find the max executed_at of "sent" logs.
        last_sent_subq = (
            select(
                ActionLog.phone_id,
                func.max(ActionLog.executed_at).label("last_sent_at"),
            )
            .where(ActionLog.status == "sent")
            .group_by(ActionLog.phone_id)
            .subquery()
        )

        # Main query: join PhoneNumber against the subquery, filter by window.
        results = self.session.exec(
            select(PhoneNumber.id)
            .join(
                last_sent_subq,
                PhoneNumber.id == last_sent_subq.c.phone_id,
            )
            .where(
                PhoneNumber.verification_status == "pending",
                col(last_sent_subq.c.last_sent_at) <= cutoff,
            )
        ).all()

        return list(results)

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
