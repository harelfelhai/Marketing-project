"""Service-layer tests for VerificationEngine."""

from datetime import datetime, timedelta

from freezegun import freeze_time

from interfaces.verification import BaseVerificationStrategy
from models.action_log import ActionLog
from schemas.verification import VerificationVerdict
from services.verification import VerificationEngine, VerificationService

from tests.conftest import StrategyReturning


def _seed_phone_with_sent_action(session, target, sent_at):
    """Helper: seed an ActionLog with status=sent at the given executed_at."""
    log = ActionLog(
        phone_id=target.id,
        action_type="adv_a",
        status="sent",
        executed_at=sent_at,
    )
    session.add(log)
    session.commit()
    return log


def _make_engine(session, strategy=None, window_days=7):
    return VerificationEngine(
        session=session,
        strategy=strategy or StrategyReturning(
            VerificationVerdict(status="verified_good", reason="ok"),
        ),
        verification_service=VerificationService(session=session),
        verification_window_days=window_days,
    )


class TestEligibility:
    def test_eligible_when_last_sent_older_than_window(self, session, seeded_target):
        _seed_phone_with_sent_action(
            session, seeded_target, sent_at=datetime.utcnow() - timedelta(days=10),
        )
        engine = _make_engine(session, window_days=7)
        assert engine.process_eligible_numbers() == 1
        session.refresh(seeded_target)
        assert seeded_target.verification_status == "verified_good"

    def test_not_eligible_when_last_sent_inside_window(self, session, seeded_target):
        _seed_phone_with_sent_action(
            session, seeded_target, sent_at=datetime.utcnow() - timedelta(days=2),
        )
        engine = _make_engine(session, window_days=7)
        assert engine.process_eligible_numbers() == 0

    def test_not_eligible_when_no_sent_actions(self, session, seeded_target):
        # Only a failed action, no "sent".
        session.add(ActionLog(
            phone_id=seeded_target.id, action_type="a",
            status="failed", executed_at=datetime.utcnow() - timedelta(days=30),
        ))
        session.commit()

        engine = _make_engine(session, window_days=7)
        assert engine.process_eligible_numbers() == 0

    def test_not_eligible_when_already_verified(self, session, seeded_target):
        _seed_phone_with_sent_action(
            session, seeded_target, sent_at=datetime.utcnow() - timedelta(days=10),
        )
        seeded_target.verification_status = "verified_good"
        session.add(seeded_target)
        session.commit()

        engine = _make_engine(session, window_days=7)
        # Not pending → not eligible.
        assert engine.process_eligible_numbers() == 0


class TestStrategyVerdictApplied:
    def test_strategy_verdict_persisted(self, session, seeded_target):
        _seed_phone_with_sent_action(
            session, seeded_target, sent_at=datetime.utcnow() - timedelta(days=10),
        )
        strategy = StrategyReturning(
            VerificationVerdict(
                status="verified_bad",
                reason="3 failures in 7 days",
                metadata={"score": 0.1},
            ),
        )
        engine = _make_engine(session, strategy=strategy)
        engine.process_eligible_numbers()
        session.refresh(seeded_target)
        assert seeded_target.verification_status == "verified_bad"
        assert seeded_target.verification_reason == "3 failures in 7 days"
        assert seeded_target.extra_data["score"] == 0.1


class TestBatchResilience:
    def test_strategy_exception_does_not_abort_batch(self, session):
        """One bad strategy call must not stop processing of other phones."""
        from models.entity import Entity
        from models.phone_number import PhoneNumber

        # Seed two targets, both eligible.
        for n in ("+15550000010", "+15550000011"):
            e = Entity(entity_type="target")
            session.add(e)
            session.flush()
            p = PhoneNumber(
                entity_id=e.id, phone_number=n,
                ingestion_source="manual",
            )
            session.add(p)
            session.flush()
            session.add(ActionLog(
                phone_id=p.id, action_type="a",
                status="sent",
                executed_at=datetime.utcnow() - timedelta(days=10),
            ))
        session.commit()

        # Strategy raises on the first call, succeeds on the second.
        class FlakyStrategy(BaseVerificationStrategy):
            def __init__(self):
                self.n = 0
            def evaluate_quality(self, phone_id):
                self.n += 1
                if self.n == 1:
                    raise RuntimeError("transient failure")
                return VerificationVerdict(status="verified_good", reason="ok")

        engine = _make_engine(session, strategy=FlakyStrategy())
        # 2 eligible, 1 succeeds despite the other raising.
        assert engine.process_eligible_numbers() == 1


class TestWindowBoundary:
    def test_exactly_at_boundary_is_eligible(self, session, seeded_target):
        """Equal-to-cutoff means eligible (we use <=)."""
        with freeze_time("2026-01-15 12:00:00"):
            _seed_phone_with_sent_action(
                session, seeded_target,
                sent_at=datetime(2026, 1, 8, 12, 0, 0),  # exactly 7 days ago
            )
            engine = _make_engine(session, window_days=7)
            assert engine.process_eligible_numbers() == 1
