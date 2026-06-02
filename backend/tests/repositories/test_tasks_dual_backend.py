"""
test_tasks_dual_backend.py — PipelineTaskService on SQL and Mongo.

Pins the task lifecycle + the application-side JOIN on both backends:
    - open_task validation (phone exists)
    - resolve_task terminal-state guard
    - bulk_resolve_tasks partial success
    - list_tasks_with_join: soft-deleted phone/entity hidden,
      q substring, pagination + total
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import PhoneNumberNotFoundError, TaskStateTransitionError
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from repositories.storage import MongoStorage, SqlStorage
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
    return PipelineTaskService(storage=storage)


def _seed_phone(storage, *, number="+15550000001"):
    root = Entity(relation_type="primary", target_entity_id=None,
                  full_name="Root Person", deleted_at=not_deleted())
    storage.entities.add(root)
    phone = PhoneNumber(entity_id=root.id, phone_number=number,
                        ingestion_source="manual", score=0.0,
                        verification_status="pending", deleted_at=not_deleted())
    storage.phones.add(phone)
    return root, phone


class TestOpenTask:
    def test_happy_path(self, svc, storage):
        _, phone = _seed_phone(storage)
        task = svc.open_task(phone_id=phone.id, task_type="review")
        assert task.status == "pending"
        assert task.phone_id == phone.id
        assert task.phone_number == phone.phone_number
        assert task.entity_id == phone.entity_id

    def test_unknown_phone_raises(self, svc):
        with pytest.raises(PhoneNumberNotFoundError):
            svc.open_task(phone_id="ph-nope", task_type="review")


class TestResolve:
    def test_resolve_settles(self, svc, storage):
        _, phone = _seed_phone(storage)
        task = svc.open_task(phone_id=phone.id, task_type="review")
        out = svc.resolve_task(task.id, operator_id="admin", outcome="done",
                               resolution_note="looks good")
        assert out.status == "done"
        assert out.extra_data["resolution_outcome"] == "done"
        assert out.extra_data["resolved_by"] == "admin"
        assert out.extra_data["resolution_note"] == "looks good"

    def test_double_resolve_blocked(self, svc, storage):
        _, phone = _seed_phone(storage)
        task = svc.open_task(phone_id=phone.id, task_type="review")
        svc.resolve_task(task.id, operator_id="admin", outcome="done")
        with pytest.raises(TaskStateTransitionError):
            svc.resolve_task(task.id, operator_id="admin", outcome="rejected")

    def test_bulk_resolve_partial_success(self, svc, storage):
        _, phone = _seed_phone(storage)
        t1 = svc.open_task(phone_id=phone.id, task_type="review")
        t2 = svc.open_task(phone_id=phone.id, task_type="review")
        svc.resolve_task(t2.id, operator_id="admin", outcome="done")  # already terminal
        summary = svc.bulk_resolve_tasks(
            task_ids=[t1.id, t2.id, "task-missing"],
            operator_id="admin", outcome="done",
        )
        assert summary["success_count"] == 1
        assert summary["success_ids"] == [t1.id]
        assert summary["failed_count"] == 2


class TestListJoin:
    def test_join_stitches_entity_fields(self, svc, storage):
        root, phone = _seed_phone(storage)
        svc.open_task(phone_id=phone.id, task_type="review")
        rows, total = svc.list_tasks_with_join()
        assert total == 1
        _task, full_name, identifier_1, identifier_2 = rows[0]
        assert _task.phone_number == phone.phone_number
        assert full_name == root.full_name

    def test_q_substring_matches_phone_number(self, svc, storage):
        _, phone_a = _seed_phone(storage, number="+15550001111")
        _, phone_b = _seed_phone(storage, number="+15550002222")
        svc.open_task(phone_id=phone_a.id, task_type="review")
        svc.open_task(phone_id=phone_b.id, task_type="review")
        rows, total = svc.list_tasks_with_join(q="1111")
        assert total == 1
        assert rows[0][0].phone_number == "+15550001111"

    def test_exclude_terminal(self, svc, storage):
        _, phone = _seed_phone(storage)
        t1 = svc.open_task(phone_id=phone.id, task_type="review")
        t2 = svc.open_task(phone_id=phone.id, task_type="review")
        svc.resolve_task(t2.id, operator_id="admin", outcome="done")
        rows, total = svc.list_tasks_with_join(exclude_terminal=True)
        assert total == 1
        assert rows[0][0].id == t1.id

    def test_pagination_total_is_pre_page(self, svc, storage):
        _, phone = _seed_phone(storage)
        for _ in range(5):
            svc.open_task(phone_id=phone.id, task_type="review")
        rows, total = svc.list_tasks_with_join(page=1, page_size=2)
        assert total == 5
        assert len(rows) == 2
