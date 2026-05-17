"""
schemas package — Pydantic data contracts for API boundaries.

Each schema file corresponds to one pipeline phase's input/output contract.

    Phase 1 ingestion:    from schemas.ingestion    import IngestionPayload
    Phase 3 verification: from schemas.verification import VerificationVerdict
"""

from schemas.ingestion import IngestionPayload
from schemas.verification import VerificationVerdict

__all__ = ["IngestionPayload", "VerificationVerdict"]
