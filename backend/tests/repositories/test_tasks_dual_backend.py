"""
test_tasks_dual_backend.py — PipelineTaskService on SQL and Mongo.

Pins the task lifecycle + the application-side JOIN on both backends:
    - open_task validation (phone exists; source_action_log belongs to phone)
    - resolve_task terminal-state guard
    - bulk_resolve_tasks partial success
    - list_tasks_with_join: soft-deleted phone/entity hidden, client_ids filter,
      q substring, pagination + total, derived client_id stitched in
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import PhoneNumberNotFoundError, TaskStateTransitionError
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
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


def _seed_phone(storage, *, number="+15550000001", client_tier=2, member=True):
    root = Entity(entity_type="target", target_entity_id=None,
                  extra_data={"first_name": "Root", "customer_tier": client_tier})
    storage.entities.add(root)
    owner = root
    if member:
        owner = Entity(entity_type="family", target_entity_id=root.id,
                       extra_data={"first_name": "Jane"})
        storage.entities.add(owner)
    phone = PhoneNumber(entity_id=owner.id, phone_number=number,
                        ingestion_source="manual", verification_status="pending")
    storage.phones.add(phone)
    return root, owner, phone


class TestOpenTask:
    def test_happy_path(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        task = svc.open_task(phone_id=phone.id, task_type="approval_required",
                             requested_by="op")
        assert task.status == "pending"
        assert task.phone_id == phone.id

    def test_unknown_phone_raises(self, svc):
        with pytest.raises(PhoneNumberNotFoundError):
            svc.open_task(phone_id="ph-nope", task_type="x", requested_by="op")

    def test_cross_phone_source_log_raises(self, svc, storage):
        _, _, phone_a = _seed_phone(storage, number="+15550000001")
        _, _, phone_b = _seed_phone(storage, number="+15550000002")
        log_b = ActionLog(phone_id=phone_b.id, action_type="action_type_a",
                          status="failed")
        storage.action_logs.add(log_b)
        with pytest.raises(ValueError, match="belongs to phone_id"):
            svc.open_task(phone_id=phone_a.id, task_type="remediation_failure",
                          requested_by="op", source_action_log_id=log_b.id)


class TestResolve:
    def test_resolve_settles(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        task = svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        out = svc.resolve_task(task.id, operator_id="admin", outcome="resolved",
                               resolution_note="done")
        assert out.status == "resolved"
        assert out.resolved_by == "admin"
        assert out.extra_data["resolution_note"] == "done"

    def test_double_resolve_blocked(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        task = svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        svc.resolve_task(task.id, operator_id="admin", outcome="resolved")
        with pytest.raises(TaskStateTransitionError):
            svc.resolve_task(task.id, operator_id="admin", outcome="rejected")

    def test_bulk_resolve_partial_success(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        t1 = svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        t2 = svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        svc.resolve_task(t2.id, operator_id="admin", outcome="resolved")  # already terminal
        summary = svc.bulk_resolve_tasks(
            task_ids=[t1.id, t2.id, "task-missing"],
            operator_id="admin", outcome="resolved",
        )
        assert summary["success_count"] == 1
        assert summary["success_ids"] == [t1.id]
        assert summary["failed_count"] == 2


class TestListJoin:
    def test_join_stitches_derived_client_id(self, svc, storage):
        root, _, phone = _seed_phone(storage)
        svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        rows, total = svc.list_tasks_with_join()
        assert total == 1
        _task, phone_number, entity_id, entity_type, client_id = rows[0]
        assert phone_number == phone.phone_number
        assert entity_type == "family"
        assert client_id == root.id   # derived: member → root id

    def test_soft_deleted_phone_hides_task(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        from datetime import datetime, timezone
        phone.deleted_at = datetime.now(timezone.utc)
        storage.phones.update(phone)
        rows, total = svc.list_tasks_with_join()
        assert total == 0

    def test_client_ids_filter(self, svc, storage):
        root_a, _, phone_a = _seed_phone(storage, number="+15550000001")
        root_b, _, phone_b = _seed_phone(storage, number="+15550000002")
        svc.open_task(phone_id=phone_a.id, task_type="x", requested_by="op")
        svc.open_task(phone_id=phone_b.id, task_type="x", requested_by="op")
        rows, total = svc.list_tasks_with_join(client_ids=[root_a.id])
        assert total == 1
        assert rows[0][4] == root_a.id

    def test_q_substring_matches_phone_number(self, svc, storage):
        _, _, phone_a = _seed_phone(storage, number="+15550001111")
        _, _, phone_b = _seed_phone(storage, number="+15550002222")
        svc.open_task(phone_id=phone_a.id, task_type="x", requested_by="op")
        svc.open_task(phone_id=phone_b.id, task_type="x", requested_by="op")
        rows, total = svc.list_tasks_with_join(q="1111")
        assert total == 1
        assert rows[0][1] == "+15550001111"

    def test_exclude_terminal(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        t1 = svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        t2 = svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        svc.resolve_task(t2.id, operator_id="admin", outcome="resolved")
        rows, total = svc.list_tasks_with_join(exclude_terminal=True)
        assert total == 1
        assert rows[0][0].id == t1.id

    def test_pagination_total_is_pre_page(self, svc, storage):
        _, _, phone = _seed_phone(storage)
        for _ in range(5):
            svc.open_task(phone_id=phone.id, task_type="x", requested_by="op")
        rows, total = svc.list_tasks_with_join(page=1, page_size=2)
        assert total == 5
        assert len(rows) == 2
