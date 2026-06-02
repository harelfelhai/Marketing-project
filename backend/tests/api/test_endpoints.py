"""
tests/api/test_endpoints.py — Smoke tests for the simplified v1 API.

Uses FastAPI's TestClient with dependency overrides to point at an
in-memory SQLite database. Tests cover the key happy-path and error
paths for the current schema.
"""

import os
import secrets
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import models  # noqa: F401  — registers table metadata
from app.api.deps import (
    get_bulk_ingestion_service,
    get_entity_ingestion_service,
    get_ingestion_service,
    get_pipeline_task_service,
    get_system_settings_service,
    get_verification_service,
    get_storage,
)
from database import get_session
from main import app
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from models.user import Session as UserSession, User
from repositories.storage import SqlStorage
from services.auth import AuthService, hash_password
from services.bulk_ingestion import BulkIngestionService
from services.entity_ingestion import EntityIngestionService
from services.ingestion import IngestionService
from services.system_settings import SystemSettingsService
from services.tasks import PipelineTaskService
from services.verification import VerificationService


# ===========================================================================
# Test Infrastructure
# ===========================================================================


def _make_engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng, "connect")
    def _fks(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(eng)
    return eng


@pytest.fixture()
def client():
    """
    TestClient with all service deps overridden to use a fresh in-memory DB.
    """
    eng = _make_engine()
    test_session = Session(eng)
    storage = SqlStorage(test_session)

    ingestion_svc = IngestionService(storage=storage)
    verification_svc = VerificationService(storage=storage)
    task_svc = PipelineTaskService(storage=storage)
    bulk_svc = BulkIngestionService(storage=storage)
    entity_svc = EntityIngestionService(storage=storage)

    _settings_file = os.path.join(tempfile.mkdtemp(), "system_settings.json")

    # Override dependencies
    app.dependency_overrides[get_session] = lambda: test_session
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_ingestion_service] = lambda: ingestion_svc
    app.dependency_overrides[get_verification_service] = lambda: verification_svc
    app.dependency_overrides[get_pipeline_task_service] = lambda: task_svc
    app.dependency_overrides[get_bulk_ingestion_service] = lambda: bulk_svc
    app.dependency_overrides[get_entity_ingestion_service] = lambda: entity_svc
    app.dependency_overrides[get_system_settings_service] = (
        lambda: SystemSettingsService(path=_settings_file)
    )

    # Seed admin user + session
    admin_user = User(
        username="test_admin",
        password_hash=hash_password("test-password"),
        role="admin",
        active=True,
    )
    test_session.add(admin_user)
    test_session.commit()
    test_session.refresh(admin_user)
    admin_token = secrets.token_urlsafe(32)
    test_session.add(UserSession(token=admin_token, user_id=admin_user.id))
    test_session.commit()

    with TestClient(app) as tc:
        tc.cookies.set(AuthService.COOKIE_NAME, admin_token)
        yield tc, test_session

    app.dependency_overrides.clear()
    test_session.close()
    eng.dispose()


def _seed_entity_and_phone(session: Session) -> tuple:
    """Seed one Entity + one PhoneNumber. Returns (entity, phone)."""
    ent = Entity(relation_type="primary", deleted_at=not_deleted())
    session.add(ent)
    session.flush()
    phone = PhoneNumber(
        entity_id=ent.id,
        phone_number="+15550001111",
        ingestion_source="manual",
        score=0.0,
        deleted_at=not_deleted(),
    )
    session.add(phone)
    session.commit()
    session.refresh(ent)
    session.refresh(phone)
    return ent, phone


# ===========================================================================
# Phones — GET list
# ===========================================================================


class TestListPhones:
    def test_returns_empty_list_initially(self, client):
        tc, _ = client
        r = tc.get("/api/v1/phones")
        assert r.status_code == 200
        body = r.json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["page"] == 1

    def test_returns_seeded_phone(self, client):
        tc, session = client
        _seed_entity_and_phone(session)
        r = tc.get("/api/v1/phones")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["phone_number"] == "+15550001111"
        assert "verification_status" in item
        assert "score" in item

    def test_verification_status_filter(self, client):
        tc, session = client
        _seed_entity_and_phone(session)
        r = tc.get("/api/v1/phones", params={"verification_status": "pending"})
        assert r.status_code == 200
        assert r.json()["total"] == 1

        r = tc.get("/api/v1/phones", params={"verification_status": "verified"})
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_pagination_params_respected(self, client):
        tc, session = client
        _seed_entity_and_phone(session)
        r = tc.get("/api/v1/phones", params={"page": 2, "page_size": 10})
        assert r.status_code == 200
        body = r.json()
        assert body["page"] == 2
        assert body["items"] == []


# ===========================================================================
# Phones — GET detail
# ===========================================================================


