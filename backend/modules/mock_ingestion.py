"""
modules/mock_ingestion.py — Open-environment mock for Phase 1 routing.

This module is loaded when INGESTION_MODULE=modules.mock_ingestion (the default).
It provides a no-op routing engine that never triggers immediate actions.

INTERNAL REPLACEMENT
--------------------
Replace this entire module with your proprietary implementation.
The replacement module MUST:
    1. Define a class named exactly `IngestionRoutingEngine`.
    2. Subclass `interfaces.ingestion.BaseIngestionRoutingEngine`.
    3. Implement `determine_immediate_action(phone_record) -> Optional[str]`.
    4. Set env var: INGESTION_MODULE=your.module.dotted.path
"""

from typing import Optional

from interfaces.ingestion import BaseIngestionRoutingEngine
from models.phone_number import PhoneNumber


class IngestionRoutingEngine(BaseIngestionRoutingEngine):
    """
    Mock routing engine — always returns None (no immediate action).

    In the open environment there are no routing rules to apply, so every
    newly ingested number simply remains in `verification_status="pending"`
    with no Phase 2 action triggered.

    The internal proprietary engine subclasses the same ABC and returns
    action type tokens based on the company's classification rules.
    """

    def determine_immediate_action(
        self, phone_record: PhoneNumber
    ) -> Optional[str]:
        """
        Mock implementation: no routing rules — always returns None.

        Args:
            phone_record (PhoneNumber): Newly ingested PhoneNumber row.

        Returns:
            Optional[str]: Always None in the mock environment.
        """
        # INTERNAL REPLACEMENT POINT:
        # Your implementation replaces this return statement with real logic,
        # e.g.:
        #   if phone_record.entity_type == "family":
        #       return "advertisement_type_a"
        #   return None
        return None
