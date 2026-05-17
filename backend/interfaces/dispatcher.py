"""
interfaces/dispatcher.py — Abstract base class for Phase 2: Action Execution.

Defines the Strategy pattern contract that all outbound action implementations
MUST fulfil.

ARCHITECTURAL ROLE
------------------
The Strategy Pattern here decouples WHAT to do (the action token, owned by
the routing engine) from HOW to do it (the vendor API call, owned by a
concrete `BaseActionHandler` subclass).

`ActionDispatcher` is the orchestrator that:
    1. Creates and manages the `ActionLog` row.
    2. Resolves the correct handler by `action_type` token.
    3. Calls `handler.execute()` and maps the result (or exception) to a
       status transition on the log row.

Each `BaseActionHandler` subclass owns exactly one interaction with one
external system. This keeps vendor-coupling isolated and replaceable.

PRIVACY BOUNDARY
----------------
The HOW — the actual vendor API credentials, request format, response
parsing, and campaign-specific parameters — lives ENTIRELY inside the
concrete handler module. This file + the mock define only the method
signature.

INTERNAL ENGINEER CHECKLIST
-----------------------------
To mount a proprietary action handler:
    1. Create a Python module accessible on PYTHONPATH.
    2. Define one or more classes subclassing `BaseActionHandler`.
    3. Implement `execute()` with your vendor API logic.
    4. Register each handler class against its action type token inside
       the `ActionDispatcher` handler registry (see `dependencies.py`).
    5. Raise `ActionExecutionError` for ALL failures — retryable or not —
       so the dispatcher can manage status transitions uniformly.
"""

from abc import ABC, abstractmethod


class BaseActionHandler(ABC):
    """
    Abstract strategy for executing a single type of outbound action.

    One subclass = one action type = one external integration.

    The dispatcher resolves the correct subclass by matching the
    `action_type` token string to the handler registry. The handler
    itself does NOT need to know its own token name.

    Lifecycle inside `ActionDispatcher.dispatch()`:
        1. Dispatcher creates an ActionLog row with status="pending".
        2. Dispatcher calls `handler.execute(phone_number, extra_data)`.
        3a. On success: dispatcher sets status="sent", records `executed_at`,
                        writes returned metadata to `ActionLog.extra_data`.
        3b. On ActionExecutionError (retryable=True): dispatcher sets
                        status="scheduled_retry", increments retry_count,
                        sets retry_after based on back-off policy.
        3c. On ActionExecutionError (retryable=False): dispatcher sets
                        status="failed", records error detail in extra_data.
    """

    @abstractmethod
    def execute(self, phone_number: str, extra_data: dict) -> dict:
        """
        Perform the outbound action for a given phone number.

        This method is the SOLE integration point with external systems
        (ad platforms, SMS gateways, notification services, etc.).
        It must be stateless and idempotent where possible.

        INTERNAL HOOK — THIS IS WHERE VENDOR CODE GOES:
        -------------------------------------------------
        Your implementation should:
            1. Extract any vendor-specific parameters from `extra_data`.
            2. Make the outbound API call using your proprietary credentials
               and request format.
            3. Parse the vendor response.
            4. Return a metadata dict that will be persisted to
               `ActionLog.extra_data` (include provider IDs, timestamps, etc.).
            5. Raise `ActionExecutionError` on ANY failure — set `retryable=True`
               for transient errors (timeouts, rate limits), `retryable=False`
               for permanent failures (invalid number, account blocked).

        Args:
            phone_number (str): The target phone number in the format it was
                                 stored (E.164 recommended). Do NOT modify this
                                 value — pass it to the vendor API as-is or
                                 apply only vendor-required transformations locally.
            extra_data   (dict): Opaque metadata bag from `ActionLog.extra_data`
                                 and/or injected by the dispatcher. Internal teams
                                 may populate this with campaign parameters, segment
                                 tokens, or A/B test flags — this handler is the
                                 only consumer that knows their structure.

        Returns:
            dict: A metadata dictionary that will be merged into (or replace)
                  `ActionLog.extra_data` upon successful execution.

                  Recommended keys (illustrative, NOT enforced):
                      {
                          "provider_message_id": str,   # vendor-assigned ID
                          "provider_response":   dict,  # raw vendor response body
                          "executed_at_vendor":  str,   # vendor-side timestamp
                      }

        Raises:
            ActionExecutionError: On any execution failure. Set `retryable=True`
                                   for transient errors that should be retried,
                                   `retryable=False` for permanent failures.
                                   The dispatcher catches ONLY this exception type —
                                   all other exceptions propagate as unexpected errors.

        Examples:
            # Minimal mock implementation:
            def execute(self, phone_number: str, extra_data: dict) -> dict:
                print(f"[MOCK] Dispatching action to {phone_number}")
                return {"mock": True, "provider_message_id": "mock-001"}
        """
        pass
