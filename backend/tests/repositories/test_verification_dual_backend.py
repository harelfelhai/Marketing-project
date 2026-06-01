"""
test_verification_dual_backend.py — VerificationService + Engine on SQL and Mongo.

Pins the verdict writer + the eligibility engine on both backends:
    - update_verification_verdict writes the Phase 3 block + merges extra_data
    - apply_two_axis_verdict: Vector A confirm/refute + envelope propagation
    - VerificationEngine._fetch_eligible_phone_ids application-side reduction
      (pending + last 'sent' log older than the window)
"""

from datetime import timedelta

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from interfaces.verification import BaseVerificationStrategy
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import utc_now
from repositories.storage import MongoStorage, SqlStorage
from schemas.verification import VerificationVerdict
from services.verification import VerificationEngine, VerificationService


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
    return VerificationService(storage=storage)   # no scoring hook


def _seed_named_phone(storage):
    root = Entity(entity_type="target", target_entity_id=None,
                  extra_data={"first_name": "Root"})
    storage.entities.add(root)
    member = Entity(entity_type="family", target_entity_id=root.id,
                    extra_data={"first_name": "Jane"})
    storage.entities.add(member)
    phone = PhoneNumber(entity_id=member.id, phone_number="+15550000001",
                        ingestion_source="manual", verification_status="pending",
                        confidence_score=50.0)
    return root, member, storage.phones.add(phone)


def _seed_envelope_phone(storage, root):
    env = Entity(entity_type="social_envelope", target_entity_id=root.id,
                 extra_data={"envelope_id": "EP-1"})
    storage.entities.add(env)
    phone = PhoneNumber(entity_id=env.id, phone_number="+15550002222",
                        ingestion_source="automated", verification_status="pending",
                        confidence_score=50.0)
    return env, storage.phones.add(phone)


class TestVerdict:
    def test_update_verdict_writes_phase3_block(self, svc, storage):
        _, _, phone = _seed_named_phone(storage)
        out = svc.update_verification_verdict(
            phone.id, status="verified_good", source="manual", reason="ok",
            extra_metadata={"checked": True},
        )
        assert out.verification_status == "verified_good"
        assert out.verification_source == "manual"
        assert out.verified_at is not None
        assert out.extra_data.get("checked") is True

    def test_two_axis_vector_a_confirm_and_refute(self, svc, storage):
        _, member, phone = _seed_named_phone(storage)
        out = svc.apply_two_axis_verdict(
            phone.id, phone_axis="confirm", relation_axis="refute",
        )
        assert out.confidence_score == 100.0          # phone confirm
        assert out.verification_status == "verified_bad"  # relation refute
        # relation refute severs the member's link to its root.
        assert storage.entities.get(member.id).target_entity_id is None

    def test_envelope_confirm_propagates_to_status(self, svc, storage):
        root = Entity(entity_type="target", target_entity_id=None, extra_data={})
        storage.entities.add(root)
        env, phone = _seed_envelope_phone(storage, root)
        out = svc.apply_two_axis_verdict(phone.id, phone_axis="confirm")
        # DY-4-D: confirming phone-in-network propagates to verified_good.
        assert out.confidence_score == 100.0
        assert out.verification_status == "verified_good"

    def test_empty_submission_raises(self, svc, storage):
        _, _, phone = _seed_named_phone(storage)
        with pytest.raises(ValueError):
            svc.apply_two_axis_verdict(phone.id)


class TestEngineEligibility:
    def _engine(self, storage, window=7):
        class _Verdict(BaseVerificationStrategy):
            def evaluate_quality(self, phone_id):
                return VerificationVerdict(
                    status="verified_good", reason="auto", metadata={},
                )
        return VerificationEngine(
            storage=storage,
            strategy=_Verdict(),
            verification_service=VerificationService(storage=storage),
            verification_window_days=window,
        )

    def test_phone_with_old_sent_log_is_eligible(self, storage):
        _, _, phone = _seed_named_phone(storage)
        log = ActionLog(phone_id=phone.id, action_type="outreach_a", status="sent",
                        executed_at=utc_now() - timedelta(days=30))
        storage.action_logs.add(log)
        engine = self._engine(storage, window=7)
        assert engine._fetch_eligible_phone_ids() == [phone.id]

    def test_phone_with_recent_sent_log_is_not_eligible(self, storage):
        _, _, phone = _seed_named_phone(storage)
        log = ActionLog(phone_id=phone.id, action_type="outreach_a", status="sent",
                        executed_at=utc_now() - timedelta(days=1))
        storage.action_logs.add(log)
        engine = self._engine(storage, window=7)
        assert engine._fetch_eligible_phone_ids() == []

    def test_phone_without_sent_log_is_not_eligible(self, storage):
        _, _, phone = _seed_named_phone(storage)
        engine = self._engine(storage, window=7)
        assert engine._fetch_eligible_phone_ids() == []

    def test_process_eligible_applies_verdict(self, storage):
        _, _, phone = _seed_named_phone(storage)
        storage.action_logs.add(ActionLog(
            phone_id=phone.id, action_type="outreach_a", status="sent",
            executed_at=utc_now() - timedelta(days=30),
        ))
        engine = self._engine(storage, window=7)
        count = engine.process_eligible_numbers()
        assert count == 1
        assert storage.phones.get(phone.id).verification_status == "verified_good"
