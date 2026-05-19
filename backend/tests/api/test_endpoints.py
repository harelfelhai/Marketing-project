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
    get_bulk_ingestion_service,
    get_entity_ingestion_service,
    get_pipeline_task_service,
    get_retry_engine,
    get_scoring_service,
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
from services.bulk_ingestion import BulkIngestionService
from services.entity_ingestion import EntityIngestionService
from services.ingestion import IngestionService
from services.scoring import ScoringService
from services.tasks import PipelineTaskService
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

    # Phase DY — real scoring strategy via the mock module so api tests
    # exercise the same code path production uses.
    from modules.mock_scoring import ScoringStrategy as MockScoringStrategy
    scoring_svc = ScoringService(session=test_session, strategy=MockScoringStrategy())

    ingestion_svc = IngestionService(
        session=test_session,
        routing_engine=routing_engine,
        dispatcher=dispatcher,
        scoring_service=scoring_svc,
    )
    user_action_svc = UserActionService(session=test_session, dispatcher=dispatcher)
    trigger_svc = ActionDataTriggerService(session=test_session, dispatcher=dispatcher)
    verification_svc = VerificationService(session=test_session, scoring_service=scoring_svc)
    retry_eng = RetryEngine(session=test_session, dispatcher=dispatcher)
    strategy = _MockVerificationStrategy()
    verification_eng = VerificationEngine(
        session=test_session,
        strategy=strategy,
        verification_service=verification_svc,
        verification_window_days=7,
    )

    task_svc = PipelineTaskService(session=test_session)

    # Override every dependency that touches the DB or external modules.
    app.dependency_overrides[get_session] = lambda: test_session
    app.dependency_overrides[get_ingestion_service] = lambda: ingestion_svc
    app.dependency_overrides[get_action_dispatcher] = lambda: dispatcher
    app.dependency_overrides[get_user_action_service] = lambda: user_action_svc
    app.dependency_overrides[get_action_data_trigger_service] = lambda: trigger_svc
    app.dependency_overrides[get_verification_service] = lambda: verification_svc
    app.dependency_overrides[get_retry_engine] = lambda: retry_eng
    app.dependency_overrides[get_verification_engine] = lambda: verification_eng
    app.dependency_overrides[get_pipeline_task_service] = lambda: task_svc
    app.dependency_overrides[get_scoring_service] = lambda: scoring_svc

    # Phase E1 — bulk ingestion service (shares the same scoring service
    # so the Phase DY hook works inside the test transaction too).
    bulk_svc = BulkIngestionService(session=test_session, scoring_service=scoring_svc)
    app.dependency_overrides[get_bulk_ingestion_service] = lambda: bulk_svc

    # Phase E2 — entity-centric ingestion service. No scoring hook
    # because the path creates no phones; just a session-bound writer.
    entity_svc = EntityIngestionService(session=test_session)
    app.dependency_overrides[get_entity_ingestion_service] = lambda: entity_svc

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


# ===========================================================================
# Domain E — Operations Task Queue (Phase DX)
# ===========================================================================


