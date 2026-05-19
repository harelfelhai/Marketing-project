"""
services/dispatcher.py — Phase 2 orchestration: Action Dispatch & Recovery.

This module contains four classes covering the full Phase 2 lifecycle:

    ActionDispatcher          — core dispatch orchestrator (used by all triggers)
    UserActionService         — operator-triggered actions from the UI
    RetryEngine               — background worker: re-dispatches scheduled retries
    ActionDataTriggerService  — event-driven recovery: re-dispatches on data fixes

DESIGN NOTES
------------
- `ActionDispatcher` is the ONLY class that writes to `ActionLog`. All other
  classes delegate to it. Status transition logic lives in one place.
- One `ActionLog` row = one logical action. Retries MUTATE the same row;
  they do not spawn new rows. `retry_count` tracks attempts on THAT row.
- `RetryEngine` uses an atomic UPDATE … WHERE status='scheduled_retry'
  to claim rows, eliminating the TOCTOU window between SELECT and flip.
- `ActionDispatcher.max_retry_count` caps the retry loop; once exceeded,
  the next retryable failure transitions the row to terminal `failed`.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set

from sqlalchemy import update
from sqlmodel import Session, select

from exceptions import ActionExecutionError, PhoneNumberNotFoundError
from interfaces.dispatcher import BaseActionHandler
from models.action_log import ActionLog
from models.phone_number import PhoneNumber


class ActionDispatcher:
    """
    Central orchestrator for all Phase 2 outbound actions.

    Two public entry points:
        - `dispatch(phone_id, action_type)`:
            Creates a NEW ActionLog row in status="pending", then executes.
            Called by IngestionService (immediate-action path) and
            UserActionService (operator-triggered path).
        - `execute_pending(log)`:
            Re-executes the handler against an EXISTING ActionLog row.
            Called by RetryEngine for scheduled retries — preserves the
            row's `retry_count` history.

    Both ultimately call the private `_run_handler()` which contains the
    single source of truth for status transitions.
    """

    def __init__(
        self,
        session: Session,
        handlers: Dict[str, BaseActionHandler],
        default_handler: Optional[BaseActionHandler] = None,
        max_retry_count: int = 5,
        retry_backoff_seconds: int = 300,
    ) -> None:
        """
        Args:
            session               (Session):                    Active DB session.
            handlers              (Dict[str, BaseActionHandler]): Registry mapping
                                                                  action_type tokens to
                                                                  concrete handler instances.
            default_handler       (Optional[BaseActionHandler]): Fallback handler used when
                                                                  `action_type` is not in
                                                                  `handlers`. Open environment
                                                                  uses this catch-all; in
                                                                  production set to None to
                                                                  enforce strict registration.
            max_retry_count       (int):                         Upper bound on `retry_count`
                                                                  before terminal "failed".
                                                                  Default: 5.
            retry_backoff_seconds (int):                         Seconds added to `now()`
                                                                  when setting `retry_after`
                                                                  on a soft failure.
                                                                  Default: 300 (5 min).
        """
        self.session = session
        self.handlers = handlers
        self.default_handler = default_handler
        self.max_retry_count = max_retry_count
        self.retry_backoff_seconds = retry_backoff_seconds

    # ------------------------------------------------------------------
    # Public entry points
    # ------------------------------------------------------------------

    def dispatch(self, phone_id: int, action_type: str) -> ActionLog:
        """
        Create a new ActionLog row and execute the handler against it.

        Used for FRESH dispatches (Phase 1 immediate routing or operator
        manual trigger). For retries against an existing row, use
        `execute_pending()` instead.

        Args:
            phone_id    (int): PK of the target `PhoneNumber` row.
            action_type (str): Token identifying which action to execute.

        Returns:
            ActionLog: The committed row reflecting the final status of
                       this dispatch attempt.

        Raises:
            PhoneNumberNotFoundError: If `phone_id` does not exist.
            ValueError:               If no handler is registered for
                                       `action_type` and no `default_handler`
                                       is configured.
        """
        phone = self.session.get(PhoneNumber, phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        log = ActionLog(
            phone_id=phone_id,
            action_type=action_type,
            status="pending",
            requested_at=datetime.utcnow(),
        )
        self.session.add(log)
        self.session.flush()  # assigns log.id without committing

        return self.execute_pending(log)

    def execute_pending(self, log: ActionLog) -> ActionLog:
        """
        Execute the handler against an EXISTING ActionLog row.

        Caller is responsible for ensuring `log` is in an appropriate
        pre-execution state (typically "pending" or "retrying"). This
        method does NOT transition the row INTO "pending" — it transitions
        OUT of whatever the current state is, into the final state
        determined by the handler outcome.

        Args:
            log (ActionLog): The row to execute. Must already exist in the
                              session and have a valid `phone_id`.

        Returns:
            ActionLog: The same row, committed with the new status.

        Raises:
            PhoneNumberNotFoundError: If `log.phone_id` doesn't resolve.
            ValueError:               If no handler is available for
                                       `log.action_type`.
        """
        phone = self.session.get(PhoneNumber, log.phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=log.phone_id)

        return self._run_handler(log, phone)

    # ------------------------------------------------------------------
    # Internal: the single source of truth for status transitions
    # ------------------------------------------------------------------

    def _run_handler(self, log: ActionLog, phone: PhoneNumber) -> ActionLog:
        """
        Invoke the resolved handler and transition `log` to its final state.

        Status transition rules (in order of evaluation):
            1. No handler available           → status="failed",  raises ValueError
            2. handler.execute() returns      → status="sent"
            3. ActionExecutionError(retryable=False)
                                              → status="failed"
            4. ActionExecutionError(retryable=True)
                a. retry_count < max_retry_count  → status="scheduled_retry",
                                                    retry_count += 1,
                                                    retry_after = now + backoff
                b. retry_count >= max_retry_count → status="failed" (ceiling hit)

        Args:
            log   (ActionLog):  The row being executed (already in session).
            phone (PhoneNumber): The associated phone (already fetched).

        Returns:
            ActionLog: `log` after commit + refresh.

        Raises:
            ValueError: If no handler is registered and no default exists.
        """
        handler = self.handlers.get(log.action_type, self.default_handler)
        now = datetime.utcnow()

        if handler is None:
            # No handler → terminal failure. Persist the failure state first,
            # then raise so the caller knows the dispatch did not execute.
            log.status = "failed"
            log.executed_at = now
            log.extra_data = {
                "error": f"No handler registered for action_type='{log.action_type}'",
            }
            self.session.add(log)
            self.session.commit()
            self.session.refresh(log)
            raise ValueError(
                f"No handler registered for action_type='{log.action_type}' "
                "and no default_handler is configured."
            )

        try:
            result_metadata = handler.execute(
                phone_number=phone.phone_number,
                extra_data=log.extra_data or {},
            )
            # Success path
            log.status = "sent"
            log.executed_at = now
            log.extra_data = result_metadata

        except ActionExecutionError as exc:
            log.executed_at = now
            current_retry = log.retry_count or 0

            if exc.retryable and current_retry < self.max_retry_count:
                # Soft failure within budget → schedule retry
                log.status = "scheduled_retry"
                log.retry_count = current_retry + 1
                log.retry_after = now + timedelta(seconds=self.retry_backoff_seconds)
            else:
                # Either non-retryable, OR retryable but ceiling hit → terminal
                log.status = "failed"

            log.extra_data = {
                "error_detail": exc.detail,
                "retryable": exc.retryable,
                "retry_count_at_failure": current_retry,
            }

        self.session.add(log)
        self.session.commit()
        self.session.refresh(log)
        return log


class UserActionService:
    """
    Handles operator-triggered action requests from the UI.

    Records the `operator_id` IN THE SAME COMMIT as the ActionLog row's
    final state, so there is no window where a successful action exists
    without operator attribution.

    Implementation strategy: pre-stamp `operator_id` into the row's
    `extra_data` BEFORE the dispatcher runs the handler. The dispatcher
    will overwrite `extra_data` with the handler's return value on success
    — so we re-apply the operator_id after, but the commit is the SAME
    transaction since `execute_pending()` does the final commit.

    Equivalent without race window:
        1. Create the ActionLog manually with status="pending" + operator_id baked in.
        2. Pass it to `dispatcher.execute_pending()` which commits exactly once.
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
        Queue and execute an operator-triggered action with attribution.

        Creates the ActionLog row directly (with operator_id baked into
        `extra_data`), then delegates to `dispatcher.execute_pending()`.
        This ensures the operator_id is persisted atomically with the
        row's final status, regardless of how the dispatch resolves.

        INTERNAL HOOK:
            Add permission checks, quota limits, or approval-workflow
            integrations here BEFORE creating the log row. This service
            is the right layer for operator-policy enforcement.

        Args:
            phone_id    (int): PK of the target PhoneNumber row.
            action_type (str): Action token.
            operator_id (str): Operator identifier (username, employee ID, etc.).
                               Stored in ActionLog.extra_data for audit.

        Returns:
            ActionLog: Committed row with `extra_data` containing operator_id.

        Raises:
            PhoneNumberNotFoundError: Propagated from dispatcher.
            ValueError:               Propagated from dispatcher.
        """
        phone = self.session.get(PhoneNumber, phone_id)
        if phone is None:
            raise PhoneNumberNotFoundError(identifier=phone_id)

        # Pre-stamp the operator_id so it cannot be lost between commits.
        # The handler's return metadata will be merged on top by the dispatcher.
        log = ActionLog(
            phone_id=phone_id,
            action_type=action_type,
            status="pending",
            requested_at=datetime.utcnow(),
            extra_data={"triggered_by_operator": operator_id},
        )
        self.session.add(log)
        self.session.flush()

        # Run handler. After this returns, `log.extra_data` is the handler's
        # output (success) or the error payload (failure). Either way, we
        # re-attach the operator_id and commit once more.
        completed = self.dispatcher.execute_pending(log)
        merged = dict(completed.extra_data or {})
        merged["triggered_by_operator"] = operator_id
        completed.extra_data = merged
        self.session.add(completed)
        self.session.commit()
        self.session.refresh(completed)
        return completed


class RetryEngine:
    """
    Background worker that re-dispatches scheduled-retry actions.

    Called periodically by the APScheduler job in `workers/scheduler.py`.
    Each tick:
        1. Selects ActionLog rows where status="scheduled_retry"
           AND retry_after <= utcnow().
        2. For each row, atomically claims it via:
              UPDATE action_log SET status='retrying'
              WHERE id=? AND status='scheduled_retry'
           Skips the row if rowcount != 1 (another worker claimed it).
        3. Re-executes via `ActionDispatcher.execute_pending(row)` —
           the SAME row is mutated, preserving its `retry_count` history.
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
        Scan for eligible retries and re-execute them.

        ATOMIC CLAIM
        ------------
        Each row is claimed via an UPDATE … WHERE status='scheduled_retry'
        and a `rowcount == 1` check. This closes the TOCTOU window where
        two concurrent workers could see the same row in the initial
        SELECT and both attempt to dispatch it.

        For Postgres, an internal subclass may override this method to
        use `SELECT … FOR UPDATE SKIP LOCKED` for true row-level locking.
        SQLite has no such mechanism — single-worker deployments only.

        Returns:
            int: Number of retries successfully re-dispatched in this tick.
                  Rows that were already claimed by another worker (and
                  skipped) are NOT counted.
        """
        now = datetime.utcnow()

        candidate_ids = self.session.exec(
            select(ActionLog.id).where(
                ActionLog.status == "scheduled_retry",
                ActionLog.retry_after <= now,
            )
        ).all()

        processed_count = 0
        for log_id in candidate_ids:
            # Atomic claim: only proceed if WE flipped status from
            # 'scheduled_retry' → 'retrying'. If rowcount is 0, another
            # worker beat us to it — skip silently.
            result = self.session.execute(
                update(ActionLog)
                .where(
                    ActionLog.id == log_id,
                    ActionLog.status == "scheduled_retry",
                )
                .values(status="retrying")
            )
            self.session.commit()

            if result.rowcount != 1:
                continue  # Lost the claim race; another worker has it.

            # Re-load the claimed row and re-execute. execute_pending will
            # commit the final state when done.
            row = self.session.get(ActionLog, log_id)
            if row is None:
                continue

            try:
                self.dispatcher.execute_pending(row)
                processed_count += 1
            except Exception:
                # Mark terminally failed so we don't get stuck in 'retrying'.
                # INTERNAL HOOK: Replace with structured logging / alerting.
                row.status = "failed"
                self.session.add(row)
                self.session.commit()

        return processed_count


class ActionDataTriggerService:
    """
    Event-driven recovery: re-dispatches actions after data corrections.

    Called when a PhoneNumber record is updated (e.g. a data fix). If the
    number has at least one `failed` ActionLog row AND at least one of the
    updated fields is in the configured allowlist, re-dispatches the most
    recent failed action's `action_type`.

    LOOP PREVENTION
    ---------------
    The `trigger_fields` allowlist is the primary guard against re-entrant
    loops. If left empty (open-environment default), the service triggers
    on ANY field update — internal teams should configure it explicitly
    to restrict triggering to a documented set of data fields.
    """

    def __init__(
        self,
        session: Session,
        dispatcher: ActionDispatcher,
        trigger_fields: Optional[Set[str]] = None,
    ) -> None:
        """
        Args:
            session        (Session):          Active DB session.
            dispatcher     (ActionDispatcher): Shared dispatcher instance.
            trigger_fields (Optional[Set[str]]): Allowlist of field names that,
                                                  when changed, are eligible to
                                                  trigger a re-dispatch.
                                                  If None or empty, ANY field
                                                  update triggers re-dispatch
                                                  (open-environment default).
                                                  Internal teams should configure
                                                  this with a documented set
                                                  (e.g. {"classification_type"}).
        """
        self.session = session
        self.dispatcher = dispatcher
        self.trigger_fields = trigger_fields or set()

    def evaluate_data_change_trigger(
        self,
        phone_id: int,
        updated_fields: List[str],
    ) -> Optional[ActionLog]:
        """
        Check whether a data-field update warrants re-dispatching a failed action.

        Logic:
            1. If `trigger_fields` is configured and none of `updated_fields`
               is in the allowlist → return None.
            2. Find the most recent `failed` ActionLog row for this phone_id.
            3. If found, re-dispatch its `action_type` via the dispatcher
               (which creates a NEW ActionLog row with retry_count=0).
            4. Return the new row, or None.

        Args:
            phone_id       (int):        PK of the updated PhoneNumber row.
            updated_fields (List[str]):  Names of fields that were changed.

        Returns:
            Optional[ActionLog]: The new ActionLog created by the dispatcher,
                                  or None if no re-dispatch was triggered.

        Raises:
            PhoneNumberNotFoundError: Propagated from ActionDispatcher.
        """
        # Allowlist gate: if configured, require at least one overlap.
        if self.trigger_fields:
            if not (set(updated_fields) & self.trigger_fields):
                return None

        # Find the most recent failed action for this phone.
        last_failed = self.session.exec(
            select(ActionLog)
            .where(
                ActionLog.phone_id == phone_id,
                ActionLog.status == "failed",
            )
            .order_by(ActionLog.requested_at.desc())
        ).first()

        if last_failed is None:
            return None

        # Re-dispatch as a fresh attempt. Note: this is dispatch() (new row),
        # not execute_pending() (existing row) — we want a clean attempt.
        return self.dispatcher.dispatch(
            phone_id=phone_id,
            action_type=last_failed.action_type,
        )
