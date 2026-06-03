"""
interfaces/notifications.py — Pluggable contract for external chat delivery.

`BaseNotificationChannel.deliver()` is the single seam between the
notification pipeline and a deployment's chat provider (Slack, Teams,
Discord, webhook, etc.). Internal teams swap implementations by
setting the `NOTIFICATION_MODULE` env var; no code change required.

ARCHITECTURAL ROLE
------------------
Phase NOTIF introduces a generic alert pipeline. Above this seam the
system is fully provider-agnostic — recipients are opaque string
tokens, titles and bodies are pre-rendered. The concrete channel
module is the ONLY place that knows how to format and POST to a
specific chat API.

PRIVACY BOUNDARY
----------------
The recipient tokens, channel ids, webhook URLs etc. are proprietary
deployment configuration. The open-source repo deliberately knows
nothing about a deployment's Slack workspace / Teams tenant. The
ABC + the mock module define the shape; the concrete module supplies
the secrets at deployment time.

INTERNAL ENGINEER CHECKLIST
---------------------------
To mount a proprietary chat channel:
    1. Create a module accessible on PYTHONPATH.
    2. Define `class NotificationChannel(BaseNotificationChannel)`.
    3. Implement `deliver(...)` calling your provider's API.
    4. Set env var `NOTIFICATION_MODULE=your.module.path`.
    5. Restart the application — every dispatch goes through the
       new channel, no other code change needed.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class DeliveryResult:
    """
    Outcome of one `BaseNotificationChannel.deliver()` call.

    Frozen dataclass keeps the contract explicit — channel modules
    return EXACTLY these fields, no surprise side payload. The
    `NotificationDispatcher` translates this into the persisted
    NotificationDelivery row's status / provider_message_id /
    last_error columns.

    Fields:
        success
            True if the chat provider accepted the message. Drives the
            'sent' vs 'failed' status transition on the persisted row.
        provider_message_id
            Optional opaque token from the provider (e.g. Slack's
            message timestamp, Teams' activity id). Stored for
            de-duplication and operator-initiated re-fires. Channel
            modules that have no such token return None.
        error_detail
            Short operator-facing reason on failure. None on success.
        raw_response
            Optional opaque dict — provider-native payload. Stored on
            the delivery row's extra_data for postmortems; the
            dispatcher never inspects its contents.
    """

    success: bool
    provider_message_id: Optional[str] = None
    error_detail: Optional[str] = None
    raw_response: Optional[dict] = None


class BaseNotificationChannel(ABC):
    """
    Stateless contract every chat-platform module must implement.

    The dispatcher calls `deliver()` once per notification AFTER
    persisting the audit row. Implementations MUST:
        - Be deterministic given the inputs (no hidden state).
        - Never raise — return DeliveryResult(success=False, ...)
          on any failure path so the dispatcher can record cleanly.
        - Treat `recipients` as opaque tokens — interpretation is
          channel-specific (Slack channel ids, Teams emails, webhook
          URLs, etc.).
    """

    @abstractmethod
    def deliver(
        self,
        *,
        recipients: list[str],
        title: str,
        body: str,
        metadata: Optional[dict] = None,
    ) -> DeliveryResult:
        """
        Send one notification to the listed recipients.

        Args:
            recipients (list[str]):
                Opaque provider-specific tokens. NEVER decoded above
                this seam. Empty list is a no-op; the implementation
                should return success=True with provider_message_id=None.
            title (str):
                Pre-rendered message header. Channel modules may
                format-decorate (e.g. wrap as Slack `*bold*`) but MUST
                NOT re-interpret the content.
            body (str):
                Pre-rendered message body. Same contract as `title`.
            metadata (Optional[dict]):
                Caller-supplied context for the channel module to use
                if it cares (e.g. priority hint, trigger event token
                for a Slack thread key). Treated as opaque by the
                dispatcher.

        Returns:
            DeliveryResult: structured outcome. Never raises.
        """
        ...
