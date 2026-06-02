"""
test_bulk_ingestion_dual_backend.py — BulkIngestionService on SQL and Mongo.

Pins the phone bulk-ingestion resilience contract on both backends:
    - bulk-text: tokenize + per-row validation + within-batch dedup +
      duplicate-against-DB pre-check
    - bulk-upload (CSV): per-row phone insertion with entity_id
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from repositories.storage import MongoStorage, SqlStorage
from services.bulk_ingestion import BulkIngestionService, BULK_UPLOAD_REQUIRED_COLUMNS


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
    return BulkIngestionService(storage=storage)


def _seed_entity(storage):
    ent = Entity(
        relation_type="primary",
        target_entity_id=None,
        deleted_at=not_deleted(),
    )
    return storage.entities.add(ent)


class TestBulkText:
    def test_happy_path_creates_n_phones(self, svc, storage):
        ent = _seed_entity(storage)
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="+15550001111, +15550002222, +15550003333",
            entity_id=ent.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert len(summary["phone_ids"]) == 3

    def test_within_batch_duplicate_flagged(self, svc, storage):
        ent = _seed_entity(storage)
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="+15550001111 +15550001111",
            entity_id=ent.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "Duplicate of row" in summary["failed_rows"][0]["error"]

    def test_invalid_format_flagged(self, svc, storage):
        ent = _seed_entity(storage)
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="not-a-phone, +15550001111",
            entity_id=ent.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1

    def test_duplicate_against_existing_db_row(self, svc, storage):
        ent = _seed_entity(storage)
        storage.phones.add(PhoneNumber(
            entity_id=ent.id, phone_number="+15550001111",
            ingestion_source="manual", score=0.0, deleted_at=not_deleted(),
        ))
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="+15550001111, +15550009999",
            entity_id=ent.id,
            ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["error"] == "Already exists in the system"

    def test_unknown_entity_id_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                phone_numbers_raw="+15550001111",
                entity_id="nonexistent",
                ingestion_source="manual",
            )


def _csv(rows):
    header = ",".join(BULK_UPLOAD_REQUIRED_COLUMNS)
    body = "\n".join(",".join(str(c) for c in r) for r in rows)
    return (header + "\n" + body).encode("utf-8")


class TestBulkUpload:
    def test_csv_happy_path(self, svc, storage):
        ent = _seed_entity(storage)
        data = _csv([
            ["+15550001111", ent.id, "manual"],
            ["+15550002222", ent.id, "manual"],
        ])
        summary = svc.ingest_bulk_upload(data, "phones.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0

    def test_duplicate_phone_handled_per_row(self, svc, storage):
        ent = _seed_entity(storage)
        storage.phones.add(PhoneNumber(
            entity_id=ent.id, phone_number="+15550001111",
            ingestion_source="manual", score=0.0, deleted_at=not_deleted(),
        ))
        data = _csv([["+15550001111", ent.id, "manual"]])
        summary = svc.ingest_bulk_upload(data, "phones.csv")
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 1
