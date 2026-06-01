"""
test_bulk_ingestion_dual_backend.py — BulkIngestionService on SQL and Mongo.

Pins the phone bulk-ingestion resilience contract on both backends:
    - bulk-text: tokenize + per-row validation + within-batch dedup +
      duplicate-against-DB pre-check (no orphan), shared envelope entity
    - bulk-upload (CSV): per-row entity+phone, per-row target validation,
      duplicate phone leaves no orphan entity
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
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
    return BulkIngestionService(storage=storage)   # no scoring hook


class TestBulkText:
    def test_happy_path_creates_one_entity_and_n_phones(self, svc, storage):
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="+15550001111, +15550002222, +15550003333",
            client_id="ent-x", entity_type="target", ingestion_source="manual",
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert len(summary["entity_ids"]) == 1   # one shared envelope entity
        assert len(summary["phone_ids"]) == 3

    def test_within_batch_duplicate_flagged(self, svc):
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="+15550001111 +15550001111",
            client_id="ent-x", entity_type="target", ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "Duplicate of row" in summary["failed_rows"][0]["error"]

    def test_invalid_format_flagged(self, svc):
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="not-a-phone, +15550001111",
            client_id="ent-x", entity_type="target", ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1

    def test_duplicate_against_existing_db_row(self, svc, storage):
        # Pre-seed a phone, then a batch trying to re-add it.
        ent = storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                           extra_data={}))
        storage.phones.add(PhoneNumber(entity_id=ent.id, phone_number="+15550001111",
                                       ingestion_source="manual"))
        summary = svc.ingest_bulk_text(
            phone_numbers_raw="+15550001111, +15550009999",
            client_id="ent-x", entity_type="target", ingestion_source="manual",
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["error"] == "Already exists in the system"


def _csv(rows):
    header = ",".join(BULK_UPLOAD_REQUIRED_COLUMNS)  # phone_number,client_id,entity_type,ingestion_source
    body = "\n".join(",".join(str(c) for c in r) for r in rows)
    return (header + "\n" + body).encode("utf-8")


class TestBulkUpload:
    def test_csv_happy_path(self, svc):
        data = _csv([
            ["+15550001111", "ent-a", "target", "manual"],
            ["+15550002222", "ent-b", "target", "manual"],
        ])
        summary = svc.ingest_bulk_upload(data, "phones.csv")
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0

    def test_duplicate_phone_leaves_no_orphan_entity(self, svc, storage):
        ent = storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                          extra_data={}))
        storage.phones.add(PhoneNumber(entity_id=ent.id, phone_number="+15550001111",
                                       ingestion_source="manual"))
        entities_before = len(storage.entities.list())
        data = _csv([["+15550001111", "ent-a", "target", "manual"]])
        summary = svc.ingest_bulk_upload(data, "phones.csv")
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 1
        # The duplicate row must NOT have created an orphan entity.
        assert len(storage.entities.list()) == entities_before
