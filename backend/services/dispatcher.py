"""
services/dispatcher.py — Phase 2 orchestration: Action Dispatch & Recovery.

This module contains four classes covering the full Phase 2 lifecycle:

    ActionDispatcher          — core dispatch orchestrator (used by all triggers)
    UserActionService         — handles explicit operator-triggered actions from the UI
    RetryEngine               — background worker: re-dispatches scheduled retries
    ActionDataTriggerService  — event-driven recovery: re-dispatches on data fixes

DESIGN NOTES
------------
- `ActionDispatcher` is the ONLY class that writes to `ActionLog`. All other
  classes in this module delegate to it. This keeps status transition logic
  in one place.
- Handler selection uses a registry dict (`Dict[str, BaseActionHandler]`) keyed
  by action_type token. In the open environment, a `default_handler` catches all
  tokens. In the internal environment, dedicated handlers are registered per type.
- `RetryEngine` and `ActionDataTriggerService` are designed to be called from
  the APScheduler background job in `workers/scheduler.py`.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlmodel import Session, select

from exceptions import ActionExecutionError, PhoneNumberNotFoundError
from interfaces.dispatcher import BaseActionHandler
from models.action_log import ActionLog
from models.phone_number import PhoneNumber


class ActionDispatcher:
    """
    Central orchestrator for all Phase 2 outbound actions.

    Responsibilities:
        1. Create a "pending" `ActionLog` row before attempting execution.
        2. Resolve the correct `BaseActionHandler` for the given action_type.
        3. Call `handler.execute()` and translate the outcome into a
           status transition on the ActionLog row.
        4. Handle retryable vs. hard failures uniformly.

    This class does NOT decide WHEN to dispatch or WHICH action to dispatch.
    Those decisions live in `IngestionRoutingEngine`, `UserActionService`,
    and `RetryEngine`. This class only manages HOW an action is executed
    and recorded.

    Handler Registry:
        `handlers` maps action_type token strings to handler instances.
        `default_handler` is used as a fallback for unregistered tokens.
        In the open/mock environment, `default_handler` catches all tokens.
        In the internal environment, register specific handlers per type.
    """

    def __init__(
        self,
        session: Session,
        handlers: Dict[str, BaseActionHandler],
        default_handler: Optional[BaseActionHandler] = None,
        retry_backoff_seconds: int = 300,
    ) -> None:
        """
        Initialise the dispatcher.

        Args:
            session               (Session):                    Active DB session.
            handlers              (Dict[str, BaseActionHandler]): Registry mapping
                                                                  action_type tokens to
                                                                  concrete handler instances.
            default_handler       (Optional[BaseActionHandler]): Fallback handler used when
                                                                  `action_type` is not in
                                                                  `handlers`. In the mock
                                                                  environment this catches all
                                                                  tokens. In production, None
                                                                  means unregistered types fail.
            retry_backoff_seconds (int):                         Seconds to set `retry_after`
                                                                  ahead of now on soft failures.
                                                                  Default: 300 (5 minutes).

        INTERNAL HOOK:
            To add a proprietary handler for a specific action type, register
            it in the `handlers` dict passed at construction time:
                handlers = {
                    "advertisement_type_a": MyAdHandler(),
                    "followup_sms":         MySmsHandler(),
                }
        """
        self.session = session
        self.handlers = handlers
        self.default_handler = default_handler
        self.retry_backoff_seconds = retry_backoff_seconds

    def dispatch(self, phone_id: int, action_type: str) -> ActionLog:
        """
        Execute an outbound action and record the result in `ActionLog`.

        Full lifecycle:
            1. Verify the phone_id exists — raise PhoneNumberNotFoundError if not.
            2. INSERT an ActionLog row with status="pending".
            3. Resolve the handler: `handlers[action_type]` or `default_handler`.
               Raise ValueError if neither is available.
            4. Call `handler.execute(phone_number, extra_data={})`.
            5a. On success: update status="sent", set `executed_at`, merge metadata
                            into `ActionLog.extra_data`.
            5b. On ActionExecutionError (retryable=True): update status="scheduled_retry",
                            increment retry_count, set retry_after.
            5c. On ActionExecutionError (retryable=False): update status="failed",
                            record error detail in extra_data.

        Args:
            phone_id    (int): PK of the target `PhoneNumber` row.
            action_type (str): Token identifying which action to execute.
                               Must match a key in `self.handlers` or have a
                               `default_handler` registered.

        Returns:
            ActionLog: The committed ActionLog row reflecting the final status
                       of this dispatch attempt.

        Raises:
            PhoneNumberNotFoundError: If `phone_id` does not exist in the DB.
            ValueError:               If no handler is registered for `action_type`
                                       and no `default_handler` is set.
        """
        # Step 1 — Verify phone exists.
        phone = self.session.get(PhoneNumber, phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        # Step 2 — Create the pending ActionLog row before attempting execution.
        # This ensures an audit trail exists even if the process crashes mid-dispatch.
        log = ActionLog(
            phone_id=phone_id,
            action_type=action_type,
            status="pending",
            requested_at=datetime.utcnow(),
        )
        self.session.add(log)
        self.session.flush()  # assigns log.id without committing

        # Step 3 — Resolve handler. Named registry takes priority; default is fallback.
        handler = self.handlers.get(action_type, self.default_handler)
        if handler is None:
            # Hard-fail: no handler means we cannot proceed.
            # Mark the row as failed immediately rather than leaving it "pending".
            log.status = "failed"
            log.executed_at = datetime.utcnow()
            log.extra_data = {"error": f"No handler registered for action_type='{action_type}'"}
            self.session.add(log)
            self.session.commit()
            self.session.refresh(log)
            raise ValueError(
                f"No handler registered for action_type='{action_type}' "
                "and no default_handler is configured."
            )

        # Step 4 — Execute the action.
        try:
            result_metadata = handler.execute(
                phone_number=phone.phone_number,
                extra_data=log.extra_data or {},
            )
            # Step 5a — Success path.
            log.status = "sent"
            log.executed_at = datetime.utcnow()
            log.extra_data = result_metadata

        except ActionExecutionError as exc:
            log.executed_at = datetime.utcnow()
            if exc.retryable:
                # Step 5b — Soft failure: schedule a retry.
                log.status = "scheduled_retry"
                log.retry_count = (log.retry_count or 0) + 1
                log.retry_after = datetime.utcnow() + timedelta(
                    seconds=self.retry_backoff_seconds
                )
            else:
                # Step 5c — Hard failure: terminal state.
                log.status = "failed"

            log.extra_data = {
                "error_detail": exc.detail,
                "retryable": exc.retryable,
            }

        self.session.add(log)
        self.session.commit()
        self.session.refresh(log)
        return log


class UserActionService:
    """
    Handles explicit operator-triggered action requests from the UI.

    This service is the bridge between a human operator's click in the
    Review Queue (or any UI) and the `ActionDispatcher`. It adds operator
    attribution to the dispatch by recording the `operator_id` in `extra_data`
    before delegating.

    Operators trigger actions at a LATER lifecycle stage (after initial
    ingestion), when they manually review a phone number and decide to
    initiate or reinitiate an outbound action.
    """

    def __init__(
        self,
        session: Session,
        dispatcher: ActionDispatcher,
    ) -> None:
        """
        Args:
            session    (Session):          Active DB session.
            dispatcher (ActionDispatcher): Shared dispatcher instance.
        """
        self.session = session
        self.dispatcher = dispatcher

    def trigger_manual_action(
        self,
        phone_id: int,
        action_type: str,
        operator_id: str,
    ) -> ActionLog:
        """
        Queue and execute a manual action requested by a human operator.

        Adds `operator_id` attribution to the ActionLog via `extra_data`
        before calling `dispatcher.dispatch()`.

        INTERNAL HOOK:
            If operator-level permissions or rate limiting need to be enforced
            (e.g. an operator can only trigger X actions per day), add those
            checks here before calling `self.dispatcher.dispatch()`. This service
            is the right layer for that logic — not the router, not the dispatcher.

        Args:
            phone_id    (int): PK of the target PhoneNumber row.
            action_type (str): Token of the action to execute.
            operator_id (str): Identifier of the human operator. May be a username,
                               employee ID, or any opaque string the UI provides.
                               Stored in ActionLog.extra_data for audit purposes.

        Returns:
            ActionLog: The committed ActionLog row from the dispatcher.

        Raises:
            PhoneNumberNotFoundError: Propagated from ActionDispatcher.
            ValueError:               Propagated from ActionDispatcher if no handler
                                       is registered.
        """
        # Inject operator attribution into the dispatcher's initial extra_data.
        # The dispatcher will merge result metadata on top of this.
        # INTERNAL HOOK: Add permission checks, quota checks, or approval workflow
        # hooks here if required by the internal deployment's security model.
        log = self.dispatcher.dispatch(
            phone_id=phone_id,
            action_type=action_type,
        )

        # Record operator attribution on the committed row.
        existing_extra = log.extra_data or {}
        existing_extra["triggered_by_operator"] = operator_id
        log.extra_data = existing_extra
        self.session.add(log)
        self.session.commit()
        self.session.refresh(log)
        return log


class RetryEngine:
    """
    Background worker that re-dispatches scheduled retry actions.

    Designed to be called on a periodic APScheduler tick (e.g. every 60s).
    Each call finds all ActionLog rows where:
        - status == "scheduled_retry"
        - retry_after <= utcnow()
    ...and re-dispatches them via `ActionDispatcher.dispatch()`.

    IMPORTANT: This engine does NOT re-dispatch by updating the EXISTING
    ActionLog row. It creates a NEW ActionLog row for each retry attempt,
    preserving the full retry history as a timeline.

    Wait — looking at the design again: `ActionDispatcher.dispatch()` always
    creates a NEW row. So calling dispatch() here will naturally create new rows.
    The original "scheduled_retry" row remains as historical record.
    """

    def __init__(
        self,
        session: Session,
        dispatcher: ActionDispatcher,
    ) -> None:
        """
        Args:
            session    (Session):          Active DB session.
            dispatcher (ActionDispatcher): Shared dispatcher instance.
        """
        self.session = session
        self.dispatcher = dispatcher

    def process_scheduled_retries(self) -> int:
        """
        Scan for eligible retries and re-dispatch them.

        Query:  SELECT * FROM action_log
                WHERE status = 'scheduled_retry'
                  AND retry_after <= :now

        For each eligible row:
            1. Mark the row as "processing" to prevent double-dispatch
               (important if multiple workers run concurrently).
            2. Call `dispatcher.dispatch(phone_id, action_type)` to
               create a new ActionLog row for this retry attempt.
            3. The dispatcher handles success/failure/re-retry transitions
               on the NEW row automatically.

        INTERNAL HOOK:
            If your deployment runs multiple worker instances, you may need
            to add a SELECT FOR UPDATE or row-level locking strategy here
            to prevent the same row from being processed twice. The current
            implementation uses a simple status-flip guard which is safe
            for single-worker deployments.

        Returns:
            int: The number of retry jobs that were processed in this tick.
        """
        now = datetime.utcnow()

        # Fetch all rows eligible for retry.
        eligible_rows = self.session.exec(
            select(ActionLog).where(
                ActionLog.status == "scheduled_retry",
                ActionLog.retry_after <= now,
            )
        ).all()

        processed_count = 0
        for row in eligible_rows:
            # Flip the original row out of the retry queue immediately.
            # This prevents a second worker from picking it up concurrently.
            row.status = "retrying"
            self.session.add(row)
            self.session.flush()

            try:
                self.dispatcher.dispatch(
                    phone_id=row.phone_id,
                    action_type=row.action_type,
                )
                processed_count += 1
            except Exception:
                # Log and continue — a single bad row must not block the batch.
                # INTERNAL HOOK: Replace with your observability/alerting logic.
                row.status = "failed"
                self.session.add(row)
                self.session.flush()

        self.session.commit()
        return processed_count


class ActionDataTriggerService:
    """
    Event-driven recovery: re-dispatches actions after data corrections.

    Called when a PhoneNumber record is updated (e.g. a data fix or a
    manual correction by an operator). If the number had a previous
    `failed` action, this service gives the pipeline a second chance
    by re-triggering the dispatcher.

    Use case example:
        An operator corrects a misclassified `classification_type` on a
        PhoneNumber row. The data change event fires
        `evaluate_data_change_trigger(phone_id, updated_fields=["classification_type"])`.
        The service checks for failed actions, and if found, re-dispatches.
    """

    def __init__(
        self,
        session: Session,
        dispatcher: ActionDispatcher,
    ) -> None:
        """
        Args:
            session    (Session):          Active DB session.
            dispatcher (ActionDispatcher): Shared dispatcher instance.
        """
        self.session = session
        self.dispatcher = dispatcher

    def evaluate_data_change_trigger(
        self,
        phone_id: int,
        updated_fields: List[str],
    ) -> Optional[ActionLog]:
        """
        Check whether a data-field update warrants re-dispatching a failed action.

        Logic:
            1. Find the most recent `failed` ActionLog row for this phone_id.
            2. If one exists, re-dispatch its `action_type` via the dispatcher.
            3. Return the new ActionLog row if a dispatch occurred, else None.

        INTERNAL HOOK:
            The `updated_fields` list is provided so that internal implementations
            can add field-specific trigger rules (e.g. "only re-dispatch if
            'classification_type' changed, not if 'ingestion_reason' changed").
            The current implementation triggers on ANY field change if a failed
            action exists. Override this method in an internal subclass to
            restrict triggering conditions.

        Args:
            phone_id       (int):        PK of the updated PhoneNumber row.
            updated_fields (List[str]):  Names of the fields that were changed.
                                          Available for internal filtering logic.

        Returns:
            Optional[ActionLog]: The new ActionLog row created by the dispatcher,
                                  or None if no re-dispatch was triggered.

        Raises:
            PhoneNumberNotFoundError: Propagated from ActionDispatcher if phone_id
                                       is invalid.
        """
        # INTERNAL HOOK: Add field-specific gating logic here if needed.
        # Example: if "classification_type" not in updated_fields: return None

        # Find the most recent failed action for this phone number.
        last_failed = self.session.exec(
            select(ActionLog)
            .where(
                ActionLog.phone_id == phone_id,
                ActionLog.status == "failed",
            )
            .order_by(ActionLog.requested_at.desc())
        ).first()

        if last_failed is None:
            # No failed actions — data change does not trigger a retry.
            return None

        # Re-dispatch the same action_type that previously failed.
        new_log = self.dispatcher.dispatch(
            phone_id=phone_id,
            action_type=last_failed.action_type,
        )
        return new_log
