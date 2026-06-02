"""
tests/conftest.py — Shared fixtures for the entire test suite.

Architecture:
    - `engine`: in-memory SQLite, function-scoped, with FK enforcement ON.
    - `session`: yields a Session against `engine`; each test gets a fresh DB.
    - `seeded_target`: factory that inserts one target Entity + PhoneNumber.
    - Mock strategies for the verification engine.
"""

from typing import Iterator, List

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

# Side-effect import: registers all SQLModel tables in metadata.
import models  # noqa: F401
from interfaces.ingestion import BaseIngestionRoutingEngine
from interfaces.verification import BaseVerificationStrategy
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from schemas.verification import VerificationVerdict


# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_read_cache():
    """
    The read cache (repositories/cache.py) is a process-wide singleton keyed
    by query, invalidated by a global data-version counter. Reset it around
    every test so a cached projection from one test's database can never be
    served to another test (which gets a fresh DB but shares the cache).
    """
    from repositories import cache
    cache.reset()
    yield
    cache.reset()


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
    target = Entity(
        relation_type="primary",
        deleted_at=not_deleted(),
        extra_data={"seed": True},
    )
    session.add(target)
    session.flush()
    phone = PhoneNumber(
        entity_id=target.id,
        phone_number="+15550000001",
        ingestion_source="manual",
        score=0.0,
        deleted_at=not_deleted(),
    )
    session.add(phone)
    session.commit()
    session.refresh(phone)
    return phone


# ---------------------------------------------------------------------------
# Mock handlers / strategies / engines
# ---------------------------------------------------------------------------

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
        self.calls: List[str] = []

    def evaluate_quality(self, phone_id: str) -> VerificationVerdict:
        self.calls.append(phone_id)
        return self.verdict


@pytest.fixture()
def routing_engine_none() -> RoutingEngineReturning:
    return RoutingEngineReturning(action_token=None)


@pytest.fixture()
def routing_engine_with_token() -> RoutingEngineReturning:
    return RoutingEngineReturning(action_token="test_action")
