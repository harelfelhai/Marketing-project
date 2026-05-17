"""
Transactional integrity tests.

These tests force failures mid-operation and assert that the database is
left in a clean, consistent state — no orphan rows, no half-written data.
"""

from sqlmodel import select
from sqlalchemy.exc import IntegrityError
import pytest

from models.entity import Entity
from models.phone_number import PhoneNumber
from schemas.ingestion import IngestionPayload
from services.dispatcher import ActionDispatcher
from services.ingestion import IngestionService

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
