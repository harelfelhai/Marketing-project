"""
test_read_models_dual_backend.py — the unified client read-model on SQL and Mongo.

Proves the "person + their phones" projection assembles identically on both
backends: root + members grouped by derived client_id, all circle phones
attached, per-client metrics, soft-delete exclusion, and the client_ids filter.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
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


def _client(storage, *, first_name, tier=None, n_members=0, n_phones_on_root=1):
    extra = {"first_name": first_name}
    if tier is not None:
        extra["customer_tier"] = tier
    root = storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                       extra_data=extra))
    for i in range(n_phones_on_root):
        storage.phones.add(PhoneNumber(
            entity_id=root.id, phone_number=f"+1555{root.id[:6]}{i}root",
            ingestion_source="manual", verification_status="pending"))
    members = []
    for m in range(n_members):
        mem = storage.entities.add(Entity(entity_type="family", target_entity_id=root.id,
                                          extra_data={"first_name": f"{first_name}-m{m}"}))
        members.append(mem)
        storage.phones.add(PhoneNumber(
            entity_id=mem.id, phone_number=f"+1555{mem.id[:6]}{m}mem",
            ingestion_source="manual", verification_status="verified_good"))
    return root, members


class TestListClients:
    def test_groups_root_members_and_phones(self, svc, storage):
        root, members = _client(storage, first_name="Alpha", tier=2,
                                 n_members=2, n_phones_on_root=1)
        clients = svc.list_clients()
        assert len(clients) == 1
        c = clients[0]
        assert c["client_id"] == root.id
        assert c["root"]["extra_data"]["first_name"] == "Alpha"
        assert len(c["members"]) == 2
        # 1 root phone + 2 member phones = 3.
        assert len(c["phones"]) == 3
        assert c["metrics"]["total"] == 3
        assert c["metrics"]["pending"] == 1   # the root phone
        assert c["metrics"]["good"] == 2      # the member phones

    def test_customer_tier_resolved_from_root(self, svc, storage):
        root, members = _client(storage, first_name="Beta", tier=3, n_members=1)
        c = svc.list_clients()[0]
        # Every phone in the circle carries the root's tier.
        assert {p["customer_tier"] for p in c["phones"]} == {3}

    def test_two_clients_are_separate_aggregates(self, svc, storage):
        a, _ = _client(storage, first_name="A", n_members=1)
        b, _ = _client(storage, first_name="B", n_members=0)
        clients = svc.list_clients()
        ids = {c["client_id"] for c in clients}
        assert ids == {a.id, b.id}

    def test_client_ids_filter(self, svc, storage):
        a, _ = _client(storage, first_name="A")
        b, _ = _client(storage, first_name="B")
        out = svc.list_clients(client_ids=[a.id])
        assert [c["client_id"] for c in out] == [a.id]

    def test_soft_deleted_excluded_by_default(self, svc, storage):
        root, members = _client(storage, first_name="A", n_members=1)
        # Soft-delete one member + its phone.
        mem = members[0]
        from datetime import datetime, timezone
        mem.deleted_at = datetime.now(timezone.utc)
        storage.entities.update(mem)
        c = svc.list_clients()[0]
        assert len(c["members"]) == 0          # deleted member gone
        # Only the root's phone remains (member's phone's owner is gone).
        assert all(p["entity_id"] == root.id for p in c["phones"])


class TestGetClient:
    def test_returns_single_aggregate(self, svc, storage):
        root, _ = _client(storage, first_name="A", n_members=1)
        c = svc.get_client(root.id)
        assert c is not None
        assert c["client_id"] == root.id

    def test_unknown_client_returns_none(self, svc):
        assert svc.get_client("ent-nope") is None
