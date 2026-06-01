"""
test_entity_ingestion_dual_backend.py — EntityIngestionService on SQL and Mongo.

Pins person-centric ingestion on both backends:
    - create_single: target validation (root only) + name merge + strong_identifier
    - create_envelope: attaches a social_envelope to a client root
    - ingest_bulk_text: per-row partial success, target override resolution
    - ingest_bulk_upload: CSV parse + per-row insert + unknown-target failure
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import TargetNotFoundError
from models.entity import Entity
from repositories.storage import MongoStorage, SqlStorage
from services.entity_ingestion import BULK_ENTITY_ALL_COLUMNS, EntityIngestionService


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
    r = Entity(entity_type="target", target_entity_id=None,
               extra_data={"first_name": "Root"})
    return storage.entities.add(r)


class TestCreateSingle:
    def test_happy_path(self, svc, root):
        out = svc.create_single(
            first_name="Jane", last_name="Doe", relation_type="family",
            target_entity_id=root.id, strong_identifier="X-1",
        )
        assert out.entity_type == "family"
        assert out.target_entity_id == root.id
        assert out.client_id == root.id          # derived
        assert out.extra_data["first_name"] == "Jane"
        assert out.strong_identifier == "X-1"

    def test_missing_target_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.create_single(first_name="Jane", relation_type="family",
                              target_entity_id="ent-nope")

    def test_non_root_target_raises(self, svc, storage, root):
        member = storage.entities.add(Entity(
            entity_type="family", target_entity_id=root.id, extra_data={}))
        with pytest.raises(TargetNotFoundError):
            svc.create_single(first_name="Jane", relation_type="family",
                              target_entity_id=member.id)


class TestCreateEnvelope:
    def test_attaches_to_root(self, svc, root):
        env = svc.create_envelope(client_id=root.id)
        assert env.entity_type == "social_envelope"
        assert env.target_entity_id == root.id
        assert env.client_id == root.id

    def test_rejects_non_root(self, svc, storage, root):
        member = storage.entities.add(Entity(
            entity_type="family", target_entity_id=root.id, extra_data={}))
        with pytest.raises(TargetNotFoundError):
            svc.create_envelope(client_id=member.id)


class TestBulkText:
    def test_partial_success(self, svc, root):
        summary = svc.ingest_bulk_text(
            rows=[
                {"first_name": "Jane", "relation_type": "family"},
                {"first_name": "", "relation_type": "family"},        # bad
                {"first_name": "Sam", "relation_type": "not-a-rel"},  # bad
            ],
            default_target_entity_id=root.id,
            default_relation_type="family",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 2
        assert len(summary["entity_ids"]) == 1

    def test_per_row_target_override(self, svc, storage, root):
        other = storage.entities.add(Entity(
            entity_type="target", target_entity_id=None,
            extra_data={"first_name": "Other"}))
        summary = svc.ingest_bulk_text(
            rows=[{"first_name": "Jane", "relation_type": "friend",
                   "target_entity_id": other.id}],
            default_target_entity_id=root.id,
            default_relation_type="family",
        )
        assert summary["success_count"] == 1
        created = storage.entities.get(summary["entity_ids"][0])
        assert created.target_entity_id == other.id


def _csv(rows):
    header = ",".join(BULK_ENTITY_ALL_COLUMNS)
    body = "\n".join(",".join(str(c) for c in r) for r in rows)
    return (header + "\n" + body).encode("utf-8")


class TestBulkUpload:
    def test_csv_happy_path(self, svc, root):
        # columns: first_name, relation_type, target_entity_id, last_name
        data = _csv([
            ["Jane", "family", root.id, "Doe"],
            ["Sam", "friend", root.id, ""],
        ])
        summary = svc.ingest_bulk_upload(data, "people.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0

    def test_unknown_target_is_per_row_failure(self, svc, root):
        data = _csv([
            ["Jane", "family", root.id, "Doe"],
            ["Ghost", "family", "ent-nope", ""],
        ])
        summary = svc.ingest_bulk_upload(data, "people.csv")
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "not found" in summary["failed_rows"][0]["error"]
