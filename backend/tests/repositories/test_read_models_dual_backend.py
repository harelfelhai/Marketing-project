"""
test_read_models_dual_backend.py — the unified client read-model on SQL and Mongo.

Proves the "person + their phones" projection assembles identically on both
backends: root + members grouped, all phones attached, per-root metrics,
soft-delete exclusion.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from repositories.storage import MongoStorage, SqlStorage
from services.read_models import ClientReadModelService


@pytest.fixture(params=["sql", "mongo"])
def storage(request):
    if request.param == "sql":
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                               poolclass=StaticPool)
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield SqlStorage(session)
    else:
        yield MongoStorage(mongomock.MongoClient()["test"])


@pytest.fixture()
def svc(storage):
    return ClientReadModelService(storage=storage)


def _root(storage, *, full_name, n_members=0, n_phones_on_root=1):
    root = storage.entities.add(Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name=full_name,
        deleted_at=not_deleted(),
    ))
    for i in range(n_phones_on_root):
        storage.phones.add(PhoneNumber(
            entity_id=root.id,
            phone_number=f"+1555{root.id[:5]}{i}root",
            ingestion_source="manual",
            score=0.0,
            verification_status="pending",
            deleted_at=not_deleted(),
        ))
    members = []
    for m in range(n_members):
        mem = storage.entities.add(Entity(
            relation_type="family",
            target_entity_id=root.id,
            full_name=f"{full_name}-m{m}",
            deleted_at=not_deleted(),
        ))
        members.append(mem)
        storage.phones.add(PhoneNumber(
            entity_id=mem.id,
            phone_number=f"+1555{mem.id[:5]}{m}mem",
            ingestion_source="manual",
            score=0.8,
            verification_status="verified",
            deleted_at=not_deleted(),
        ))
    return root, members


class TestListClients:
    def test_groups_root_members_and_phones(self, svc, storage):
        root, members = _root(storage, full_name="Alpha", n_members=2, n_phones_on_root=1)
        clients = svc.list_clients()
        assert len(clients) == 1
        c = clients[0]
        assert c["root_entity_id"] == root.id
        assert c["root"]["full_name"] == "Alpha"
        assert len(c["members"]) == 2
        # 1 root phone + 2 member phones = 3.
        assert len(c["phones"]) == 3
        assert c["metrics"]["total"] == 3
        assert c["metrics"]["pending"] == 1   # the root phone
        assert c["metrics"]["verified"] == 2  # the member phones

    def test_two_roots_are_separate_aggregates(self, svc, storage):
        a, _ = _root(storage, full_name="A", n_members=1)
        b, _ = _root(storage, full_name="B", n_members=0)
        clients = svc.list_clients()
        ids = {c["root_entity_id"] for c in clients}
        assert ids == {a.id, b.id}

    def test_client_ids_filter(self, svc, storage):
        a, _ = _root(storage, full_name="A")
        b, _ = _root(storage, full_name="B")
        out = svc.list_clients(root_entity_ids=[a.id])
        assert [c["root_entity_id"] for c in out] == [a.id]

    def test_soft_deleted_excluded_by_default(self, svc, storage):
        root, members = _root(storage, full_name="A", n_members=1)
        # Soft-delete one member + its phone.
        mem = members[0]
        from datetime import datetime, timezone
        mem.deleted_at = datetime.now(timezone.utc)
        storage.entities.update(mem)
        c = svc.list_clients()[0]
        assert len(c["members"]) == 0         # deleted member gone
        # Only the root's phone remains (member's entity soft-deleted).
        assert all(p["entity_id"] == root.id for p in c["phones"])


class TestGetClient:
    def test_returns_single_aggregate(self, svc, storage):
        root, _ = _root(storage, full_name="A", n_members=1)
        c = svc.get_client(root.id)
        assert c is not None
        assert c["root_entity_id"] == root.id

    def test_unknown_client_returns_none(self, svc):
        assert svc.get_client("ent-nope") is None
