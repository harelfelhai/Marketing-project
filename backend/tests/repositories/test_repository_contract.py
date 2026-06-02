"""
test_repository_contract.py — one contract, two backends.

Every assertion here runs TWICE: once against SqlRepository (in-memory
SQLite) and once against MongoRepository (in-memory mongomock). If a
behaviour diverges between the backends, this suite fails — that is the
guarantee that lets the System Settings storage-backend switch be safe.

The Entity aggregate is used as the probe because it exercises the core
cross-backend features: PK round-trips, filter DSL, updates.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.types import not_deleted
from repositories.mongo_repository import MongoRepository
from repositories.sql_repository import SqlRepository


@pytest.fixture(params=["sql", "mongo"])
def repo(request):
    if request.param == "sql":
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield SqlRepository(session, Entity)
    else:
        collection = mongomock.MongoClient()["test"]["entity"]
        yield MongoRepository(collection, Entity)


def _root(**extra):
    return Entity(
        relation_type="primary",
        target_entity_id=None,
        deleted_at=not_deleted(),
        extra_data=extra or {},
    )


def _member(root_id, relation_type="family", **extra):
    return Entity(
        relation_type=relation_type,
        target_entity_id=root_id,
        deleted_at=not_deleted(),
        extra_data=extra or {},
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


class TestCrud:
    def test_add_then_get_round_trips(self, repo):
        ent = _root(some_key="value")
        repo.add(ent)
        fetched = repo.get(ent.id)
        assert fetched is not None
        assert fetched.id == ent.id
        assert fetched.relation_type == "primary"
        assert fetched.extra_data["some_key"] == "value"

    def test_get_missing_returns_none(self, repo):
        assert repo.get("does-not-exist") is None

    def test_update_persists_mutation(self, repo):
        ent = _root(name="Alpha")
        repo.add(ent)
        ent.full_name = "Alpha Updated"
        ent.identifier_1 = "ID-001"
        repo.update(ent)
        again = repo.get(ent.id)
        assert again.full_name == "Alpha Updated"
        assert again.identifier_1 == "ID-001"

    def test_delete_removes(self, repo):
        ent = _root()
        repo.add(ent)
        repo.delete(ent.id)
        assert repo.get(ent.id) is None


# ---------------------------------------------------------------------------
# Filter DSL
# ---------------------------------------------------------------------------


class TestFilters:
    def test_eq_and_is_null(self, repo):
        root = _root()
        repo.add(root)
        member = _member(root.id)
        repo.add(member)
        roots = repo.list({"target_entity_id": None})
        assert {e.id for e in roots} == {root.id}

    def test_in_membership(self, repo):
        a = _root()
        b = _root()
        c = _root()
        for e in (a, b, c):
            repo.add(e)
        out = repo.list({"id": {"in": [a.id, c.id]}})
        assert {e.id for e in out} == {a.id, c.id}

    def test_ne_on_relation_type(self, repo):
        root = _root()
        repo.add(root)
        member = _member(root.id, relation_type="friend")
        repo.add(member)
        out = repo.list({"relation_type": {"ne": "primary"}})
        assert {e.id for e in out} == {member.id}

    def test_count_matches_list(self, repo):
        root = _root()
        repo.add(root)
        for _ in range(3):
            repo.add(_member(root.id))
        assert repo.count({"relation_type": "family"}) == 3
        assert repo.count() == 4

    def test_target_entity_id_filter(self, repo):
        root = _root()
        repo.add(root)
        m1 = _member(root.id)
        m2 = _member(root.id, relation_type="friend")
        repo.add(m1)
        repo.add(m2)
        out = repo.list({"target_entity_id": root.id})
        assert {e.id for e in out} == {m1.id, m2.id}


# ---------------------------------------------------------------------------
# Filter DSL — dotted JSON (extra_data) paths
# ---------------------------------------------------------------------------


class TestExtraDataFilters:
    """A dotted field addresses a key inside the extra_data JSON column.

    These must behave identically on SQL (JSON_EXTRACT) and Mongo (native
    dot-path), which is the whole point of routing them through the DSL.
    """

    def test_eq_on_extra_data_key(self, repo):
        north = _root(region="north")
        south = _root(region="south")
        repo.add(north)
        repo.add(south)
        out = repo.list({"extra_data.region": "north"})
        assert {e.id for e in out} == {north.id}

    def test_contains_on_extra_data_key(self, repo):
        a = _root(batch="Q3-2026-export")
        b = _root(batch="Q4-2026-export")
        repo.add(a)
        repo.add(b)
        out = repo.list({"extra_data.batch": {"contains": "Q3"}})
        assert {e.id for e in out} == {a.id}

    def test_in_on_extra_data_key(self, repo):
        a = _root(tier="gold")
        b = _root(tier="silver")
        c = _root(tier="bronze")
        for e in (a, b, c):
            repo.add(e)
        out = repo.list({"extra_data.tier": {"in": ["gold", "bronze"]}})
        assert {e.id for e in out} == {a.id, c.id}

    def test_missing_key_does_not_match(self, repo):
        has = _root(region="north")
        missing = _root(other="x")
        repo.add(has)
        repo.add(missing)
        out = repo.list({"extra_data.region": "north"})
        assert {e.id for e in out} == {has.id}
