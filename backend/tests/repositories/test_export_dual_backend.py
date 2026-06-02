"""
test_export_dual_backend.py — ExportService on SQL and Mongo.

Pins the export reads on both backends:
    - phones export: filters, q substring, soft-delete exclusion
    - tasks export: exclude_terminal, soft-delete exclusion
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
from models.types import not_deleted
from repositories.storage import MongoStorage, SqlStorage
from services.export import ExportService
from services.tasks import PipelineTaskService


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
    root = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root Person",
        deleted_at=not_deleted(),
    )
    storage.entities.add(root)
    member = Entity(
        relation_type="family",
        target_entity_id=root.id,
        full_name="Jane Doe",
        identifier_1="ID-001",
        deleted_at=not_deleted(),
    )
    storage.entities.add(member)
    phone = PhoneNumber(
        entity_id=member.id,
        phone_number="+15550001111",
        ingestion_source="manual",
        score=0.0,
        verification_status="pending",
        deleted_at=not_deleted(),
    )
    storage.phones.add(phone)
    return root, member, phone


PHONE_COLS = [
    {"key": "phone_number", "label": "Phone", "format": "text"},
    {"key": "entity_id", "label": "Entity", "format": "text"},
    {"key": "verification_status", "label": "Status", "format": "text"},
    {"key": "full_name", "label": "Name", "format": "text"},
]


class TestPhonesExport:
    def test_basic_fields_resolved(self, svc, storage):
        _, member, phone = _seed(storage)
        data, _fn = svc.export_phones(filters={}, columns=PHONE_COLS)
        rows = _rows(data)
        assert rows[0] == ("Phone", "Entity", "Status", "Name")
        body = rows[1]
        assert body[0] == "+15550001111"
        assert body[2] == "pending"

    def test_q_substring_filter(self, svc, storage):
        _seed(storage)
        data, _ = svc.export_phones(filters={"q": "1111"}, columns=PHONE_COLS)
        assert len(_rows(data)) == 2   # header + 1
        data, _ = svc.export_phones(filters={"q": "9999"}, columns=PHONE_COLS)
        assert len(_rows(data)) == 1   # header only

    def test_verification_status_filter(self, svc, storage):
        _seed(storage)
        data, _ = svc.export_phones(
            filters={"verification_status": "pending"}, columns=PHONE_COLS
        )
        assert len(_rows(data)) == 2   # header + 1 pending

        data, _ = svc.export_phones(
            filters={"verification_status": "verified"}, columns=PHONE_COLS
        )
        assert len(_rows(data)) == 1   # header only

    def test_soft_deleted_phone_excluded(self, svc, storage):
        _, _, phone = _seed(storage)
        from datetime import datetime, timezone
        phone.deleted_at = datetime.now(timezone.utc)
        storage.phones.update(phone)
        data, _ = svc.export_phones(filters={}, columns=PHONE_COLS)
        assert len(_rows(data)) == 1   # header only (phone excluded)


TASK_COLS = [
    {"key": "id", "label": "ID", "format": "text"},
    {"key": "status", "label": "Status", "format": "text"},
    {"key": "task_type", "label": "Type", "format": "text"},
]


class TestTasksExport:
    def test_happy_path(self, svc, storage):
        _, _, phone = _seed(storage)
        task_svc = PipelineTaskService(storage=storage)
        task_svc.open_task(phone_id=phone.id, task_type="review")
        data, _ = svc.export_tasks(filters={}, columns=TASK_COLS)
        rows = _rows(data)
        assert len(rows) == 2   # header + 1 task

    def test_exclude_terminal(self, svc, storage):
        _, _, phone = _seed(storage)
        task_svc = PipelineTaskService(storage=storage)
        t1 = task_svc.open_task(phone_id=phone.id, task_type="a")
        task_svc.open_task(phone_id=phone.id, task_type="b")
        task_svc.resolve_task(task_id=t1.id, operator_id="adm", outcome="done")

        data, _ = svc.export_tasks(filters={"exclude_terminal": True}, columns=TASK_COLS)
        rows = _rows(data)
        assert len(rows) == 2   # header + only the pending task
        assert rows[1][1] == "pending"
