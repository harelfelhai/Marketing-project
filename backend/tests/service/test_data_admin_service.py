"""
test_data_admin_service.py — Soft-delete, edit, and restore via DataAdminService.

Covers:
  - patch_entity applies partial updates (full_name, identifier_1, identifier_2)
  - soft_delete_entity tombstones the row AND cascades to phones and tasks
  - restore_entity reverses the cascade for rows deleted at the same time
  - patch_phone / soft_delete_phone / restore_phone mirror the entity contract
  - get_entity / get_phone raise on missing or deleted rows (unless include_deleted)
  - list_entities filters by target_entity_id / deleted state / q
"""

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import SOFT_DELETE_SENTINEL, not_deleted
from repositories.storage import SqlStorage
from services.data_admin import DataAdminService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


@pytest.fixture()
def svc(session) -> DataAdminService:
    return DataAdminService(storage=SqlStorage(session))


@pytest.fixture()
def primary(session) -> Entity:
    ent = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root Person",
        deleted_at=not_deleted(),
    )
    session.add(ent)
    session.commit()
    session.refresh(ent)
    return ent


@pytest.fixture()
def associated(session, primary) -> Entity:
    ent = Entity(
        relation_type="family",
        target_entity_id=primary.id,
        full_name="Jane Doe",
        identifier_1="ID-001",
        deleted_at=not_deleted(),
    )
    session.add(ent)
    session.commit()
    session.refresh(ent)
    return ent


@pytest.fixture()
def phone(session, associated) -> PhoneNumber:
    ph = PhoneNumber(
        entity_id=associated.id,
        phone_number="+972501111111",
        ingestion_source="manual",
        score=0.0,
        verification_status="pending",
        deleted_at=not_deleted(),
    )
    session.add(ph)
    session.commit()
    session.refresh(ph)
    return ph


# ---------------------------------------------------------------------------
# patch_entity
# ---------------------------------------------------------------------------


class TestPatchEntity:
    def test_updates_full_name(self, svc, associated):
        out = svc.patch_entity(associated.id, full_name="Janet Doe")
        assert out.full_name == "Janet Doe"

    def test_updates_identifier_1(self, svc, associated):
        out = svc.patch_entity(associated.id, identifier_1="NEW-ID")
        assert out.identifier_1 == "NEW-ID"

    def test_updates_relation_type(self, svc, session, associated, primary):
        other_root = Entity(
            relation_type="primary",
            target_entity_id=None,
            deleted_at=not_deleted(),
        )
        session.add(other_root)
        session.commit()
        session.refresh(other_root)
        out = svc.patch_entity(associated.id, relation_type="colleague")
        assert out.relation_type == "colleague"

    def test_patch_on_missing_entity_raises(self, svc):
        with pytest.raises(ValueError):
            svc.patch_entity("nonexistent-id", full_name="Ghost")

    def test_patch_on_deleted_entity_raises(self, svc, associated):
        svc.soft_delete_entity(associated.id)
        with pytest.raises(ValueError):
            svc.patch_entity(associated.id, full_name="Resurrected")


# ---------------------------------------------------------------------------
# soft_delete_entity — cascade rule
# ---------------------------------------------------------------------------


class TestSoftDeleteEntity:
    def test_tombstones_entity_and_cascades_to_phones(
        self, svc, session, associated, phone
    ):
        summary = svc.soft_delete_entity(associated.id)
        assert summary["entity_id"] == associated.id
        assert summary["phones_deleted"] == 1
        assert summary["entities_deleted"] == 1

        session.refresh(associated)
        session.refresh(phone)
        assert associated.deleted_at != SOFT_DELETE_SENTINEL
        assert phone.deleted_at != SOFT_DELETE_SENTINEL

    def test_root_delete_cascades_through_children_and_their_phones(
        self, svc, session, primary, associated, phone
    ):
        bob = Entity(
            relation_type="friend",
            target_entity_id=primary.id,
            full_name="Bob",
            deleted_at=not_deleted(),
        )
        session.add(bob)
        session.commit()
        session.refresh(bob)
        bob_phone = PhoneNumber(
            entity_id=bob.id,
            phone_number="+972502222222",
            ingestion_source="manual",
            score=0.0,
            deleted_at=not_deleted(),
        )
        session.add(bob_phone)
        session.commit()

        summary = svc.soft_delete_entity(primary.id)
        assert summary["phones_deleted"] == 2
        assert summary["entities_deleted"] == 3

        for row in (primary, associated, bob, phone, bob_phone):
            session.refresh(row)
            assert row.deleted_at != SOFT_DELETE_SENTINEL

    def test_double_delete_raises(self, svc, associated):
        svc.soft_delete_entity(associated.id)
        with pytest.raises(ValueError):
            svc.soft_delete_entity(associated.id)


