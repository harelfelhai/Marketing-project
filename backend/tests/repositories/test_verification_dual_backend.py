"""
test_verification_dual_backend.py — VerificationService on SQL and Mongo.

Pins the verdict writer on both backends:
    - apply_verdict writes verification_status + merges extra_data
    - unknown phone raises PhoneNumberNotFoundError
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import PhoneNumberNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import not_deleted
from repositories.storage import MongoStorage, SqlStorage
from services.verification import VerificationService


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
    return VerificationService(storage=storage)


def _seed_phone(storage, *, number="+15550000001"):
    ent = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Test Person",
        deleted_at=not_deleted(),
    )
    storage.entities.add(ent)
    phone = PhoneNumber(
        entity_id=ent.id,
        phone_number=number,
        ingestion_source="manual",
        score=0.0,
        verification_status="pending",
        deleted_at=not_deleted(),
    )
    storage.phones.add(phone)
    return ent, phone


class TestApplyVerdict:
    def test_verified_status_persisted(self, svc, storage):
        _, phone = _seed_phone(storage)
        out = svc.apply_verdict(phone.id, status="verified", extra_data={})
        assert out.verification_status == "verified"

    def test_rejected_status_persisted(self, svc, storage):
        _, phone = _seed_phone(storage)
        out = svc.apply_verdict(phone.id, status="rejected", extra_data={})
        assert out.verification_status == "rejected"

    def test_extra_data_merged(self, svc, storage):
        _, phone = _seed_phone(storage)
        out = svc.apply_verdict(phone.id, status="verified",
                                extra_data={"checked_by": "admin"})
        assert out.extra_data.get("checked_by") == "admin"

    def test_existing_extra_data_preserved(self, svc, storage):
        ent = Entity(
            relation_type="primary",
            deleted_at=not_deleted(),
        )
        storage.entities.add(ent)
        phone = PhoneNumber(
            entity_id=ent.id,
            phone_number="+15550000002",
            ingestion_source="manual",
            score=0.0,
            verification_status="pending",
            deleted_at=not_deleted(),
            extra_data={"original_key": "original_value"},
        )
        storage.phones.add(phone)
        out = svc.apply_verdict(phone.id, status="verified",
                                extra_data={"new_key": "new_value"})
        assert out.extra_data.get("original_key") == "original_value"
        assert out.extra_data.get("new_key") == "new_value"

    def test_unknown_phone_raises(self, svc):
        with pytest.raises(PhoneNumberNotFoundError):
            svc.apply_verdict("ph-nope", status="verified", extra_data={})
