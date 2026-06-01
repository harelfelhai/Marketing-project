"""
test_storage_factory.py — Phase C/D: the storage-backend selector wiring.

Proves that `dependencies.get_storage` returns the backend the System
Settings file selects:
    - 'sql'   → SqlStorage (default)
    - 'mongo' → MongoStorage, bound to the injected (mongomock) database

The Mongo runtime client itself (pymongo → a real mongod) is a deployment
concern that can't run here; the factory-selection logic is what this test
pins, using the `set_mongo_database` test seam.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
import dependencies
from repositories.mongo_connection import set_mongo_database
from repositories.storage import MongoStorage, SqlStorage
from services.system_settings import SystemSettingsService


@pytest.fixture()
def sql_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


@pytest.fixture(autouse=True)
def _reset_backend_cache():
    # The factory caches the resolved backend per process; clear it around
    # each test so the monkeypatched settings file is re-read.
    dependencies._active_storage_backend = None
    yield
    dependencies._active_storage_backend = None
    set_mongo_database(None)


def _point_settings_at(tmp_path, backend, monkeypatch):
    svc = SystemSettingsService(path=str(tmp_path / "system_settings.json"))
    svc.set_storage_backend(backend)
    monkeypatch.setattr(dependencies.settings, "system_settings_path",
                        str(tmp_path / "system_settings.json"))


def test_defaults_to_sql(tmp_path, monkeypatch, sql_session):
    _point_settings_at(tmp_path, "sql", monkeypatch)
    storage = dependencies.get_storage(session=sql_session)
    assert isinstance(storage.entities, type(SqlStorage(sql_session).entities))


def test_mongo_selected_returns_mongo_storage(tmp_path, monkeypatch, sql_session):
    _point_settings_at(tmp_path, "mongo", monkeypatch)
    # Inject an in-memory Mongo so no real mongod is needed.
    set_mongo_database(mongomock.MongoClient()["test"])

    storage = dependencies.get_storage(session=sql_session)
    # It must be a Mongo-backed bundle, and it must actually work.
    from repositories.mongo_repository import MongoRepository
    assert isinstance(storage.entities, MongoRepository)

    from models.entity import Entity
    ent = storage.entities.add(Entity(entity_type="target", target_entity_id=None,
                                      extra_data={"first_name": "Mongo"}))
    assert storage.entities.get(ent.id).extra_data["first_name"] == "Mongo"


def test_backend_choice_is_cached_until_reset(tmp_path, monkeypatch, sql_session):
    _point_settings_at(tmp_path, "sql", monkeypatch)
    assert isinstance(dependencies.get_storage(session=sql_session), type(SqlStorage(sql_session)))
    # Flip the file to mongo — but the cached process value stays 'sql'
    # (the documented "applies on restart" contract).
    SystemSettingsService(path=str(tmp_path / "system_settings.json")).set_storage_backend("mongo")
    storage = dependencies.get_storage(session=sql_session)
    from repositories.mongo_repository import MongoRepository
    assert not isinstance(storage.entities, MongoRepository)  # still SQL
