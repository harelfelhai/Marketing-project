"""
test_ingestion_dual_backend.py — IngestionService on SQL and Mongo.

Pins the ingestion lifecycle on both backends:
    - target resolution by phone_number
    - Entity + PhoneNumber creation with the right FK and audit attribution
    - duplicate-phone pre-check raises IntegrityError, no orphan entity left
    - quick_attach_phone happy path + missing/soft-deleted entity rejection
"""

import mongomock
import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from exceptions import TargetNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from repositories.storage import MongoStorage, SqlStorage
from schemas.ingestion import IngestionPayload
from services.ingestion import IngestionService


class _RoutingNone:
    """Routing engine that never asks for an immediate dispatch."""
    def determine_immediate_action(self, _phone):
        return None


class _DispatcherNoop:
    """Dispatcher stub — never invoked in this suite (routing returns None)."""
    def dispatch(self, *_, **__):  # pragma: no cover  - safety net
        raise AssertionError("dispatcher must not be called in these tests")


# ---------------------------------------------------------------------------
# Both backends behind one storage-yielding fixture
# ---------------------------------------------------------------------------


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
    return IngestionService(
        storage=storage,
        routing_engine=_RoutingNone(),
        dispatcher=_DispatcherNoop(),
        scoring_service=None,
    )


@pytest.fixture()
def seeded_target(storage):
    root = Entity(entity_type="target", target_entity_id=None,
                  extra_data={"first_name": "Root"})
    storage.entities.add(root)
    phone = PhoneNumber(
        entity_id=root.id,
        phone_number="+15550000001",
        ingestion_source="manual",
        verification_status="pending",
    )
    storage.phones.add(phone)
    return phone


# ---------------------------------------------------------------------------
# ingest_circle_member
# ---------------------------------------------------------------------------


class TestIngestCircleMember:
    def test_happy_path_creates_entity_and_phone(self, svc, storage, seeded_target):
        out = svc.ingest_circle_member(IngestionPayload(
            phone_number="+15550009999",
            entity_type="family",
            target_phone_number=seeded_target.phone_number,
            ingestion_source="manual",
        ), uploaded_by_user_id=None)

        assert out.phone_number == "+15550009999"
        # FK: phone.entity_id should point at the freshly-created member entity,
        # and that entity should target the seeded root.
        member = storage.entities.get(out.entity_id)
        assert member is not None
        assert member.entity_type == "family"
        assert member.target_entity_id == seeded_target.entity_id

    def test_unknown_target_phone_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.ingest_circle_member(IngestionPayload(
                phone_number="+15550009999",
                entity_type="family",
                target_phone_number="+19999999999",
                ingestion_source="manual",
            ))

    def test_duplicate_phone_number_raises_and_does_not_orphan_entity(
        self, svc, storage, seeded_target,
    ):
        before = len(storage.entities.list())
        with pytest.raises(IntegrityError):
            svc.ingest_circle_member(IngestionPayload(
                phone_number=seeded_target.phone_number,   # already in DB
                entity_type="family",
                target_phone_number=seeded_target.phone_number,
                ingestion_source="manual",
            ))
        # No new entity was created (pre-check fired before the entity write).
        assert len(storage.entities.list()) == before


# ---------------------------------------------------------------------------
# quick_attach_phone
# ---------------------------------------------------------------------------


class TestQuickAttachPhone:
    def test_happy_path(self, svc, storage, seeded_target):
        out = svc.quick_attach_phone(
            phone_number="+15550001234",
            entity_id=seeded_target.entity_id,
        )
        assert out.phone_number == "+15550001234"
        assert out.entity_id == seeded_target.entity_id

    def test_missing_entity_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15550009999",
                entity_id="ent-does-not-exist",
            )

    def test_soft_deleted_entity_rejected(self, svc, storage, seeded_target):
        owner = storage.entities.get(seeded_target.entity_id)
        from datetime import datetime, timezone
        owner.deleted_at = datetime.now(timezone.utc)
        storage.entities.update(owner)
        with pytest.raises(TargetNotFoundError):
            svc.quick_attach_phone(
                phone_number="+15550009999",
                entity_id=seeded_target.entity_id,
            )
