"""
test_scoring_dual_backend.py — ScoringService on SQL and Mongo.

Pins the priority recalculation pipeline on both backends:
    - root-entity traversal via target_entity_id (one-hop)
    - tier extraction from the root's extra_data.customer_tier
    - priority_score + priority_updated_at write-back to the phone
    - update_confidence_and_recalc updates all four scoring columns
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from interfaces.scoring import BaseScoringStrategy
from models.entity import Entity
from models.phone_number import PhoneNumber
from repositories.storage import MongoStorage, SqlStorage
from services.scoring import ScoringService


class _FixedStrategy(BaseScoringStrategy):
    """Deterministic strategy — returns conf*100 + tier_bias for tracking."""
    def compute_priority(self, *, confidence_score, relation_type, customer_tier):
        tier_bias = (customer_tier or 0) * 0.1
        return float(confidence_score) + tier_bias


@pytest.fixture(params=["sql", "mongo"])
def storage(request):
    if request.param == "sql":
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield SqlStorage(session)
    else:
        database = mongomock.MongoClient()["test"]
        yield MongoStorage(database)


@pytest.fixture()
def svc(storage):
    return ScoringService(storage=storage, strategy=_FixedStrategy())


def _seed(storage, *, tier=2, relation="family"):
    root = Entity(entity_type="target", target_entity_id=None,
                  extra_data={"first_name": "Root", "customer_tier": tier})
    storage.entities.add(root)
    member = Entity(entity_type=relation, target_entity_id=root.id,
                    extra_data={"first_name": "Jane"})
    storage.entities.add(member)
    phone = PhoneNumber(
        entity_id=member.id, phone_number="+15550009999",
        ingestion_source="manual", verification_status="pending",
        confidence_score=50.0,
    )
    return storage.phones.add(phone)


class TestRecalculate:
    def test_writes_priority_and_timestamp(self, svc, storage):
        phone = _seed(storage, tier=2)
        out = svc.recalculate_for_phone(phone.id)
        # 50 (confidence) + 0.2 (tier 2 * 0.1) = 50.2
        assert out.priority_score == pytest.approx(50.2)
        assert out.priority_updated_at is not None

    def test_tier_missing_defaults_to_none(self, svc, storage):
        root = Entity(entity_type="target", target_entity_id=None,
                      extra_data={"first_name": "Root"})  # no tier
        storage.entities.add(root)
        phone = PhoneNumber(
            entity_id=root.id, phone_number="+15550008888",
            ingestion_source="manual", confidence_score=30.0,
        )
        storage.phones.add(phone)
        out = svc.recalculate_for_phone(phone.id)
        # tier None → bias 0 → score == confidence
        assert out.priority_score == pytest.approx(30.0)


class TestUpdateConfidenceAndRecalc:
    def test_writes_all_four_columns(self, svc, storage):
        phone = _seed(storage, tier=3)
        out = svc.update_confidence_and_recalc(phone.id, new_confidence=80.0)
        assert out.confidence_score == pytest.approx(80.0)
        assert out.confidence_updated_at is not None
        # 80 + 0.3 = 80.3
        assert out.priority_score == pytest.approx(80.3)
        assert out.priority_updated_at is not None
