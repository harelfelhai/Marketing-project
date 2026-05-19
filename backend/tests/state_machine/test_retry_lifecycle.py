"""
State-machine validation: full retry lifecycle.

Walks an ActionLog row through:
    initial dispatch (fails retryable) →
    RetryEngine pickup (fails retryable) →
    RetryEngine pickup (succeeds) →
    terminal "sent"

Verifies retry_count, retry_after, and status transitions throughout.
Uses freezegun to advance time across retry_after boundaries.
"""

from datetime import datetime, timedelta

from freezegun import freeze_time
from sqlmodel import select

from exceptions import ActionExecutionError
from interfaces.dispatcher import BaseActionHandler
from models.action_log import ActionLog
from services.dispatcher import ActionDispatcher, RetryEngine


class FlakyHandler(BaseActionHandler):
    """Fails (retryable) on first N calls, then succeeds."""
    def __init__(self, fail_count: int):
        self.fail_count = fail_count
        self.n = 0

    def execute(self, phone_number: str, extra_data: dict) -> dict:
        self.n += 1
        if self.n <= self.fail_count:
            raise ActionExecutionError(
                action_type="test", phone_number=phone_number,
                retryable=True, detail=f"attempt {self.n} failed",
            )
        return {"succeeded_on_attempt": self.n}


def test_full_retry_lifecycle(session, seeded_target):
    handler = FlakyHandler(fail_count=2)
    dispatcher = ActionDispatcher(
        session=session, handlers={}, default_handler=handler,
        max_retry_count=5, retry_backoff_seconds=60,
    )
    retry_engine = RetryEngine(session=session, dispatcher=dispatcher)

    # T=0: initial dispatch fails retryable.
    with freeze_time("2026-01-01 00:00:00"):
        log = dispatcher.dispatch(seeded_target.id, "test")
    assert log.status == "scheduled_retry"
    assert log.retry_count == 1
    assert log.retry_after == datetime(2026, 1, 1, 0, 1, 0)  # +60s

    # T=+30s: retry not yet eligible.
    with freeze_time("2026-01-01 00:00:30"):
        processed = retry_engine.process_scheduled_retries()
    assert processed == 0
    session.refresh(log)
    assert log.status == "scheduled_retry"
    assert log.retry_count == 1

    # T=+90s: retry eligible — second failure, still retryable.
    with freeze_time("2026-01-01 00:01:30"):
        processed = retry_engine.process_scheduled_retries()
    assert processed == 1
    session.refresh(log)
    assert log.status == "scheduled_retry"
    assert log.retry_count == 2
    assert log.retry_after == datetime(2026, 1, 1, 0, 2, 30)  # +60s from new failure

    # T=+200s: third attempt — handler succeeds.
    with freeze_time("2026-01-01 00:03:20"):
        processed = retry_engine.process_scheduled_retries()
    assert processed == 1
    session.refresh(log)
    assert log.status == "sent"
    assert log.retry_count == 2  # unchanged on success
    assert log.extra_data == {"succeeded_on_attempt": 3}

    # Sanity: still only ONE row (retries mutate same row, don't spawn new).
    all_logs = session.exec(select(ActionLog)).all()
    assert len(all_logs) == 1


def test_retry_ceiling_terminates_loop(session, seeded_target):
    """After max_retry_count is hit, next retryable failure goes to 'failed'."""
    from tests.conftest import FailingHandler
    handler = FailingHandler(retryable=True, detail="forever failing")
    dispatcher = ActionDispatcher(
        session=session, handlers={}, default_handler=handler,
        max_retry_count=2, retry_backoff_seconds=10,
    )
    retry_engine = RetryEngine(session=session, dispatcher=dispatcher)

    with freeze_time("2026-01-01 00:00:00"):
        log = dispatcher.dispatch(seeded_target.id, "test")
    assert log.retry_count == 1
    assert log.status == "scheduled_retry"

    with freeze_time("2026-01-01 00:01:00"):
        retry_engine.process_scheduled_retries()
    session.refresh(log)
    assert log.retry_count == 2
    assert log.status == "scheduled_retry"

    with freeze_time("2026-01-01 00:02:00"):
        retry_engine.process_scheduled_retries()
    session.refresh(log)
    # retry_count was at the ceiling (2), so this failure becomes terminal.
    assert log.status == "failed"
