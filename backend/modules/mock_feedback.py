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
    3. Implement `evaluate_quality(phone_id) -> Tuple[str, str, dict]`.
    4. Set env var: FEEDBACK_MODULE=your.module.dotted.path
"""

from typing import Tuple

from interfaces.verification import BaseVerificationStrategy


class VerificationStrategy(BaseVerificationStrategy):
    """
    Mock verification strategy — always returns "verified_good".

    In the open environment there is no quality evaluation algorithm, so
    every evaluated number is trivially marked as good.

    The internal engine subclasses the same ABC and applies proprietary
    scoring models, carrier lookups, or historical pattern analysis.
    """

    def evaluate_quality(self, phone_id: int) -> Tuple[str, str, dict]:
        """
        Mock evaluation: unconditionally returns a "verified_good" verdict.

        Args:
            phone_id (int): PK of the PhoneNumber row to evaluate.

        Returns:
            Tuple[str, str, dict]:
                [0] "verified_good"         — mock status
                [1] "Mock evaluation passed" — mock reason
                [2] {"mock": True}           — empty metadata
        """
        # INTERNAL REPLACEMENT POINT:
        # Your implementation queries ActionLog, applies scoring, calls external
        # validation APIs, and returns a real verdict, e.g.:
        #   actions = session.exec(select(ActionLog).where(...)).all()
        #   score = my_scoring_model.evaluate(actions)
        #   return ("verified_good" if score > threshold else "verified_bad",
        #           f"Score: {score}", {"score": score, "threshold": threshold})
        return (
            "verified_good",
            "Mock evaluation: no real quality check performed in open environment.",
            {"mock": True},
        )
