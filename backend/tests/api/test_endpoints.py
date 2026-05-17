"""
tests/api/test_endpoints.py — Integration tests for all 11 v1 API endpoints.

Uses FastAPI's TestClient (which wraps `httpx` + `requests`) with dependency
overrides to swap real DB sessions and service dependencies for test-scoped
in-memory SQLite and mock implementations.

Coverage goals per endpoint:
    - Happy-path response shape and status code.
    - Primary error path (404 / 409 / 422) with correct HTTP status.
    - Response model fields are present and correctly typed.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import models  # noqa: F401  — registers table metadata
from app.api.deps import (
    get_action_data_trigger_service,
    get_action_dispatcher,
    get_retry_engine,
    get_user_action_service,
    get_verification_engine,
    get_verification_service,
)
from app.api.deps import get_ingestion_service
from database import get_session
from exceptions import ActionExecutionError
from interfaces.dispatcher import BaseActionHandler
from interfaces.ingestion import BaseIngestionRoutingEngine
from interfaces.verification import BaseVerificationStrategy
from main import app
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from schemas.verification import VerificationVerdict
from services.dispatcher import (
    ActionDataTriggerService,
    ActionDispatcher,
    RetryEngine,
    UserActionService,
)
from services.ingestion import IngestionService
from services.verification import VerificationEngine, VerificationService


# ===========================================================================
# Test Infrastructure: in-memory DB + dependency overrides
# ===========================================================================


def _make_engine():
    # StaticPool forces all connections — including those spawned by TestClient's
    # background thread — to share a single SQLite in-memory connection.
    # Without this, each thread gets its own empty database and tables are invisible.
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


class _MockRoutingEngine(BaseIngestionRoutingEngine):
    def determine_immediate_action(self, phone_record):
        return None


class _MockHandler(BaseActionHandler):
    def execute(self, phone_number: str, extra_data: dict) -> dict:
        return {"mock": True}


class _MockVerificationStrategy(BaseVerificationStrategy):
    def evaluate_quality(self, phone_id: int) -> VerificationVerdict:
        return VerificationVerdict(status="verified_good", reason="mock ok")


@pytest.fixture()
def client():
    """
    TestClient with all service deps overridden to use a fresh in-memory DB.

    Each test that uses this fixture gets a completely isolated database with
    all tables created fresh. Dependency overrides are cleaned up after each test.
    """
    eng = _make_engine()
    test_session = Session(eng)

    handler = _MockHandler()
    dispatcher = ActionDispatcher(
        session=test_session,
        handlers={},
        default_handler=handler,
        max_retry_count=3,
        retry_backoff_seconds=60,
    )
    routing_engine = _MockRoutingEngine()
    ingestion_svc = IngestionService(
        session=test_session,
        routing_engine=routing_engine,
        dispatcher=dispatcher,
    )
    user_action_svc = UserActionService(session=test_session, dispatcher=dispatcher)
    trigger_svc = ActionDataTriggerService(session=test_session, dispatcher=dispatcher)
    verification_svc = VerificationService(session=test_session)
    retry_eng = RetryEngine(session=test_session, dispatcher=dispatcher)
    strategy = _MockVerificationStrategy()
    verification_eng = VerificationEngine(
        session=test_session,
        strategy=strategy,
        verification_service=verification_svc,
        verification_window_days=7,
    )

    # Override every dependency that touches the DB or external modules.
    app.dependency_overrides[get_session] = lambda: test_session
    app.dependency_overrides[get_ingestion_service] = lambda: ingestion_svc
    app.dependency_overrides[get_action_dispatcher] = lambda: dispatcher
    app.dependency_overrides[get_user_action_service] = lambda: user_action_svc
    app.dependency_overrides[get_action_data_trigger_service] = lambda: trigger_svc
    app.dependency_overrides[get_verification_service] = lambda: verification_svc
    app.dependency_overrides[get_retry_engine] = lambda: retry_eng
    app.dependency_overrides[get_verification_engine] = lambda: verification_eng

    with TestClient(app) as tc:
        yield tc, test_session

    app.dependency_overrides.clear()
    test_session.close()
    eng.dispose()


def _seed_target(session: Session) -> PhoneNumber:
    """Seed a target Entity + PhoneNumber and return the phone row."""
    e = Entity(entity_type="target")
    session.add(e)
    session.flush()
    p = PhoneNumber(entity_id=e.id, phone_number="+15550001111", ingestion_source="manual")
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


# ===========================================================================
# Domain A — Schema & Ingestion
# ===========================================================================


class TestLeadFormSchema:
    def test_returns_fields_list(self, client):
        tc, _ = client
        r = tc.get("/api/v1/schema/lead-form")
        assert r.status_code == 200
        body = r.json()
        assert "fields" in body
        assert isinstance(body["fields"], list)
        assert len(body["fields"]) > 0

    def test_each_field_has_required_keys(self, client):
        tc, _ = client
        body = tc.get("/api/v1/schema/lead-form").json()
        for field in body["fields"]:
            assert "name" in field
            assert "type" in field
            assert "label" in field
            assert "required" in field


class TestIngest:
    def test_happy_path_returns_201(self, client):
        tc, session = client
        _seed_target(session)
        r = tc.post("/api/v1/ingest", json={
            "phone_number": "+15559990001",
            "entity_type": "family",
            "target_phone_number": "+15550001111",
            "ingestion_source": "manual",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["phone_number"] == "+15559990001"
        assert body["verification_status"] == "pending"
        assert "id" in body

    def test_unknown_target_returns_404(self, client):
        tc, _ = client
        r = tc.post("/api/v1/ingest", json={
            "phone_number": "+15559990002",
            "entity_type": "family",
            "target_phone_number": "+10000000000",  # not in DB
            "ingestion_source": "manual",
        })
        assert r.status_code == 404

    def test_duplicate_phone_returns_409(self, client):
        tc, session = client
        _seed_target(session)
        # First ingest succeeds.
        tc.post("/api/v1/ingest", json={
            "phone_number": "+15559990003",
            "entity_type": "family",
            "target_phone_number": "+15550001111",
            "ingestion_source": "manual",
        })
        # Second ingest of the same number must fail.
        r = tc.post("/api/v1/ingest", json={
            "phone_number": "+15559990003",
            "entity_type": "friend",
            "target_phone_number": "+15550001111",
            "ingestion_source": "manual",
        })
        assert r.status_code == 409


# ===========================================================================
# Domain B — Actions & Phone Updates
# ===========================================================================


class TestManualActionTrigger:
    def test_happy_path_returns_201(self, client):
        tc, session = client
        target = _seed_target(session)
        r = tc.post("/api/v1/actions/trigger", json={
            "phone_id": target.id,
            "action_type": "test_action",
            "operator_id": "op_001",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["phone_id"] == target.id
        assert body["action_type"] == "test_action"
        assert body["status"] == "sent"

    def test_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.post("/api/v1/actions/trigger", json={
            "phone_id": 99999,
            "action_type": "test_action",
            "operator_id": "op_001",
        })
        assert r.status_code == 404


class TestRetryNow:
    def test_retries_failed_log(self, client):
        tc, session = client
        target = _seed_target(session)
        # Seed a failed ActionLog manually.
        log = ActionLog(
            phone_id=target.id,
            action_type="test_action",
            status="failed",
        )
        session.add(log)
        session.commit()
        session.refresh(log)

        r = tc.post(f"/api/v1/actions/retry-now/{log.id}")
        assert r.status_code == 200
        body = r.json()
        # Mock handler succeeds → status transitions to "sent".
        assert body["status"] == "sent"

    def test_unknown_log_returns_404(self, client):
        tc, _ = client
        r = tc.post("/api/v1/actions/retry-now/99999")
        assert r.status_code == 404

    def test_terminal_sent_returns_422(self, client):
        tc, session = client
        target = _seed_target(session)
        log = ActionLog(phone_id=target.id, action_type="x", status="sent")
        session.add(log)
        session.commit()
        session.refresh(log)
        r = tc.post(f"/api/v1/actions/retry-now/{log.id}")
        assert r.status_code == 422


class TestActionLogs:
    def test_returns_empty_list_initially(self, client):
        tc, _ = client
        r = tc.get("/api/v1/actions/logs")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 0
        assert body["items"] == []

    def test_status_filter_isolates_subset(self, client):
        tc, session = client
        target = _seed_target(session)
        for st in ("sent", "failed", "failed"):
            session.add(ActionLog(phone_id=target.id, action_type="x", status=st))
        session.commit()

        r = tc.get("/api/v1/actions/logs?status=failed")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        assert all(item["status"] == "failed" for item in body["items"])

    def test_min_retry_count_filter(self, client):
        tc, session = client
        target = _seed_target(session)
        session.add(ActionLog(phone_id=target.id, action_type="x", status="failed", retry_count=1))
        session.add(ActionLog(phone_id=target.id, action_type="x", status="failed", retry_count=4))
        session.commit()

        r = tc.get("/api/v1/actions/logs?min_retry_count=3")
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_pagination_fields_present(self, client):
        tc, _ = client
        r = tc.get("/api/v1/actions/logs?page=1&page_size=10")
        body = r.json()
        assert "page" in body
        assert "page_size" in body
        assert "total" in body
        assert "items" in body


# ===========================================================================
# Domain B — Phone PATCH
# ===========================================================================


class TestPhonePatch:
    def test_updates_classification_type(self, client):
        tc, session = client
        target = _seed_target(session)
        r = tc.patch(f"/api/v1/phones/{target.id}", json={"classification_type": "tier_a"})
        assert r.status_code == 200
        body = r.json()
        assert body["phone"]["id"] == target.id

    def test_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.patch("/api/v1/phones/99999", json={"classification_type": "tier_a"})
        assert r.status_code == 404

    def test_no_triggered_action_when_no_failed_log(self, client):
        tc, session = client
        target = _seed_target(session)
        r = tc.patch(f"/api/v1/phones/{target.id}", json={"classification_type": "tier_b"})
        assert r.status_code == 200
        assert r.json()["triggered_action"] is None


# ===========================================================================
# Domain D — Phone Queries
# ===========================================================================


class TestPhoneList:
    def test_returns_seeded_phone(self, client):
        tc, session = client
        _seed_target(session)
        r = tc.get("/api/v1/phones")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["entity_type"] == "target"

    def test_verification_status_filter(self, client):
        tc, session = client
        _seed_target(session)
        r = tc.get("/api/v1/phones?verification_status=pending")
        assert r.status_code == 200
        assert r.json()["total"] == 1

        r2 = tc.get("/api/v1/phones?verification_status=verified_good")
        assert r2.json()["total"] == 0

    def test_pagination_params_respected(self, client):
        tc, session = client
        # Seed 3 phones
        for i, num in enumerate(("+15550002001", "+15550002002", "+15550002003")):
            e = Entity(entity_type="family")
            session.add(e)
            session.flush()
            session.add(PhoneNumber(entity_id=e.id, phone_number=num, ingestion_source="manual"))
        session.commit()
        r = tc.get("/api/v1/phones?page=1&page_size=2")
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) == 2
        assert body["page_size"] == 2


class TestPhoneDetail:
    def test_returns_full_detail(self, client):
        tc, session = client
        target = _seed_target(session)
        r = tc.get(f"/api/v1/phones/{target.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == target.id
        assert "entity" in body
        assert "action_timeline" in body
        assert body["action_timeline"] == []

    def test_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.get("/api/v1/phones/99999")
        assert r.status_code == 404

    def test_action_timeline_most_recent_first(self, client):
        tc, session = client
        target = _seed_target(session)
        from datetime import datetime, timedelta
        older = ActionLog(
            phone_id=target.id, action_type="x", status="sent",
            requested_at=datetime.utcnow() - timedelta(hours=2),
        )
        newer = ActionLog(
            phone_id=target.id, action_type="y", status="failed",
            requested_at=datetime.utcnow(),
        )
        session.add(older)
        session.add(newer)
        session.commit()

        body = tc.get(f"/api/v1/phones/{target.id}").json()
        timeline = body["action_timeline"]
        assert len(timeline) == 2
        # Most recent (newer) must be first.
        assert timeline[0]["action_type"] == "y"
        assert timeline[1]["action_type"] == "x"


# ===========================================================================
# Domain C — Verification
# ===========================================================================


class TestVerificationVerdict:
    def test_manual_verdict_persisted(self, client):
        tc, session = client
        target = _seed_target(session)
        r = tc.post("/api/v1/verification/verdict", json={
            "phone_id": target.id,
            "status": "verified_good",
            "reason": "Confirmed by operator.",
        })
        assert r.status_code == 200
        # Reflect updated phone from DB.
        session.refresh(target)
        assert target.verification_status == "verified_good"
        assert target.verification_source == "manual"

    def test_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.post("/api/v1/verification/verdict", json={
            "phone_id": 99999,
            "status": "verified_bad",
            "reason": "Test.",
        })
        assert r.status_code == 404


# ===========================================================================
# Domain D — System Workers
# ===========================================================================


class TestSystemWorkers:
    def test_retry_worker_runs_successfully(self, client):
        tc, _ = client
        r = tc.post("/api/v1/system/workers/run?worker_name=retry")
        assert r.status_code == 200
        body = r.json()
        assert body["worker_name"] == "retry"
        assert isinstance(body["processed_count"], int)
        assert "started_at" in body
        assert "completed_at" in body

    def test_verification_worker_runs_successfully(self, client):
        tc, _ = client
        r = tc.post("/api/v1/system/workers/run?worker_name=verification")
        assert r.status_code == 200
        body = r.json()
        assert body["worker_name"] == "verification"

    def test_invalid_worker_name_returns_422(self, client):
        tc, _ = client
        r = tc.post("/api/v1/system/workers/run?worker_name=nonexistent")
        assert r.status_code == 422


# ===========================================================================
# Domain D — Dashboard
# ===========================================================================


class TestDashboardMetrics:
    def test_returns_all_required_keys(self, client):
        tc, _ = client
        r = tc.get("/api/v1/dashboard/metrics")
        assert r.status_code == 200
        body = r.json()
        assert "total_phones" in body
        assert "phones_by_verification_status" in body
        assert "total_actions" in body
        assert "actions_by_status" in body
        assert "retry_queue_depth" in body
        assert "overdue_retries" in body

    def test_counts_reflect_seeded_data(self, client):
        tc, session = client
        _seed_target(session)
        r = tc.get("/api/v1/dashboard/metrics")
        body = r.json()
        assert body["total_phones"] == 1
        assert body["phones_by_verification_status"].get("pending", 0) == 1
        assert body["retry_queue_depth"] == 0
        assert body["overdue_retries"] == 0
