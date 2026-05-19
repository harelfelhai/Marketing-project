"""Service-layer tests for RetryEngine."""

from datetime import datetime, timedelta

from freezegun import freeze_time
from sqlalchemy import update
from sqlmodel import select

from models.action_log import ActionLog
from services.dispatcher import ActionDispatcher, RetryEngine

from tests.conftest import FailingHandler, RecordingHandler


def _make_dispatcher_and_retry_engine(session, handler):
    dispatcher = ActionDispatcher(
        session=session,
        handlers={},
        default_handler=handler,
        max_retry_count=5,
        retry_backoff_seconds=60,
    )
    engine = RetryEngine(session=session, dispatcher=dispatcher)
    return dispatcher, engine


class TestEligibility:
    def test_picks_up_only_rows_past_retry_after(self, session, seeded_target):
        """Rows with retry_after > now must be skipped."""
        # Seed two rows: one ripe, one not.
        now = datetime.utcnow()
        ripe = ActionLog(
            phone_id=seeded_target.id, action_type="a",
            status="scheduled_retry", retry_count=1,
            retry_after=now - timedelta(minutes=1),
        )
        unripe = ActionLog(
            phone_id=seeded_target.id, action_type="a",
            status="scheduled_retry", retry_count=1,
            retry_after=now + timedelta(hours=1),
        )
        session.add_all([ripe, unripe])
        session.commit()

        # Set handler to succeed on the retry attempt.
        _, engine = _make_dispatcher_and_retry_engine(session, RecordingHandler())
        processed = engine.process_scheduled_retries()
        assert processed == 1
        session.refresh(ripe)
        session.refresh(unripe)
        assert ripe.status == "sent"
        assert unripe.status == "scheduled_retry"

    def test_skips_terminal_statuses(self, session, seeded_target):
        """Rows in 'sent' or 'failed' must never be picked up."""
        for status in ("sent", "failed", "pending"):
            log = ActionLog(
                phone_id=seeded_target.id, action_type="a",
                status=status, retry_count=2,
                retry_after=datetime.utcnow() - timedelta(hours=1),
            )
            session.add(log)
        session.commit()

        _, engine = _make_dispatcher_and_retry_engine(session, RecordingHandler())
        assert engine.process_scheduled_retries() == 0


class TestRowMutationSemantics:
    def test_retry_mutates_same_row_preserves_retry_count(self, session, seeded_target):
        """Retry must increment retry_count on the SAME row, not spawn a new one."""
        log = ActionLog(
            phone_id=seeded_target.id, action_type="a",
            status="scheduled_retry", retry_count=2,
            retry_after=datetime.utcnow() - timedelta(seconds=10),
        )
        session.add(log)
        session.commit()
        original_id = log.id

        # Handler still fails (retryable), so retry_count should go 2 → 3.
        _, engine = _make_dispatcher_and_retry_engine(
            session, FailingHandler(retryable=True)
        )
        engine.process_scheduled_retries()

        # Only one row total — the retry mutated the existing row.
        all_logs = session.exec(select(ActionLog)).all()
        assert len(all_logs) == 1
        assert all_logs[0].id == original_id
        assert all_logs[0].retry_count == 3


class TestAtomicClaim:
    def test_already_claimed_row_is_skipped(self, session, seeded_target):
        """
        Simulate the race: another worker flips status to 'retrying'
        between our SELECT and our atomic UPDATE. Our engine must skip it.
        """
        log = ActionLog(
            phone_id=seeded_target.id, action_type="a",
            status="scheduled_retry", retry_count=1,
            retry_after=datetime.utcnow() - timedelta(seconds=10),
        )
        session.add(log)
        session.commit()

        _, engine = _make_dispatcher_and_retry_engine(session, RecordingHandler())

        # Pre-empt: claim the row out from under the engine.
        session.execute(
            update(ActionLog)
            .where(ActionLog.id == log.id)
            .values(status="retrying")
        )
        session.commit()

        # Engine should attempt claim, find it already taken, return 0.
        processed = engine.process_scheduled_retries()
        assert processed == 0
        session.refresh(log)
        # Still in "retrying" — engine did not progress it.
        assert log.status == "retrying"


class TestTimeAdvance:
    def test_retry_eligible_only_after_time_passes(self, session, seeded_target):
        with freeze_time("2026-01-01 12:00:00"):
            log = ActionLog(
                phone_id=seeded_target.id, action_type="a",
                status="scheduled_retry", retry_count=1,
                retry_after=datetime(2026, 1, 1, 12, 5, 0),  # 5 min in future
            )
            session.add(log)
            session.commit()

            _, engine = _make_dispatcher_and_retry_engine(session, RecordingHandler())
            assert engine.process_scheduled_retries() == 0

        with freeze_time("2026-01-01 12:06:00"):  # past retry_after
            _, engine = _make_dispatcher_and_retry_engine(session, RecordingHandler())
            assert engine.process_scheduled_retries() == 1