class TestGetPhoneDetail:
    def test_returns_full_detail(self, client):
        tc, session = client
        _, phone = _seed_entity_and_phone(session)
        r = tc.get(f"/api/v1/phones/{phone.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == phone.id
        assert body["phone_number"] == "+15550001111"
        assert "entity" in body
        assert body["entity"]["id"] is not None

    def test_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.get("/api/v1/phones/nonexistent-id")
        assert r.status_code == 404


# ===========================================================================
# Phones — Quick attach
# ===========================================================================


class TestQuickAttach:
    def test_happy_path_returns_phone_dict(self, client):
        tc, session = client
        ent = Entity(relation_type="primary", deleted_at=not_deleted())
        session.add(ent)
        session.commit()
        session.refresh(ent)

        r = tc.post("/api/v1/phones/quick", json={
            "phone_number": "+15559998888",
            "entity_id": ent.id,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["phone_number"] == "+15559998888"
        assert body["entity_id"] == ent.id

    def test_unknown_entity_returns_422(self, client):
        tc, _ = client
        r = tc.post("/api/v1/phones/quick", json={
            "phone_number": "+15559998887",
            "entity_id": "nonexistent-entity",
        })
        assert r.status_code == 422


# ===========================================================================
# Dashboard metrics
# ===========================================================================


class TestDashboardMetrics:
    def test_returns_all_required_keys(self, client):
        tc, _ = client
        r = tc.get("/api/v1/dashboard/metrics")
        assert r.status_code == 200
        body = r.json()
        assert "total_phones" in body
        assert "phones_by_verification_status" in body
        assert "total_tasks" in body
        assert "tasks_by_status" in body

    def test_counts_reflect_seeded_data(self, client):
        tc, session = client
        _seed_entity_and_phone(session)
        r = tc.get("/api/v1/dashboard/metrics")
        assert r.status_code == 200
        body = r.json()
        assert body["total_phones"] == 1
        assert body["phones_by_verification_status"].get("pending") == 1


# ===========================================================================
# Tasks
# ===========================================================================


class TestPipelineTasks:
    def test_list_returns_empty_with_auth(self, client):
        tc, _ = client
        r = tc.get("/api/v1/tasks")
        assert r.status_code == 200
        body = r.json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_open_task_returns_201(self, client):
        tc, session = client
        _, phone = _seed_entity_and_phone(session)
        r = tc.post("/api/v1/tasks", json={
            "phone_id": phone.id,
            "task_type": "review",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["phone_id"] == phone.id
        assert body["task_type"] == "review"
        assert body["status"] == "pending"
        assert body["phone_number"] == "+15550001111"

    def test_open_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.post("/api/v1/tasks", json={
            "phone_id": "nonexistent",
            "task_type": "review",
        })
        assert r.status_code == 404

    def test_resolve_task(self, client):
        tc, session = client
        _, phone = _seed_entity_and_phone(session)
        open_r = tc.post("/api/v1/tasks", json={
            "phone_id": phone.id,
            "task_type": "review",
        })
        assert open_r.status_code == 201
        task_id = open_r.json()["id"]

        resolve_r = tc.post(f"/api/v1/tasks/{task_id}/resolve", json={
            "outcome": "done",
        })
        assert resolve_r.status_code == 200
        assert resolve_r.json()["status"] == "done"


# ===========================================================================
# System Settings
# ===========================================================================


class TestSystemSettings:
    def test_get_settings_returns_backends(self, client):
        tc, _ = client
        r = tc.get("/api/v1/system/settings")
        assert r.status_code == 200
        body = r.json()
        assert "storage_backend" in body
        assert "backends" in body
        assert "vocabularies" in body

    def test_get_vocabulary(self, client):
        tc, _ = client
        r = tc.get("/api/v1/system/settings/vocabulary/relation_types")
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "relation_types"
        assert isinstance(body["items"], list)
        assert "primary" in body["items"]

    def test_set_vocabulary(self, client):
        tc, _ = client
        r = tc.put("/api/v1/system/settings/vocabulary/phone_types", json={
            "items": ["mobile", "home", "custom_type"],
        })
        assert r.status_code == 200
        body = r.json()
        assert "custom_type" in body["items"]

    def test_invalid_vocabulary_name_returns_422(self, client):
        tc, _ = client
        r = tc.get("/api/v1/system/settings/vocabulary/nonexistent")
        assert r.status_code == 422


# ===========================================================================
# Entities
# ===========================================================================


class TestEntities:
    def test_list_returns_empty_initially(self, client):
        tc, _ = client
        r = tc.get("/api/v1/entities")
        assert r.status_code == 200
        body = r.json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_list_returns_seeded_entity(self, client):
        tc, session = client
        ent = Entity(relation_type="primary", full_name="Test Person", deleted_at=not_deleted())
        session.add(ent)
        session.commit()

        r = tc.get("/api/v1/entities")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["full_name"] == "Test Person"
