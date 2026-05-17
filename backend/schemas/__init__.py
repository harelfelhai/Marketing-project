"""
schemas package — Pydantic data contracts for API boundaries.

Each schema file corresponds to one pipeline phase's input/output contract.

    Phase 1 ingestion: from schemas.ingestion import IngestionPayload
"""

from schemas.ingestion import IngestionPayload

__all__ = ["IngestionPayload"]
