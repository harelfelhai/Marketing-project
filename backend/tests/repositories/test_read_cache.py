"""
test_read_cache.py — version-invalidated read cache behaviour.

Proves the cache that backs the unified read-model:
    - serves a repeated read from memory (same object, no recompute)
    - invalidates EXACTLY when a write advances the data version
    - can be bypassed via settings.read_cache_enabled
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from config import settings
from models.entity import Entity
from repositories import cache
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


def test_repeated_read_is_served_from_cache(svc, storage):
    storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                extra_data={"first_name": "A"}))
    first = svc.list_clients()
    second = svc.list_clients()
    # Identity: the second call returned the very same cached object.
    assert first is second


def test_write_invalidates_cache(svc, storage):
    a = storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                    extra_data={"first_name": "A"}))
    before = svc.list_clients()
    assert len(before) == 1
    # A new client write advances the data version → cache must recompute.
    storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                extra_data={"first_name": "B"}))
    after = svc.list_clients()
    assert after is not before
    assert len(after) == 2


def test_version_advances_on_write(storage):
    v0 = cache.current_data_version()
    storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                extra_data={}))
    assert cache.current_data_version() == v0 + 1


def test_cache_can_be_disabled(svc, storage, monkeypatch):
    monkeypatch.setattr(settings, "read_cache_enabled", False)
    storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                extra_data={"first_name": "A"}))
    first = svc.list_clients()
    second = svc.list_clients()
    # Bypassed → recomputed each call (distinct objects), still correct.
    assert first is not second
    assert first == second
