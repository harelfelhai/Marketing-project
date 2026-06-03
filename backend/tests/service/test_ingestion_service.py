"""Service-layer tests for IngestionService.quick_attach_phone."""

import pytest

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from services.ingestion import IngestionService
from repositories.storage import SqlStorage


@pytest.fixture()
def svc(session):
    return IngestionService(storage=SqlStorage(session))


@pytest.fixture()
def entity(session):
    e = Entity(relation_type="primary", deleted_at=not_deleted())
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


class TestQuickAttachPhone:
    def test_creates_phone_attached_to_entity(self, svc, entity, session):
        phone = svc.quick_attach_phone(
            phone_number="+15552222222",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert phone.id is not None
        assert phone.phone_number == "+15552222222"
        assert phone.entity_id == entity.id
        assert phone.ingestion_source == "manual"

    def test_unknown_entity_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15552222222",
                entity_id="nonexistent-entity-id",
                ingestion_source="manual",
            )

    def test_deleted_entity_raises(self, svc, session):
        from datetime import datetime, timezone
        e = Entity(
            relation_type="primary",
            deleted_at=datetime(2020, 1, 1, tzinfo=timezone.utc),  # actually deleted
        )
        session.add(e)
        session.commit()
        session.refresh(e)
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15552222222",
                entity_id=e.id,
                ingestion_source="manual",
            )

    def test_no_entity_created_on_failure(self, svc, session):
        from sqlmodel import select
        before = session.exec(select(Entity)).all()
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15552222222",
                entity_id="nonexistent",
                ingestion_source="manual",
            )
        after = session.exec(select(Entity)).all()
        assert len(before) == len(after)
