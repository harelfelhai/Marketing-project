"""
test_ingestion_dual_backend.py — IngestionService on SQL and Mongo.

Pins the quick_attach_phone path on both backends:
    - happy path: entity found + phone created
    - missing entity: TargetNotFoundError
    - soft-deleted entity: TargetNotFoundError
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import TargetNotFoundError
from models.entity import Entity
from models.types import not_deleted
from repositories.storage import MongoStorage, SqlStorage
from services.ingestion import IngestionService


@pytest.fixture(params=["sql", "mongo"])
def storage(request):
    if request.param == "sql":
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield SqlStorage(session)
    else:
        database = mongomock.MongoClient()["test"]
        yield MongoStorage(database)


@pytest.fixture()
def svc(storage):
    return IngestionService(storage=storage)


@pytest.fixture()
def entity(storage):
    ent = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root Person",
        deleted_at=not_deleted(),
    )
    return storage.entities.add(ent)


class TestQuickAttachPhone:
    def test_happy_path(self, svc, entity):
        out = svc.quick_attach_phone(
            phone_number="+15550001234",
            entity_id=entity.id,
            ingestion_source="manual",
        )
        assert out.phone_number == "+15550001234"
        assert out.entity_id == entity.id

    def test_missing_entity_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15550009999",
                entity_id="ent-does-not-exist",
            )

    def test_soft_deleted_entity_rejected(self, svc, storage, entity):
        from datetime import datetime, timezone
        entity.deleted_at = datetime.now(timezone.utc)
        storage.entities.update(entity)
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15550009999",
                entity_id=entity.id,
            )
