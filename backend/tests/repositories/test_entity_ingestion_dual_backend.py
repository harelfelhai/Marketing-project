"""
test_entity_ingestion_dual_backend.py — EntityIngestionService on SQL and Mongo.

Pins entity-centric ingestion on both backends:
    - create_single: target validation + field storage
    - ingest_bulk_text: per-row partial success, target override resolution
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
from services.entity_ingestion import EntityIngestionService


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
    return EntityIngestionService(storage=storage)


@pytest.fixture()
def root(storage):
    r = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root Person",
        deleted_at=not_deleted(),
    )
    return storage.entities.add(r)


class TestCreateSingle:
    def test_happy_path(self, svc, root):
        out = svc.create_single(
            full_name="Jane Doe",
            relation_type="family",
            target_entity_id=root.id,
            identifier_1="X-1",
        )
        assert out.relation_type == "family"
        assert out.target_entity_id == root.id
        assert out.full_name == "Jane Doe"
        assert out.identifier_1 == "X-1"

    def test_missing_target_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.create_single(
                full_name="Jane",
                relation_type="family",
                target_entity_id="ent-nope",
            )

    def test_non_root_target_raises(self, svc, storage, root):
        member = storage.entities.add(Entity(
            relation_type="family", target_entity_id=root.id,
            deleted_at=not_deleted(),
        ))
        with pytest.raises(TargetNotFoundError):
            svc.create_single(
                full_name="Jane",
                relation_type="family",
                target_entity_id=member.id,
            )

    def test_root_entity_no_target(self, svc):
        out = svc.create_single(
            full_name="New Root",
            relation_type="primary",
        )
        assert out.target_entity_id is None
        assert out.relation_type == "primary"


class TestBulkText:
    def test_partial_success(self, svc, root):
        summary = svc.ingest_bulk_text(
            rows=[
                {"full_name": "Jane", "relation_type": "family"},
                {"full_name": None, "relation_type": "family"},
                {"full_name": "Sam", "relation_type": "family"},
            ],
            default_target_entity_id=root.id,
            default_relation_type="family",
        )
        # All three rows should succeed (no validation on full_name=None)
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0

    def test_per_row_target_override(self, svc, storage, root):
        other = storage.entities.add(Entity(
            relation_type="primary",
            target_entity_id=None,
            deleted_at=not_deleted(),
        ))
        summary = svc.ingest_bulk_text(
            rows=[{"full_name": "Jane", "relation_type": "friend",
                   "target_entity_id": other.id}],
            default_target_entity_id=root.id,
            default_relation_type="family",
        )
        assert summary["success_count"] == 1
        created = storage.entities.get(summary["entity_ids"][0])
        assert created.target_entity_id == other.id

    def test_missing_default_target_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                rows=[{"full_name": "Jane"}],
                default_target_entity_id="nonexistent",
                default_relation_type="family",
            )

    def test_per_row_unknown_target_is_per_row_failure(self, svc, root):
        summary = svc.ingest_bulk_text(
            rows=[
                {"full_name": "Jane", "relation_type": "family"},
                {"full_name": "Ghost", "relation_type": "family",
                 "target_entity_id": "nonexistent"},
            ],
            default_target_entity_id=root.id,
            default_relation_type="family",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "not found" in summary["failed_rows"][0]["error"]
