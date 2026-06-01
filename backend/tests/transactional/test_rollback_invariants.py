"""
Transactional integrity tests.

These tests force failures mid-operation and assert that the database is
left in a clean, consistent state — no orphan rows, no half-written data.
"""

from sqlmodel import select
from sqlalchemy.exc import IntegrityError
import pytest

from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from schemas.ingestion import IngestionPayload
from services.dispatcher import ActionDispatcher
from services.ingestion import IngestionService
from services.tasks import PipelineTaskService

from tests.conftest import RecordingHandler, RoutingEngineReturning


def _build_service(session, routing=None):
    from repositories.storage import SqlStorage
    dispatcher = ActionDispatcher(
        session=session, handlers={}, default_handler=RecordingHandler(),
    )
    return IngestionService(
        storage=SqlStorage(session),
        routing_engine=routing or RoutingEngineReturning(action_token=None),
        dispatcher=dispatcher,
    )


class TestUniqueViolationRollback:
    def test_duplicate_phone_number_does_not_orphan_entity(
        self, session, seeded_target
    ):
        """
        If the PhoneNumber INSERT violates the UNIQUE constraint, the
        Entity INSERT in the same transaction must also be rolled back —
        no orphan circle-of-trust Entity should remain.
        """
        entities_before = session.exec(select(Entity)).all()
        svc = _build_service(session)

        # Try to ingest a phone number that already exists.
        with pytest.raises(IntegrityError):
            svc.ingest_circle_member(IngestionPayload(
                phone_number=seeded_target.phone_number,  # duplicate
                entity_type="family",
                target_phone_number=seeded_target.phone_number,
                ingestion_source="manual",
            ))

        # SQLAlchemy needs an explicit rollback after IntegrityError to clear state.
        session.rollback()

        entities_after = session.exec(select(Entity)).all()
        assert len(entities_after) == len(entities_before), (
            "Orphan Entity row was created — atomicity violated."
        )


class TestForeignKeyEnforcement:
    def test_fk_enforced_on_sqlite(self, session):
        """
        SQLite must enforce foreign keys (we enabled the PRAGMA).
        Inserting a PhoneNumber with a non-existent entity_id should fail.
        """
        bad = PhoneNumber(
            entity_id=99999,  # no such Entity
            phone_number="+15558888888",
            ingestion_source="manual",
        )
        session.add(bad)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


class TestPostCommitDispatchFailureSemantics:
    def test_ingestion_persists_when_dispatcher_raises(self, session, seeded_target):
        """
        Documented at-least-once semantics: if the immediate dispatch fails,
        the Entity + PhoneNumber are still committed and visible.
        """
        # Routing returns a token but the dispatcher has no handler at all.
        # The dispatcher will raise ValueError after persisting the failed log.
        dispatcher = ActionDispatcher(
            session=session, handlers={}, default_handler=None,
        )
        from repositories.storage import SqlStorage
        svc = IngestionService(
            storage=SqlStorage(session),
            routing_engine=RoutingEngineReturning(action_token="adv_a"),
            dispatcher=dispatcher,
        )

        with pytest.raises(ValueError):
            svc.ingest_circle_member(IngestionPayload(
                phone_number="+15553333333",
                entity_type="family",
                target_phone_number=seeded_target.phone_number,
                ingestion_source="manual",
            ))

        # The new PhoneNumber + Entity must still exist (ingestion authoritative).
        new_phone = session.exec(
            select(PhoneNumber).where(PhoneNumber.phone_number == "+15553333333")
        ).first()
        assert new_phone is not None, (
            "Ingestion was lost despite documented at-least-once semantics."
        )


# ===========================================================================
# Phase DX — PipelineTask atomicity & rollback
# ===========================================================================


class TestPipelineTaskAtomicity:
    """
    Atomicity invariants for `PipelineTaskService` writes.

    Each test forces a failure mid-operation and asserts that the database
    is left in the state it was in before the call — no partial writes, no
    orphan rows.
    """

    def test_open_task_unknown_phone_writes_nothing(self, session):
        """
        Validation failure on phone_id must not insert any pipeline_task row,
        even though the service constructs the model instance before the
        session.add() call.
        """
        before = session.exec(select(PipelineTask)).all()
        svc = PipelineTaskService(session=session)

        with pytest.raises(Exception):
            svc.open_task(
                phone_id=99999,
                task_type="approval_required",
                requested_by="op",
            )
        session.rollback()

        after = session.exec(select(PipelineTask)).all()
        assert len(after) == len(before), (
            "PipelineTask row was created despite phone_id validation failure."
        )

    def test_open_task_cross_phone_source_log_writes_nothing(
        self, session, seeded_target
    ):
        """
        `source_action_log_id` belongs to a different phone than `phone_id`:
        the cross-FK validation must abort BEFORE any row is inserted.
        """
        # Seed a second phone + an ActionLog attached to it.
        other_entity = Entity(entity_type="target", extra_data={})
        session.add(other_entity)
        session.flush()
        other_phone = PhoneNumber(
            entity_id=other_entity.id,
            phone_number="+15559998888",
            ingestion_source="manual",
        )
        session.add(other_phone)
        session.flush()
        other_log = ActionLog(
            phone_id=other_phone.id,
            action_type="action_type_a",
            status="failed",
        )
        session.add(other_log)
        session.commit()

        tasks_before = session.exec(select(PipelineTask)).all()
        svc = PipelineTaskService(session=session)

        with pytest.raises(ValueError, match="belongs to phone_id"):
            svc.open_task(
                phone_id=seeded_target.id,   # mismatched on purpose
                task_type="remediation_failure",
                requested_by="op",
                source_action_log_id=other_log.id,
            )

        tasks_after = session.exec(select(PipelineTask)).all()
        assert len(tasks_after) == len(tasks_before), (
            "Cross-phone source_action_log validation leaked a partial task row."
        )

    def test_resolve_blocked_terminal_task_preserves_original_state(
        self, session, seeded_target
    ):
        """
        A blocked resolve (TaskStateTransitionError) must NOT mutate any
        of the four resolution fields (status / resolved_by / resolved_at /
        extra_data). The first resolver's attribution stays intact.
        """
        svc = PipelineTaskService(session=session)
        task = svc.open_task(
            phone_id=seeded_target.id,
            task_type="approval_required",
            requested_by="op",
        )
        # First resolve succeeds.
        svc.resolve_task(
            task_id=task.id,
            operator_id="first_admin",
            outcome="resolved",
            resolution_note="ok",
        )

        # Capture the post-resolve snapshot we will compare against.
        session.expire_all()
        before = session.get(PipelineTask, task.id)
        before_snapshot = {
            "status":      before.status,
            "resolved_by": before.resolved_by,
            "resolved_at": before.resolved_at,
            "extra_data":  dict(before.extra_data or {}),
        }

        # Second resolve is blocked.
        with pytest.raises(Exception):
            svc.resolve_task(
                task_id=task.id,
                operator_id="second_admin",
                outcome="rejected",
                resolution_note="overwrite attempt",
            )

        session.expire_all()
        after = session.get(PipelineTask, task.id)
        assert after.status      == before_snapshot["status"]
        assert after.resolved_by == before_snapshot["resolved_by"]
        assert after.resolved_at == before_snapshot["resolved_at"]
        assert after.extra_data  == before_snapshot["extra_data"], (
            "Blocked resolve leaked partial extra_data mutation."
        )


