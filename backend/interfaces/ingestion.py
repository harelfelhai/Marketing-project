"""
interfaces/ingestion.py — Abstract base class for Phase 1: Ingestion Routing.

Defines the contract that ALL concrete `IngestionRoutingEngine` implementations
MUST fulfil — whether the open-source mock or the company's proprietary engine.

ARCHITECTURAL ROLE
------------------
The `IngestionRoutingEngine` is the INTERNAL decision-maker that runs
immediately after a new `PhoneNumber` is saved to the database. It answers
one question:

    "Does this newly ingested number qualify for an immediate Phase 2 action?
     If yes, which action type should be triggered?"

CRITICAL PRIVACY BOUNDARY
--------------------------
This is where corporate segmentation rules, scoring thresholds, and routing
taxonomies live. The ABC here defines only the METHOD SIGNATURE. All routing
logic — every if/else, every threshold, every proprietary token name —
belongs EXCLUSIVELY inside the concrete implementation module.

The open-source codebase (this file + the mock) MUST remain completely blind
to those rules.

INTERNAL ENGINEER CHECKLIST
-----------------------------
To mount your proprietary routing engine:
    1. Create a new Python module accessible on the server's PYTHONPATH.
    2. Inside it, define:  class IngestionRoutingEngine(BaseIngestionRoutingEngine)
    3. Implement `determine_immediate_action()` with your business logic.
    4. Set env var:  INGESTION_MODULE=your.module.path
    5. Restart the application — no other changes required.
"""

from abc import ABC, abstractmethod
from typing import Optional

from models.phone_number import PhoneNumber


class BaseIngestionRoutingEngine(ABC):
    """
    Abstract contract for the ingestion routing decision layer.

    This class is instantiated once per request (or once per scheduler tick)
    by the FastAPI dependency injector in `dependencies.py`. It receives a
    fully persisted `PhoneNumber` object and must return an action type token
    or None.

    Concrete implementations may access any internal state or external lookup
    tables they need, but MUST NOT perform DB writes — reads only. All write
    side-effects are the responsibility of the caller (`IngestionService`).
    """

    @abstractmethod
    def determine_immediate_action(
        self, phone_record: PhoneNumber
    ) -> Optional[str]:
        """
        Evaluate a newly ingested phone number and decide whether to trigger
        an immediate Phase 2 action.

        This method is called synchronously inside the same transaction
        context that created the `PhoneNumber` row, immediately after the
        DB commit. It must complete quickly — avoid blocking I/O.

        INTERNAL HOOK — THIS IS WHERE YOUR ROUTING RULES GO:
        -------------------------------------------------------
        Your implementation should inspect any combination of:
            - `phone_record.entity_type`
            - `phone_record.classification_type`
            - `phone_record.ingestion_source`
            - `phone_record.extra_data`  (proprietary scoring vectors, etc.)
            - Any internal lookup tables or configuration matrices

        ...and return the appropriate action type token string, or None.

        The returned string MUST exactly match an action type registered
        in the `ActionDispatcher`'s handler registry. If the token is
        unrecognised, `ActionDispatcher.dispatch()` will raise a ValueError.

        Args:
            phone_record (PhoneNumber): The fully persisted, committed
                                        PhoneNumber ORM object. All fields
                                        (including `id`, `ingested_at`, etc.)
                                        are guaranteed to be populated.

        Returns:
            Optional[str]: An action type token string (e.g. "advertisement_type_a")
                           if an immediate Phase 2 action should be dispatched, or
                           None if no immediate action is warranted.

        Examples:
            # Trigger action for all "family" members:
            if phone_record.entity_type == "family":
                return "advertisement_type_a"
            return None

            # No immediate action in mock environment:
            return None
        """
        pass
