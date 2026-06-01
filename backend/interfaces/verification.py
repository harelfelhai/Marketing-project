"""
interfaces/verification.py — Abstract base class for Phase 3: Quality Verification.

Defines the Strategy contract for evaluating the quality of a phone number
based on its historical action execution patterns.

ARCHITECTURAL ROLE
------------------
Phase 3 verification answers: "Based on everything that has happened to this
phone number in Phase 2, is it actionable (good) or not (bad)?"

The `VerificationEngine` (in `services/verification.py`) drives the WHEN and
the WHICH (time-window selection, eligible number fetching). This ABC drives
the HOW (the actual quality evaluation algorithm).

Separating them allows the company to hot-swap the evaluation algorithm
(by changing `FEEDBACK_MODULE`) without affecting scheduling logic.

PRIVACY BOUNDARY
----------------
The proprietary scoring model, historical pattern analysis, external
validation calls (carrier lookup, HLR, etc.) — all of that lives inside
the concrete implementation. This file defines only the output contract:
a `(status, reason, metadata)` triple.

INTERNAL ENGINEER CHECKLIST
-----------------------------
To mount your proprietary verification strategy:
    1. Create a Python module accessible on PYTHONPATH.
    2. Define:  class VerificationStrategy(BaseVerificationStrategy)
    3. Implement `evaluate_quality()` with your algorithm.
    4. Set env var:  FEEDBACK_MODULE=your.module.path
    5. The VerificationEngine will call it for every eligible phone_id.
"""

from abc import ABC, abstractmethod

from schemas.verification import VerificationVerdict


class BaseVerificationStrategy(ABC):
    """
    Abstract strategy for evaluating the quality of a phone number.

    The `VerificationEngine` calls `evaluate_quality()` for each phone_id
    in the eligible batch. The returned tuple is passed directly to
    `VerificationService.update_verification_verdict()`.

    Implementations receive only the `phone_id` (an integer). They are
    expected to perform their own DB reads (via an injected session or
    internal lookup utility) to gather the historical action data they need.
    Direct DB writes MUST NOT happen inside this method — all writes are
    managed by `VerificationService`.
    """

    @abstractmethod
    def evaluate_quality(self, phone_id: str) -> VerificationVerdict:
        """
        Analyse a phone number's history and return a quality verdict.

        INTERNAL HOOK — THIS IS WHERE YOUR EVALUATION ALGORITHM GOES:
        --------------------------------------------------------------
        Your implementation should:
            1. Query `ActionLog` for all rows with `phone_id == phone_id`.
            2. Apply your proprietary scoring model, pattern analysis, or
               external validation (e.g. HLR lookup, carrier check).
            3. Return a `VerificationVerdict` (see `schemas/verification.py`).

        This method must be idempotent — calling it multiple times for the
        same `phone_id` must return an equivalent result given the same
        underlying data. This allows safe retries by the VerificationEngine.

        Args:
            phone_id (int): The primary key of the `PhoneNumber` row to
                            evaluate. Use this to query `ActionLog` rows
                            and any other relevant DB state.

        Returns:
            VerificationVerdict: A typed verdict object with three fields:
                - status   (str):  Written to PhoneNumber.verification_status
                                    (e.g. "verified_good" / "verified_bad").
                - reason   (str):  Written to PhoneNumber.verification_reason.
                - metadata (dict): Merged into PhoneNumber.extra_data.

        Raises:
            Exception: Any unhandled exception propagates to the
                       VerificationEngine, which logs it and continues
                       processing the rest of the eligible batch
                       (fail-safe, not fail-fast).

        Examples:
            # Minimal mock — always returns "verified_good":
            def evaluate_quality(self, phone_id: str) -> VerificationVerdict:
                return VerificationVerdict(
                    status="verified_good",
                    reason="mock evaluation passed",
                    metadata={},
                )
        """
        pass
