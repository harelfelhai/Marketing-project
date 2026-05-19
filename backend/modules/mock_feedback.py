"""
modules/mock_feedback.py — Open-environment mock for Phase 3 verification.

This module is loaded when FEEDBACK_MODULE=modules.mock_feedback (the default).
It provides a deterministic mock strategy that always returns "verified_good".

INTERNAL REPLACEMENT
--------------------
Replace this module with your proprietary verification strategy.
The replacement module MUST:
    1. Define a class named exactly `VerificationStrategy`.
    2. Subclass `interfaces.verification.BaseVerificationStrategy`.
    3. Implement `evaluate_quality(phone_id) -> VerificationVerdict`.
    4. Set env var: FEEDBACK_MODULE=your.module.dotted.path
"""

from interfaces.verification import BaseVerificationStrategy
from schemas.verification import VerificationVerdict


class VerificationStrategy(BaseVerificationStrategy):
    """
    Mock verification strategy — always returns "verified_good".

    In the open environment there is no quality evaluation algorithm, so
    every evaluated number is trivially marked as good.
    """

    def evaluate_quality(self, phone_id: int) -> VerificationVerdict:
        """
        Mock evaluation: unconditionally returns a "verified_good" verdict.

        Args:
            phone_id (int): PK of the PhoneNumber row to evaluate.

        Returns:
            VerificationVerdict: status="verified_good", with a mock reason
                                  and a placeholder metadata bag.
        """
        # INTERNAL REPLACEMENT POINT:
        # Your implementation queries ActionLog, applies scoring, calls external
        # validation APIs, and returns a real verdict, e.g.:
        #   return VerificationVerdict(
        #       status="verified_good" if score > threshold else "verified_bad",
        #       reason=f"Score: {score}",
        #       metadata={"score": score, "threshold": threshold},
        #   )
        return VerificationVerdict(
            status="verified_good",
            reason="Mock evaluation: no real quality check performed in open environment.",
            metadata={"mock": True},
        )