# ===========================================================================
# Phase DY — ScoringService transaction-boundary invariants
# ===========================================================================


class TestScoringTransactionBoundary:
    """
    Atomicity contract for the Phase DY recalculation hooks.

    Three properties to assert:
      1. When VerificationService is wired with a scoring service, a
         successful verdict commits BOTH the verdict and the new
         priority in one transaction.
      2. If the scoring strategy RAISES inside the verdict transaction,
         the verdict itself does NOT commit (rollback is honoured —
         no half-written state where the verdict is visible but the
         priority is stale).
      3. ScoringService.update_confidence_and_recalc with commit=False
         leaves the row pending in-session; the caller's outer commit
         lands both writes.
    """

    def _scoring(self, session):
        from modules.mock_scoring import ScoringStrategy
        from services.scoring import ScoringService
        return ScoringService(session=session, strategy=ScoringStrategy())

    def _verification(self, session, scoring=None):
        from services.verification import VerificationService
        return VerificationService(session=session, scoring_service=scoring)

    def test_verdict_and_priority_commit_atomically(self, session, seeded_target):
        scoring = self._scoring(session)
        vs = self._verification(session, scoring=scoring)

        # Baseline: scoring has never run on this row.
        assert seeded_target.priority_score == 0.0
        assert seeded_target.priority_updated_at is None

        vs.update_verification_verdict(
            phone_id=seeded_target.id,
            status="verified_good",
            source="manual",
            reason="ok",
        )

        # Re-read from a fresh identity-map view — both verdict AND
        # priority must be visible.
        session.expire_all()
        reloaded = session.get(PhoneNumber, seeded_target.id)
        assert reloaded.verification_status == "verified_good"
        assert reloaded.priority_score > 0.0  # was recalculated
        assert reloaded.priority_updated_at is not None

    def test_scoring_failure_rolls_back_verdict(self, session, seeded_target):
        """
        If the strategy raises mid-verdict, the verdict write must NOT
        commit — verification_status stays at its prior value. This is
        the same-transaction guarantee that protects against
        verdict-without-priority drift.
        """
        from interfaces.scoring import BaseScoringStrategy
        from services.scoring import ScoringService

        class ExplodingStrategy(BaseScoringStrategy):
            def compute_priority(self, confidence_score, relation_type, customer_tier):
                raise RuntimeError("simulated strategy failure")

        scoring = ScoringService(session=session, strategy=ExplodingStrategy())
        vs = self._verification(session, scoring=scoring)

        original_status = seeded_target.verification_status
        with pytest.raises(RuntimeError):
            vs.update_verification_verdict(
                phone_id=seeded_target.id,
                status="verified_good",
                source="manual",
                reason="ok",
            )
        session.rollback()

        # Verdict is NOT applied — the in-flight write was rolled back.
        session.expire_all()
        reloaded = session.get(PhoneNumber, seeded_target.id)
        assert reloaded.verification_status == original_status

    def test_update_confidence_commit_false_is_rollback_safe(
        self, session, seeded_target
    ):
        """
        commit=False contract — the caller owns the commit boundary.
        Asserting this via rollback is more meaningful than asserting
        the raw row state pre-commit, because SQLAlchemy autoflushes
        pending changes to the connection on every query (the value
        IS written, just inside an uncommitted transaction). What we
        actually care about is: rollback reverts cleanly.
        """
        scoring = self._scoring(session)
        scoring.update_confidence_and_recalc(
            phone_id=seeded_target.id,
            new_confidence=90.0,
            commit=False,
        )
        # In-session view shows the new value.
        session.refresh(seeded_target)
        assert seeded_target.confidence_score == 90.0

        # Rollback reverts both the confidence and the priority writes.
        session.rollback()
        session.expire_all()
        reloaded = session.get(PhoneNumber, seeded_target.id)
        assert reloaded.confidence_score == 50.0  # column default
        assert reloaded.priority_score   == 0.0   # column default
        # And the timestamps are unchanged (still NULL).
        assert reloaded.confidence_updated_at is None
        assert reloaded.priority_updated_at   is None
