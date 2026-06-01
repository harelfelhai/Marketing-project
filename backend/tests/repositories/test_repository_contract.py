"""
test_repository_contract.py — one contract, two backends.

Every assertion here runs TWICE: once against SqlRepository (in-memory
SQLite) and once against MongoRepository (in-memory mongomock). If a
behaviour diverges between the backends, this suite fails — that is the
guarantee that lets the System Settings storage-backend switch be safe.

The Entity aggregate is used as the probe because it exercises the hardest
cross-backend feature: the DERIVED `client_id` (= COALESCE(target_entity_id,
id)), resolved via a SQL hybrid on one side and a denormalised document
field on the other.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401  — registers table metadata
from models.entity import Entity
from repositories.mongo_repository import MongoRepository
from repositories.sql_repository import SqlRepository


# ---------------------------------------------------------------------------
# Both backends behind one fixture
# ---------------------------------------------------------------------------


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
    return Entity(entity_type="target", target_entity_id=None, extra_data=extra or {})


def _member(root_id, entity_type="family", **extra):
    return Entity(entity_type=entity_type, target_entity_id=root_id, extra_data=extra or {})


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


class TestCrud:
    def test_add_then_get_round_trips(self, repo):
        ent = _root(first_name="Alpha")
        repo.add(ent)
        fetched = repo.get(ent.id)
        assert fetched is not None
        assert fetched.id == ent.id
        assert fetched.entity_type == "target"
        assert fetched.extra_data["first_name"] == "Alpha"

    def test_get_missing_returns_none(self, repo):
        assert repo.get("does-not-exist") is None

    def test_update_persists_mutation(self, repo):
        ent = _root(first_name="Alpha")
        repo.add(ent)
        ent.extra_data = {**ent.extra_data, "first_name": "Alpha2"}
        ent.strong_identifier = "X-1"
        repo.update(ent)
        again = repo.get(ent.id)
        assert again.extra_data["first_name"] == "Alpha2"
        assert again.strong_identifier == "X-1"

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
        root = _root(); repo.add(root)
        member = _member(root.id); repo.add(member)
        roots = repo.list({"target_entity_id": None})
        assert {e.id for e in roots} == {root.id}

    def test_in_membership(self, repo):
        a = _root(); b = _root(); c = _root()
        for e in (a, b, c):
            repo.add(e)
        out = repo.list({"id": {"in": [a.id, c.id]}})
        assert {e.id for e in out} == {a.id, c.id}

    def test_ne(self, repo):
        root = _root(); repo.add(root)
        member = _member(root.id, entity_type="friend"); repo.add(member)
        out = repo.list({"entity_type": {"ne": "target"}})
        assert {e.id for e in out} == {member.id}

    def test_contains_is_case_insensitive(self, repo):
        a = _root(); a.strong_identifier = "ABC-123"; repo.add(a)
        b = _root(); b.strong_identifier = "ZZ-999"; repo.add(b)
        out = repo.list({"strong_identifier": {"contains": "abc"}})
        assert {e.id for e in out} == {a.id}

    def test_count_matches_list(self, repo):
        root = _root(); repo.add(root)
        for _ in range(3):
            repo.add(_member(root.id))
        assert repo.count({"entity_type": "family"}) == 3
        assert repo.count() == 4


# ---------------------------------------------------------------------------
# The derived client_id — identical on both backends
# ---------------------------------------------------------------------------


class TestDerivedClientId:
    def test_root_client_id_is_own_id(self, repo):
        root = _root(); repo.add(root)
        assert repo.get(root.id).client_id == root.id

    def test_member_client_id_is_root_id(self, repo):
        root = _root(); repo.add(root)
        member = _member(root.id); repo.add(member)
        assert repo.get(member.id).client_id == root.id

    def test_filter_by_client_id_returns_whole_family(self, repo):
        root = _root(); repo.add(root)
        m1 = _member(root.id); repo.add(m1)
        m2 = _member(root.id, entity_type="friend"); repo.add(m2)
        other = _root(); repo.add(other)
        out = repo.list({"client_id": root.id})
        assert {e.id for e in out} == {root.id, m1.id, m2.id}