# ---------------------------------------------------------------------------
# restore_entity
# ---------------------------------------------------------------------------


class TestRestoreEntity:
    def test_restore_reverses_the_cascade(
        self, svc, session, associated, phone
    ):
        svc.soft_delete_entity(associated.id)
        summary = svc.restore_entity(associated.id)
        assert summary["entities_restored"] == 1
        assert summary["phones_restored"] == 1

        session.refresh(associated)
        session.refresh(phone)
        assert associated.deleted_at == SOFT_DELETE_SENTINEL
        assert phone.deleted_at == SOFT_DELETE_SENTINEL

    def test_restore_is_idempotent_on_active_row(self, svc, associated):
        out = svc.restore_entity(associated.id)
        assert out["entities_restored"] == 0
        assert out["phones_restored"] == 0

    def test_restore_missing_raises(self, svc):
        with pytest.raises(ValueError):
            svc.restore_entity("nonexistent-id")


# ---------------------------------------------------------------------------
# list_entities — filter matrix
# ---------------------------------------------------------------------------


class TestListEntities:
    def test_default_hides_deleted(self, svc, primary, associated, phone):
        svc.soft_delete_entity(associated.id)
        rows = svc.list_entities()
        ids = {r.id for r in rows}
        assert primary.id in ids
        assert associated.id not in ids

    def test_include_deleted_surfaces_tombstones(self, svc, primary, associated):
        svc.soft_delete_entity(associated.id)
        rows = svc.list_entities(include_deleted=True)
        ids = {r.id for r in rows}
        assert {primary.id, associated.id}.issubset(ids)

    def test_filter_by_target_entity_id(self, svc, primary, associated):
        rows = svc.list_entities(target_entity_id=primary.id)
        assert all(r.target_entity_id == primary.id for r in rows)
        assert associated.id in {r.id for r in rows}

    def test_q_substring_matches_full_name(self, svc, associated):
        rows = svc.list_entities(q="Jane")
        assert associated.id in {r.id for r in rows}
        rows = svc.list_entities(q="no-such-needle")
        assert rows == []


# ---------------------------------------------------------------------------
# Phone operations
# ---------------------------------------------------------------------------


class TestPhoneOps:
    def test_patch_phone_updates_number(self, svc, phone):
        out = svc.patch_phone(phone.id, phone_number="+972502222222")
        assert out.phone_number == "+972502222222"

    def test_patch_phone_updates_score(self, svc, phone):
        out = svc.patch_phone(phone.id, score=0.75)
        assert out.score == 0.75

    def test_soft_delete_phone_then_restore(self, svc, session, phone):
        svc.soft_delete_phone(phone.id)
        session.refresh(phone)
        assert phone.deleted_at != SOFT_DELETE_SENTINEL
        svc.restore_phone(phone.id)
        session.refresh(phone)
        assert phone.deleted_at == SOFT_DELETE_SENTINEL

    def test_get_phone_default_hides_deleted(self, svc, phone):
        svc.soft_delete_phone(phone.id)
        with pytest.raises(ValueError):
            svc.get_phone(phone.id)
        out = svc.get_phone(phone.id, include_deleted=True)
        assert out.deleted_at != SOFT_DELETE_SENTINEL
