"""
tests/conftest.py — Shared fixtures for the entire test suite.

Architecture:
    - `engine`: in-memory SQLite, function-scoped, with FK enforcement ON.
    - `session`: yields a Session against `engine`; each test gets a fresh DB.
    - `seeded_target`: factory that inserts one target Entity + PhoneNumber.
    - Mock handlers/strategies for the dispatcher and verification engines.

We deliberately use FUNCTION-SCOPED engines (fresh DB per test) rather than
session-scoped + savepoint rollback. With our atomic-retry-claim logic that
performs intermediate commits, savepoints don't isolate cleanly. Fresh DBs
are slower but correct.
"""

from typing import Iterator, List

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

# Side-effect import: registers all SQLModel tables in metadata.
import models  # noqa: F401
from exceptions import ActionExecutionError
from interfaces.dispatcher import BaseActionHandler
from interfaces.ingestion import BaseIngestionRoutingEngine
from interfaces.verification import BaseVerificationStrategy
from models.entity import Entity
from models.phone_number import PhoneNumber
from schemas.verification import VerificationVerdict


# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def engine():
    """
    Fresh in-memory SQLite engine for each test, with FK enforcement enabled.
    """
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(eng, "connect")
    def _enable_fks(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def session(engine) -> Iterator[Session]:
    """Yield a session bound to the test's fresh engine."""
    with Session(engine) as s:
        yield s


# ---------------------------------------------------------------------------
# Seed data factories
# ---------------------------------------------------------------------------

@pytest.fixture()
def seeded_target(session: Session) -> PhoneNumber:
    """
    Insert one target Entity + one PhoneNumber pointing at it.
    Returns the PhoneNumber row (the target's primary number).
    """
    target = Entity(entity_type="target", extra_data={"seed": True})
    session.add(target)
    session.flush()
    phone = PhoneNumber(
        entity_id=target.id,
        phone_number="+15550000001",
        ingestion_source="manual",
    )
    session.add(phone)
    session.commit()
    session.refresh(phone)
    return phone


# ---------------------------------------------------------------------------
# Mock handlers / strategies / engines
# ---------------------------------------------------------------------------

class RecordingHandler(BaseActionHandler):
    """
    Handler that records every call and returns a deterministic payload.
    Useful for assertions about WHAT was dispatched.
    """

    def __init__(self):
        self.calls: List[tuple] = []

    def execute(self, phone_number: str, extra_data: dict) -> dict:
        self.calls.append((phone_number, dict(extra_data)))
        return {"recorded": True, "phone_number": phone_number}


class FailingHandler(BaseActionHandler):
    """
    Handler that raises ActionExecutionError on every call.
    Constructor configures retryability + detail.
    """

    def __init__(self, retryable: bool = True, detail: str = "test failure"):
        self.retryable = retryable
        self.detail = detail
        self.call_count = 0

    def execute(self, phone_number: str, extra_data: dict) -> dict:
        self.call_count += 1
        raise ActionExecutionError(
            action_type="<test>",
            phone_number=phone_number,
            retryable=self.retryable,
            detail=self.detail,
        )


class RoutingEngineReturning(BaseIngestionRoutingEngine):
    """Routing engine that always returns a fixed action token (or None)."""

    def __init__(self, action_token=None):
        self.action_token = action_token
        self.calls: List[PhoneNumber] = []

    def determine_immediate_action(self, phone_record: PhoneNumber):
        self.calls.append(phone_record)
        return self.action_token


class StrategyReturning(BaseVerificationStrategy):
    """Strategy that returns a configurable VerificationVerdict."""

    def __init__(self, verdict: VerificationVerdict):
        self.verdict = verdict
        self.calls: List[int] = []

    def evaluate_quality(self, phone_id: int) -> VerificationVerdict:
        self.calls.append(phone_id)
        return self.verdict


@pytest.fixture()
def recording_handler() -> RecordingHandler:
    return RecordingHandler()


@pytest.fixture()
def routing_engine_none() -> RoutingEngineReturning:
    return RoutingEngineReturning(action_token=None)


@pytest.fixture()
def routing_engine_with_token() -> RoutingEngineReturning:
    return RoutingEngineReturning(action_token="test_action")