class TestTasksEndpoints:
    """Integration tests for the four /api/v1/tasks endpoints."""

    def _open_via_api(self, tc, phone_id, **overrides):
        body = {
            "phone_id": phone_id,
            "task_type": "approval_required",
            "requested_by": "mock_operator_02",
        }
        body.update(overrides)
        return tc.post("/api/v1/tasks", json=body)

    # ---- POST /tasks (open) ----

    def test_open_minimal_returns_201_with_join_fields(self, client):
        tc, session = client
        phone = _seed_target(session)
        r = self._open_via_api(tc, phone.id)
        assert r.status_code == 201
        body = r.json()
        assert body["id"] > 0
        assert body["phone_id"] == phone.id
        assert body["status"] == "pending"
        # JOIN fields populated:
        assert body["phone_number"] == phone.phone_number
        assert body["entity_id"] == phone.entity_id
        assert body["entity_type"] == "target"
        # extra_data null when omitted:
        assert body["extra_data"] is None
        assert body["resolved_by"] is None
        assert body["resolved_at"] is None

    def test_open_with_full_payload(self, client):
        tc, session = client
        phone = _seed_target(session)
        r = self._open_via_api(
            tc, phone.id,
            task_type="remediation_failure",
            extra_data={"failure_category": "provider_blocked"},
        )
        body = r.json()
        assert body["task_type"] == "remediation_failure"
        assert body["extra_data"] == {"failure_category": "provider_blocked"}

    def test_open_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = self._open_via_api(tc, phone_id=99999)
        assert r.status_code == 404

    def test_open_with_unknown_source_action_log_returns_422(self, client):
        tc, session = client
        phone = _seed_target(session)
        r = self._open_via_api(tc, phone.id, source_action_log_id=99999)
        assert r.status_code == 422

    def test_open_missing_required_returns_422(self, client):
        tc, _ = client
        r = tc.post("/api/v1/tasks", json={"phone_id": 1})  # missing task_type, requested_by
        assert r.status_code == 422

    # ---- GET /tasks (list, filter-as-view) ----

    def test_list_returns_pagination_envelope(self, client):
        tc, session = client
        phone = _seed_target(session)
        self._open_via_api(tc, phone.id)
        r = tc.get("/api/v1/tasks")
        assert r.status_code == 200
        body = r.json()
        assert "items" in body and "total" in body and "page" in body and "page_size" in body
        assert body["total"] == 1
        assert body["items"][0]["phone_number"] == phone.phone_number

    def test_list_filter_by_status(self, client):
        tc, session = client
        phone = _seed_target(session)
        a = self._open_via_api(tc, phone.id, task_type="a").json()
        self._open_via_api(tc, phone.id, task_type="b")
        # Resolve one task so the status filter has something to discriminate.
        tc.post(
            f"/api/v1/tasks/{a['id']}/resolve",
            json={"operator_id": "mock_admin_01", "outcome": "resolved"},
        )
        r = tc.get("/api/v1/tasks?status=pending")
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["status"] == "pending"

    def test_list_filter_by_task_type(self, client):
        tc, session = client
        phone = _seed_target(session)
        self._open_via_api(tc, phone.id, task_type="approval_required")
        self._open_via_api(tc, phone.id, task_type="remediation_failure")
        r = tc.get("/api/v1/tasks?task_type=approval_required")
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["task_type"] == "approval_required"

    def test_list_pagesize_cap_enforced(self, client):
        tc, _ = client
        r = tc.get("/api/v1/tasks?page_size=501")
        assert r.status_code == 422
        r2 = tc.get("/api/v1/tasks?page_size=500")
        assert r2.status_code == 200

    # ---- GET /tasks/{id} ----

    def test_get_returns_join_fields(self, client):
        tc, session = client
        phone = _seed_target(session)
        opened = self._open_via_api(tc, phone.id).json()
        r = tc.get(f"/api/v1/tasks/{opened['id']}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == opened["id"]
        assert body["phone_number"] == phone.phone_number

    def test_get_unknown_returns_404(self, client):
        tc, _ = client
        r = tc.get("/api/v1/tasks/99999")
        assert r.status_code == 404

    # ---- POST /tasks/{id}/resolve ----

    def test_resolve_writes_terminal_state(self, client):
        tc, session = client
        phone = _seed_target(session)
        opened = self._open_via_api(
            tc, phone.id,
            extra_data={"requested_action_type": "action_type_a"},
        ).json()
        r = tc.post(
            f"/api/v1/tasks/{opened['id']}/resolve",
            json={
                "operator_id": "mock_admin_01",
                "outcome": "resolved",
                "resolution_note": "approved",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "resolved"
        assert body["resolved_by"] == "mock_admin_01"
        assert body["resolved_at"] is not None
        # Resolution metadata merged with opener metadata (no overwrite):
        assert body["extra_data"]["requested_action_type"] == "action_type_a"
        assert body["extra_data"]["resolution_outcome"] == "resolved"
        assert body["extra_data"]["resolution_note"] == "approved"

    def test_resolve_unknown_id_returns_404(self, client):
        tc, _ = client
        r = tc.post(
            "/api/v1/tasks/99999/resolve",
            json={"operator_id": "op", "outcome": "resolved"},
        )
        assert r.status_code == 404

    def test_resolve_terminal_task_returns_422(self, client):
        tc, session = client
        phone = _seed_target(session)
        opened = self._open_via_api(tc, phone.id).json()
        # First resolve succeeds.
        first = tc.post(
            f"/api/v1/tasks/{opened['id']}/resolve",
            json={"operator_id": "adm", "outcome": "resolved"},
        )
        assert first.status_code == 200
        # Second resolve is blocked.
        second = tc.post(
            f"/api/v1/tasks/{opened['id']}/resolve",
            json={"operator_id": "adm", "outcome": "rejected"},
        )
        assert second.status_code == 422

    def test_resolve_invalid_outcome_returns_422(self, client):
        tc, session = client
        phone = _seed_target(session)
        opened = self._open_via_api(tc, phone.id).json()
        r = tc.post(
            f"/api/v1/tasks/{opened['id']}/resolve",
            json={"operator_id": "adm", "outcome": "approved"},  # not in allowed regex
        )
        assert r.status_code == 422

    def test_resolve_missing_operator_id_returns_422(self, client):
        tc, session = client
        phone = _seed_target(session)
        opened = self._open_via_api(tc, phone.id).json()
        r = tc.post(
            f"/api/v1/tasks/{opened['id']}/resolve",
            json={"outcome": "resolved"},
        )
        assert r.status_code == 422


# ===========================================================================
# Phase DY — Scoring & priority-sort integration
# ===========================================================================


_SEED_COUNTER = [0]

def _seed_target_with_tier(session, tier=1, confidence=80.0):
    """
    Seed a target Entity (with customer_tier in extra_data) + a phone.

    Uses a module-level counter to guarantee a unique phone_number per
    invocation — calling twice with the same tier in one test must not
    collide on the UNIQUE constraint.
    """
    _SEED_COUNTER[0] += 1
    n = _SEED_COUNTER[0]
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=1,
        extra_data={"customer_tier": tier},
    )
    session.add(e)
    session.flush()
    p = PhoneNumber(
        entity_id=e.id,
        phone_number=f"+1555{n:07d}",
        ingestion_source="manual",
        confidence_score=confidence,
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


class TestPatchConfidence:
    def test_patch_confidence_updates_and_recalcs_priority(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, tier=1, confidence=50.0)

        r = tc.patch(f"/api/v1/phones/{phone.id}", json={"confidence_score": 95.0})
        assert r.status_code == 200
        body = r.json()
        # IngestionResponse-shaped phone payload reflects the new scores.
        assert body["phone"]["confidence_score"] == 95.0
        # Priority recomputed: 95 × (0.6×1.0 + 0.4×1.0) = 95.0.
        assert abs(body["phone"]["priority_score"] - 95.0) < 1e-9

    def test_patch_rejects_confidence_outside_0_100(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session)
        # Range enforced at the Pydantic boundary.
        r = tc.patch(f"/api/v1/phones/{phone.id}", json={"confidence_score": 150.0})
        assert r.status_code == 422

    def test_patch_classification_alone_does_not_change_confidence(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, confidence=42.0)
        before_confidence = phone.confidence_score

        r = tc.patch(f"/api/v1/phones/{phone.id}", json={"classification_type": "type_a"})
        assert r.status_code == 200
        body = r.json()
        assert body["phone"]["confidence_score"] == before_confidence


class TestListSortBy:
    def test_default_sort_is_priority_descending(self, client):
        tc, session = client
        from sqlmodel import select as sm_select
        # Seed two phones with distinguishable priorities (tier 1 vs tier 3).
        _seed_target_with_tier(session, tier=1, confidence=80.0)  # priority 80
        _seed_target_with_tier(session, tier=3, confidence=80.0)  # priority < 80
        # Trigger scoring on both.
        from modules.mock_scoring import ScoringStrategy
        from services.scoring import ScoringService
        sc = ScoringService(session=session, strategy=ScoringStrategy())
        for p in session.exec(sm_select(PhoneNumber)).all():
            sc.recalculate_for_phone(p.id)

        r = tc.get("/api/v1/phones")
        assert r.status_code == 200
        items = r.json()["items"]
        # First item must have the higher priority_score.
        assert items[0]["priority_score"] >= items[1]["priority_score"]

    def test_sort_by_ingested_at_preserves_legacy_order(self, client):
        tc, session = client
        # Two phones, second one has a LOWER priority but a NEWER ingested_at.
        _seed_target_with_tier(session, tier=3, confidence=20.0)  # low priority, older
        _seed_target_with_tier(session, tier=1, confidence=10.0)  # higher priority, newer

        r = tc.get("/api/v1/phones?sort_by=ingested_at")
        assert r.status_code == 200
        items = r.json()["items"]
        # Most recent ingested_at first regardless of priority.
        assert items[0]["ingested_at"] >= items[1]["ingested_at"]

    def test_sort_by_invalid_value_returns_422(self, client):
        tc, _ = client
        r = tc.get("/api/v1/phones?sort_by=bogus")
        assert r.status_code == 422

    def test_priority_sort_tiebreaker_by_id_desc(self, client):
        tc, session = client
        # Two phones with IDENTICAL priority_score — tiebreaker must put
        # the higher id first.
        _seed_target_with_tier(session, tier=1, confidence=50.0)
        _seed_target_with_tier(session, tier=1, confidence=50.0)

        r = tc.get("/api/v1/phones")
        items = r.json()["items"]
        assert items[0]["id"] > items[1]["id"]


class TestPhoneSummaryShape:
    def test_list_response_includes_phase_dy_fields(self, client):
        tc, session = client
        _seed_target_with_tier(session, tier=2, confidence=70.0)
        r = tc.get("/api/v1/phones")
        item = r.json()["items"][0]
        for key in [
            "confidence_score", "confidence_updated_at",
            "priority_score",   "priority_updated_at",
            "customer_tier",
        ]:
            assert key in item, f"missing {key} in PhoneSummary"

    def test_customer_tier_extracted_from_root_entity(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, tier=2)
        r = tc.get("/api/v1/phones")
        item = next(i for i in r.json()["items"] if i["id"] == phone.id)
        assert item["customer_tier"] == 2

    def test_detail_response_includes_phase_dy_fields(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, tier=1, confidence=80.0)
        r = tc.get(f"/api/v1/phones/{phone.id}")
        assert r.status_code == 200
        body = r.json()
        for key in [
            "confidence_score", "confidence_updated_at",
            "priority_score",   "priority_updated_at",
            "customer_tier",
        ]:
            assert key in body
        assert body["customer_tier"] == 1


class TestVerdictTriggersRecalc:
    def test_verdict_bumps_priority_updated_at(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, tier=1, confidence=80.0)
        # Initial recalc to set priority_updated_at to a baseline.
        from modules.mock_scoring import ScoringStrategy
        from services.scoring import ScoringService
        sc = ScoringService(session=session, strategy=ScoringStrategy())
        sc.recalculate_for_phone(phone.id)
        session.refresh(phone)
        baseline_ts = phone.priority_updated_at
        assert baseline_ts is not None

        # Submit a manual verdict — should re-run scoring inside the
        # verdict transaction, bumping priority_updated_at.
        r = tc.post(
            "/api/v1/verification/verdict",
            json={
                "phone_id": phone.id,
                "status":   "verified_good",
                "reason":   "ok",
            },
        )
        assert r.status_code == 200

        session.expire_all()
        reloaded = session.get(PhoneNumber, phone.id)
        # The verdict triggers a recompute even if the formula inputs
        # didn't change — the timestamp moves forward.
        assert reloaded.priority_updated_at is not None
        assert reloaded.priority_updated_at >= baseline_ts


# ===========================================================================
# Phase DY-4-C — Two-axis verdict endpoint dispatch
# ===========================================================================


def _seed_envelope_with_root(session, client_id=1):
    """Seed a primary target + a social_envelope entity + its phone."""
    root = Entity(
        entity_type="target", relation_type="primary",
        client_id=client_id, extra_data={"customer_tier": 1},
    )
    session.add(root); session.flush()
    envelope = Entity(
        entity_type="social_envelope", relation_type="associated",
        target_entity_id=root.id, client_id=client_id,
        extra_data={"envelope_id": "EP-API-001"},
    )
    session.add(envelope); session.flush()
    phone = PhoneNumber(
        entity_id=envelope.id,
        phone_number="+15559999001",
        ingestion_source="automated",
        confidence_score=50.0,
    )
    session.add(phone); session.commit(); session.refresh(phone)
    return phone, envelope


class TestVerdictTwoAxisDispatch:
    def test_legacy_payload_still_works(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, tier=1, confidence=60.0)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={"phone_id": phone.id, "status": "verified_good", "reason": "ok"},
        )
        assert r.status_code == 200
        assert r.json()["verification_status"] == "verified_good"

    def test_phone_axis_only_writes_confidence(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session, tier=1, confidence=50.0)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={"phone_id": phone.id, "phone_axis": "confirm"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["confidence_score"] == 100.0
        # Relation untouched.
        assert body["verification_status"] == "pending"

    def test_relation_axis_refute_severs_target(self, client):
        tc, session = client
        phone, envelope = _seed_envelope_with_root(session)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={
                "phone_id": phone.id,
                "relation_axis": "refute",
                "reason": "Owner not connected to target",
            },
        )
        assert r.status_code == 200
        assert r.json()["verification_status"] == "verified_bad"
        # Verify the entity's target_entity_id was severed.
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.target_entity_id is None

    def test_identification_promotes_envelope(self, client):
        tc, session = client
        phone, envelope = _seed_envelope_with_root(session)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={
                "phone_id": phone.id,
                "identification": {
                    "first_name": "Mary",
                    "last_name":  "Smith",
                    "relation":   "spouse",
                },
            },
        )
        assert r.status_code == 200
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "spouse"
        assert e.extra_data["first_name"] == "Mary"

    def test_partial_identification_holds_at_identified_envelope(self, client):
        tc, session = client
        phone, envelope = _seed_envelope_with_root(session)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={
                "phone_id": phone.id,
                "identification": {"first_name": "John", "last_name": "Doe"},
            },
        )
        assert r.status_code == 200
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "identified_envelope"

    def test_empty_submission_returns_422(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={"phone_id": phone.id},
        )
        assert r.status_code == 422

    def test_combined_failure_type_I_shape(self, client):
        """phone=confirm + relation=refute → confidence=100, status=verified_bad,
        target_entity_id severed. Per spec: phone-asset preserved, relation dropped."""
        tc, session = client
        phone, envelope = _seed_envelope_with_root(session)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={
                "phone_id": phone.id,
                "phone_axis": "confirm",
                "relation_axis": "refute",
                "reason": "Phone valid; owner unrelated",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["confidence_score"] == 100.0
        assert body["verification_status"] == "verified_bad"
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.target_entity_id is None

    def test_invalid_axis_value_returns_422(self, client):
        tc, session = client
        phone = _seed_target_with_tier(session)
        r = tc.post(
            "/api/v1/verification/verdict",
            json={"phone_id": phone.id, "phone_axis": "maybe"},
        )
        assert r.status_code == 422

    def test_unknown_phone_returns_404(self, client):
        tc, _ = client
        r = tc.post(
            "/api/v1/verification/verdict",
            json={"phone_id": 99999, "phone_axis": "confirm"},
        )
        assert r.status_code == 404


# ===========================================================================
# Phase E1-A — POST /api/v1/phones/bulk-text
# ===========================================================================


def _seed_primary_target(session, client_id=1):
    """Seed a primary target Entity that bulk submissions can attach to."""
    e = Entity(
        entity_type="target", relation_type="primary",
        client_id=client_id, extra_data={"customer_tier": 1},
    )
    session.add(e); session.commit(); session.refresh(e)
    return e


class TestBulkTextEndpoint:
    def test_happy_path_returns_200_with_summary(self, client):
        tc, session = client
        target = _seed_primary_target(session)
        r = tc.post(
            "/api/v1/phones/bulk-text",
            json={
                "phone_numbers_raw": "+14155550701, +14155550702, +14155550703",
                "client_id": 1,
                "entity_type": "family",
                "target_entity_id": target.id,
                "ingestion_source": "manual",
                "ingestion_reason": "Smoke-test batch",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success_count"] == 3
        assert body["failed_count"] == 0
        assert len(body["phone_ids"]) == 3
        assert len(body["entity_ids"]) == 1
        assert body["bulk_submission_id"]  # uuid populated

    def test_partial_failure_returns_200_with_failed_rows(self, client):
        tc, session = client
        target = _seed_primary_target(session)
        r = tc.post(
            "/api/v1/phones/bulk-text",
            json={
                "phone_numbers_raw": "+14155550711, NOTAPHONE, +14155550712",
                "client_id": 1,
                "entity_type": "family",
                "target_entity_id": target.id,
                "ingestion_source": "manual",
            },
        )
        # Per the resilience contract: still 200, with failed rows
        # surfaced in the body.
        assert r.status_code == 200
        body = r.json()
        assert body["success_count"] == 2
        assert body["failed_count"] == 1
        assert body["failed_rows"][0]["row"] == 2

    def test_unknown_target_entity_id_returns_422(self, client):
        tc, _ = client
        r = tc.post(
            "/api/v1/phones/bulk-text",
            json={
                "phone_numbers_raw": "+14155550721",
                "client_id": 1,
                "entity_type": "family",
                "target_entity_id": 99999,    # does not exist
                "ingestion_source": "manual",
            },
        )
        assert r.status_code == 422

    def test_empty_phone_numbers_raw_returns_422(self, client):
        tc, _ = client
        r = tc.post(
            "/api/v1/phones/bulk-text",
            json={
                "phone_numbers_raw": "",
                "client_id": 1,
                "entity_type": "family",
                "ingestion_source": "manual",
            },
        )
        # Pydantic min_length=1 enforces this.
        assert r.status_code == 422

    def test_all_invalid_returns_200_with_empty_success(self, client):
        tc, session = client
        target = _seed_primary_target(session)
        r = tc.post(
            "/api/v1/phones/bulk-text",
            json={
                "phone_numbers_raw": "abc, def, ghi",
                "client_id": 1,
                "entity_type": "family",
                "target_entity_id": target.id,
                "ingestion_source": "manual",
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success_count"] == 0
        assert body["failed_count"] == 3
        assert body["entity_ids"] == []   # no orphan entity created
        assert body["phone_ids"] == []

    def test_audit_trail_bulk_submission_id_returned_and_stamped(self, client):
        tc, session = client
        target = _seed_primary_target(session)
        r = tc.post(
            "/api/v1/phones/bulk-text",
            json={
                "phone_numbers_raw": "+14155550731",
                "client_id": 1,
                "entity_type": "family",
                "target_entity_id": target.id,
                "ingestion_source": "manual",
            },
        )
        sid = r.json()["bulk_submission_id"]
        assert sid
        # Verify the stamp landed on the created phone's extra_data.
        phone_id = r.json()["phone_ids"][0]
        session.expire_all()
        phone = session.get(PhoneNumber, phone_id)
        assert phone.extra_data["bulk_submission_id"] == sid


# ===========================================================================
# Phase E1-B — POST /api/v1/phones/bulk-upload, GET /api/v1/phones/bulk-template
# ===========================================================================


def _build_csv_upload(rows: list[list]) -> bytes:
    """Render `rows` (header first) as UTF-8 CSV bytes for an upload."""
    import csv
    import io as _io
    buf = _io.StringIO()
    writer = csv.writer(buf)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _build_xlsx_upload(rows: list[list]) -> bytes:
    """Render `rows` as in-memory .xlsx bytes for an upload."""
    import io as _io
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = _io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_CSV_MIME = "text/csv"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_HEADERS = ["phone_number", "client_id", "entity_type", "ingestion_source"]


class TestBulkUploadEndpoint:
    def test_csv_happy_path_returns_200(self, client):
        tc, _ = client
        payload = _build_csv_upload([
            _HEADERS,
            ["+14155551801", "1", "family", "manual"],
            ["+14155551802", "1", "friend", "manual"],
        ])
        r = tc.post(
            "/api/v1/phones/bulk-upload",
            files={"file": ("upload.csv", payload, _CSV_MIME)},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success_count"] == 2
        assert body["failed_count"] == 0
        # E1-B: one Entity per row.
        assert len(body["entity_ids"]) == 2
        assert body["bulk_submission_id"]

    def test_xlsx_happy_path_returns_200(self, client):
        tc, _ = client
        payload = _build_xlsx_upload([
            _HEADERS,
            ["+14155551811", 1, "family", "manual"],
        ])
        r = tc.post(
            "/api/v1/phones/bulk-upload",
            files={"file": ("upload.xlsx", payload, _XLSX_MIME)},
        )
        assert r.status_code == 200
        assert r.json()["success_count"] == 1

    def test_partial_failure_returns_200_with_failed_rows(self, client):
        tc, _ = client
        payload = _build_csv_upload([
            _HEADERS,
            ["+14155551821", "1", "family", "manual"],
            ["NOTAPHONE",   "1", "family", "manual"],
            ["+14155551822", "1", "family", "manual"],
        ])
        r = tc.post(
            "/api/v1/phones/bulk-upload",
            files={"file": ("upload.csv", payload, _CSV_MIME)},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["success_count"] == 2
        assert body["failed_count"] == 1
        assert body["failed_rows"][0]["row"] == 2

    def test_missing_required_column_returns_422(self, client):
        tc, _ = client
        payload = _build_csv_upload([
            ["phone_number", "client_id", "entity_type"],   # ingestion_source missing
            ["+14155551831", "1", "family"],
        ])
        r = tc.post(
            "/api/v1/phones/bulk-upload",
            files={"file": ("upload.csv", payload, _CSV_MIME)},
        )
        assert r.status_code == 422
        assert "ingestion_source" in r.json()["detail"]

    def test_unsupported_extension_returns_422(self, client):
        tc, _ = client
        r = tc.post(
            "/api/v1/phones/bulk-upload",
            files={"file": ("upload.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 422
        assert "extension" in r.json()["detail"].lower()

    def test_no_file_returns_422(self, client):
        tc, _ = client
        # FastAPI's File(...) marks the form field as required → 422.
        r = tc.post("/api/v1/phones/bulk-upload")
        assert r.status_code == 422


class TestBulkTemplateEndpoint:
    def test_returns_xlsx_with_expected_headers(self, client):
        tc, _ = client
        r = tc.get("/api/v1/phones/bulk-template")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        assert "bulk_phones_template.xlsx" in r.headers.get("content-disposition", "")
        # The body is a real .xlsx (zip) — sanity check the PK header bytes.
        assert r.content[:2] == b"PK"

    def test_template_round_trip_through_bulk_upload(self, client):
        """The template the endpoint serves should be a valid input for
        the upload endpoint after a trivial header-preserving copy. We
        verify the example rows it ships parse cleanly and ingest."""
        tc, _ = client
        r = tc.get("/api/v1/phones/bulk-template")
        assert r.status_code == 200
        payload = r.content
        r2 = tc.post(
            "/api/v1/phones/bulk-upload",
            files={"file": ("upload.xlsx", payload, _XLSX_MIME)},
        )
        assert r2.status_code == 200
        body = r2.json()
        # The template ships 3 example rows; all should ingest cleanly.
        assert body["success_count"] == 3
        assert body["failed_count"] == 0


# ===========================================================================
# Domain G — Entity Ingestion (Phase E2-A)
# ===========================================================================


def _seed_root_target_entity(session: Session, client_id: int = 1) -> Entity:
    """
    Seed a root target Entity (no phone needed for entity-centric tests).
    Returns the Entity row so tests can read its id and client_id.
    """
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=client_id,
        extra_data={"customer_tier": 1},
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


class TestCreateSingleEntity:
    def test_happy_path_returns_201(self, client):
        tc, session = client
        target = _seed_root_target_entity(session)
        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "last_name": "Doe",
            "relation_type": "family",
            "target_entity_id": target.id,
        })
        assert r.status_code == 201
        body = r.json()
        assert body["id"] is not None
        assert body["client_id"] == 1                # inherited from target
        assert body["target_entity_id"] == target.id
        assert body["relation_type"] == "family"
        assert body["first_name"] == "Jane"
        assert body["last_name"] == "Doe"
        # Friction-free UX chain — the response carries everything the
        # phone-ingestion modal needs to pre-fill on the next step.
        assert "created_at" in body

    def test_last_name_optional(self, client):
        tc, session = client
        target = _seed_root_target_entity(session)
        r = tc.post("/api/v1/entities", json={
            "first_name": "Cher",
            "relation_type": "spouse",
            "target_entity_id": target.id,
        })
        assert r.status_code == 201
        body = r.json()
        assert body["last_name"] is None

    def test_names_persist_inside_extra_data(self, client):
        tc, session = client
        target = _seed_root_target_entity(session)
        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "last_name": "Doe",
            "relation_type": "family",
            "target_entity_id": target.id,
        })
        new_id = r.json()["id"]
        # Round-trip into the DB to confirm the names are inside the
        # opaque blob rather than on schema-level columns.
        session.expire_all()
        ent = session.get(Entity, new_id)
        assert ent.extra_data["first_name"] == "Jane"
        assert ent.extra_data["last_name"] == "Doe"

    def test_missing_target_returns_422(self, client):
        tc, _ = client
        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "relation_type": "family",
            "target_entity_id": 99_999,   # not seeded
        })
        assert r.status_code == 422
        assert "99999" in r.json()["detail"]

    def test_non_root_target_returns_422(self, client):
        tc, session = client
        root = _seed_root_target_entity(session)
        # An associated entity off the root — not itself a root target.
        associated = Entity(
            entity_type="family",
            relation_type="associated",
            client_id=root.client_id,
            target_entity_id=root.id,
        )
        session.add(associated)
        session.commit()
        session.refresh(associated)

        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "relation_type": "family",
            "target_entity_id": associated.id,
        })
        assert r.status_code == 422
        assert "not a root target" in r.json()["detail"]

    def test_disallowed_relation_type_target_returns_422(self, client):
        tc, session = client
        target = _seed_root_target_entity(session)
        # 'target' is in the full vocabulary but NOT in the operator-
        # creatable subset — Pydantic enum rejects it at parse time.
        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "relation_type": "target",
            "target_entity_id": target.id,
        })
        assert r.status_code == 422

    def test_disallowed_relation_type_envelope_returns_422(self, client):
        tc, session = client
        target = _seed_root_target_entity(session)
        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "relation_type": "social_envelope",
            "target_entity_id": target.id,
        })
        assert r.status_code == 422

    def test_empty_first_name_returns_422(self, client):
        tc, session = client
        target = _seed_root_target_entity(session)
        r = tc.post("/api/v1/entities", json={
            "first_name": "",
            "relation_type": "family",
            "target_entity_id": target.id,
        })
        assert r.status_code == 422

    def test_client_id_not_accepted_on_request_inherited_from_target(self, client):
        """
        The wire contract does NOT expose client_id as a writable field.
        Even if a caller submits one, it is ignored — the response shows
        the inherited value, not the submitted one. This guards against
        partition-drift bugs.
        """
        tc, session = client
        target = _seed_root_target_entity(session, client_id=3)
        r = tc.post("/api/v1/entities", json={
            "first_name": "Jane",
            "relation_type": "family",
            "target_entity_id": target.id,
            "client_id": 999,    # bogus — Pydantic silently ignores
        })
        assert r.status_code == 201
        body = r.json()
        # The response reflects the inherited value, NOT the submitted 999.
        assert body["client_id"] == 3
