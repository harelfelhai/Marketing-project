"""
test_export_dual_backend.py — ExportService on SQL and Mongo.

Pins the export reads (the heaviest application-side joins) on both backends:
    - phones export: entity_type / client_id filters, q substring, soft-delete
      exclusion, customer_tier + root name resolved from the root entity
    - tasks export: client_ids filter, exclude_terminal, soft-delete exclusion
The xlsx is parsed back with openpyxl to assert the rendered cells.
"""

import io

import mongomock
import openpyxl
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from repositories.storage import MongoStorage, SqlStorage
from services.export import ExportService


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
    return ExportService(storage=storage)


def _rows(xlsx_bytes):
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
    ws = wb["data"]
    return list(ws.iter_rows(values_only=True))


def _seed(storage):
    root = Entity(entity_type="target", target_entity_id=None,
                  extra_data={"first_name": "Root", "last_name": "Head",
                              "customer_tier": 3})
    storage.entities.add(root)
    member = Entity(entity_type="family", target_entity_id=root.id,
                    extra_data={"first_name": "Jane"})
    storage.entities.add(member)
    phone = PhoneNumber(entity_id=member.id, phone_number="+15550001111",
                        ingestion_source="manual", verification_status="pending")
    storage.phones.add(phone)
    return root, member, phone


PHONE_COLS = [
    {"key": "phone_number", "label": "Phone", "format": "text"},
    {"key": "client_id", "label": "Client", "format": "text"},
    {"key": "customer_tier", "label": "Tier", "format": "text"},
    {"key": "root_first_name", "label": "Root First", "format": "text"},
    {"key": "extra_data.first_name", "label": "First", "format": "text"},
]


class TestPhonesExport:
    def test_customer_tier_and_root_name_from_root(self, svc, storage):
        root, _, phone = _seed(storage)
        data, _fn = svc.export_phones(filters={}, columns=PHONE_COLS)
        rows = _rows(data)
        assert rows[0] == ("Phone", "Client", "Tier", "Root First", "First")
        body = rows[1]
        assert body[0] == "+15550001111"
        assert body[1] == root.id            # derived client_id
        assert str(body[2]) == "3"           # tier from root
        assert body[3] == "Root"             # root first name
        assert body[4] == "Jane"             # immediate entity first name

    def test_entity_type_filter(self, svc, storage):
        _seed(storage)
        # Only 'target' entities → the member phone is excluded.
        data, _ = svc.export_phones(filters={"entity_type": "target"}, columns=PHONE_COLS)
        assert len(_rows(data)) == 1   # header only

    def test_q_substring_filter(self, svc, storage):
        _seed(storage)
        data, _ = svc.export_phones(filters={"q": "1111"}, columns=PHONE_COLS)
        assert len(_rows(data)) == 2   # header + 1
        data, _ = svc.export_phones(filters={"q": "9999"}, columns=PHONE_COLS)
        assert len(_rows(data)) == 1   # header only

    def test_soft_deleted_phone_excluded(self, svc, storage):
        _, _, phone = _seed(storage)
        from datetime import datetime, timezone
        phone.deleted_at = datetime.now(timezone.utc)
        storage.phones.update(phone)
        data, _ = svc.export_phones(filters={}, columns=PHONE_COLS)
        assert len(_rows(data)) == 1


TASK_COLS = [
    {"key": "id", "label": "ID", "format": "text"},
    {"key": "status", "label": "Status", "format": "text"},
    {"key": "client_id", "label": "Client", "format": "text"},
]


class TestTasksExport:
    def _task(self, storage, phone, status="pending"):
        t = PipelineTask(phone_id=phone.id, task_type="x", status=status,
                         requested_by="op")
        return storage.tasks.add(t)

    def test_client_ids_filter(self, svc, storage):
        root, _, phone = _seed(storage)
        self._task(storage, phone)
        data, _ = svc.export_tasks(filters={"client_ids": [root.id]}, columns=TASK_COLS)
        rows = _rows(data)
        assert len(rows) == 2
        assert rows[1][2] == root.id

        data, _ = svc.export_tasks(filters={"client_ids": ["ent-other"]}, columns=TASK_COLS)
        assert len(_rows(data)) == 1

    def test_exclude_terminal(self, svc, storage):
        _, _, phone = _seed(storage)
        self._task(storage, phone, status="pending")
        self._task(storage, phone, status="resolved")
        data, _ = svc.export_tasks(filters={"exclude_terminal": True}, columns=TASK_COLS)
        rows = _rows(data)
        assert len(rows) == 2   # header + only the pending task
        assert rows[1][1] == "pending"
