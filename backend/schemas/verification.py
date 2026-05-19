"""
schemas/verification.py — Pydantic data contracts for Phase 3 (Verification).

Defines the strongly-typed return value of `BaseVerificationStrategy.evaluate_quality`.

WHY A MODEL INSTEAD OF A TUPLE?
--------------------------------
An earlier draft returned a `Tuple[str, str, dict]`. That contract has no
field names, no validation, and no way to extend without silently breaking
every concrete implementation. A Pydantic model gives us:
    - Named fields (self-documenting at call sites)
    - Type coercion + validation at the boundary
    - Forward-compatible additions (new optional fields are non-breaking)
"""

from typing import Dict

from pydantic import BaseModel, Field


class VerificationVerdict(BaseModel):
    """
    Strongly-typed return value for `BaseVerificationStrategy.evaluate_quality`.

    Returned by the strategy, consumed by `VerificationEngine`, and unpacked
    into the Phase 3 block of `PhoneNumber` via `VerificationService`.

    INTERNAL HOOK
    -------------
    Internal teams may safely extend this model with additional optional
    fields (e.g. `confidence_score: float`, `external_lookup_id: str`).
    Adding optional fields is non-breaking; the existing service layer
    ignores fields it does not recognise.
    """

    status: str = Field(
        ...,
        description="Verdict written to PhoneNumber.verification_status.",
        examples=["verified_good", "verified_bad"],
    )
    """
    Example values (illustrative, NOT enforced):
        - "verified_good" : number is actionable
        - "verified_bad"  : number is non-actionable / invalid
    Internal taxonomy is owned by the proprietary VerificationStrategy.
    """

    reason: str = Field(
        ...,
        description="Human-readable justification written to PhoneNumber.verification_reason.",
    )
    """Detailed enough for a reviewer to understand the verdict without reading metadata."""

    metadata: Dict = Field(
        default_factory=dict,
        description="Structured metadata merged into PhoneNumber.extra_data.",
    )
    """
    Internal teams should namespace their keys (e.g. {"verification": {...}})
    to avoid collisions with Phase 1 ingestion metadata already in extra_data.
    """
