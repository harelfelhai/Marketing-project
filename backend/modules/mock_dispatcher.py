"""
modules/mock_dispatcher.py — Open-environment mock for Phase 2 action handling.

This module is loaded when DISPATCHER_MODULE=modules.mock_dispatcher (the default).
It provides a catch-all action handler that logs to stdout and returns generic
mock metadata — no real outbound calls are made.

INTERNAL REPLACEMENT
--------------------
Replace this module with one or more proprietary handler classes.
Each replacement handler MUST:
    1. Define a class that subclasses `interfaces.dispatcher.BaseActionHandler`.
    2. Implement `execute(phone_number, extra_data) -> dict`.
    3. Raise `exceptions.ActionExecutionError` on failure (never bare exceptions).

The class name loaded by `dependencies.py` is `ActionHandler` (the default/catch-all).
For action-type-specific handlers, register them in the `ActionDispatcher`'s handler
registry inside `dependencies.py`.
"""

from interfaces.dispatcher import BaseActionHandler


class ActionHandler(BaseActionHandler):
    """
    Mock action handler — logs to stdout, returns fake metadata.

    Acts as the catch-all `default_handler` registered in `ActionDispatcher`.
    In the open environment, ALL action types are routed through this single
    class, regardless of their token string.

    The internal environment registers dedicated handlers per action_type token.
    """

    def execute(self, phone_number: str, extra_data: dict) -> dict:
        """
        Mock execution: print to stdout and return placeholder metadata.

        No real outbound call is made. This is safe to run in any environment
        without external credentials or network access.

        Args:
            phone_number (str):  Target phone number string.
            extra_data   (dict): Action metadata (ignored in mock).

        Returns:
            dict: Placeholder metadata indicating mock execution.
        """
        # INTERNAL REPLACEMENT POINT:
        # Your implementation makes the real outbound API call here, e.g.:
        #   response = vendor_client.send(phone_number, **extra_data)
        #   return {"provider_message_id": response.id, "provider_response": response.json()}
        print(f"[MOCK ACTION HANDLER] Dispatching to {phone_number} | extra_data={extra_data}")
        return {
            "mock": True,
            "provider_message_id": f"mock-{phone_number}-001",
        }
