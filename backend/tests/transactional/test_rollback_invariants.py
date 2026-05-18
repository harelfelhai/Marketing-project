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
    dispatcher = ActionDispatcher(
        session=session, handlers={}, default_handler=RecordingHandler(),
    )
    return IngestionService(
        session=session,
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
        svc = IngestionService(
            session=session,
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
