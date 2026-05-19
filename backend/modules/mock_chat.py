"""
modules/mock_chat.py — Default notification channel for the open repo.

Logs every delivery attempt to stdout and always reports success. Used
for development, integration tests, and as a safety net when no real
chat provider is configured.

HOW TO REPLACE
--------------
Set NOTIFICATION_MODULE=your.module.path in the environment. The
class inside must be named `NotificationChannel` and subclass
`interfaces.notifications.BaseNotificationChannel`. The dispatcher
loads it dynamically at request time — no code change required.

THIS MODULE NEVER RAISES
------------------------
Per the BaseNotificationChannel contract, any failure path returns
`DeliveryResult(success=False, ...)`. Even with the mock there's a
non-trivial check (recipients must be non-empty for an emitted
message), so we keep the defensive branches in place to mirror what
a real implementation should look like.
"""

import logging
import uuid

from interfaces.notifications import BaseNotificationChannel, DeliveryResult


_LOG = logging.getLogger(__name__)


class NotificationChannel(BaseNotificationChannel):
    """
    Inert chat channel. Emits a structured log line per delivery so
    operators running the dev stack can verify the pipe is wired
    without standing up a real Slack workspace.

    The mock generates a uuid4 provider_message_id so the dispatcher's
    de-dup logic has a stable token to record, exactly as a real
    provider would.
    """

    def deliver(
        self,
        *,
        recipients,
        title,
        body,
        metadata=None,
    ) -> DeliveryResult:
        # Empty recipient lists are a documented no-op. We still emit a
        # log line so operators see the call landed but no fan-out
        # happened (catches misconfigured subscriptions during dev).
        if not recipients:
            _LOG.info(
                "mock_chat.deliver: skipped — no recipients (title=%r)", title,
            )
            return DeliveryResult(
                success=True,
                provider_message_id=None,
                error_detail=None,
                raw_response={"skipped": "no_recipients"},
            )

        message_id = str(uuid.uuid4())
        _LOG.info(
            "mock_chat.deliver: recipients=%s title=%r body=%r metadata=%s id=%s",
            recipients, title, body, metadata or {}, message_id,
        )
        return DeliveryResult(
            success=True,
            provider_message_id=message_id,
            error_detail=None,
            raw_response={"mock": True, "recipients_count": len(recipients)},
        )
