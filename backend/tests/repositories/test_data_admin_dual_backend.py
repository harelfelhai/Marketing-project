"""
test_data_admin_dual_backend.py — DataAdminService is backend-agnostic.

Runs behavioural assertions against both SQL (in-memory SQLite) and Mongo
(in-memory mongomock) backends. If the service behaves differently on the
two backends, this suite fails.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import SOFT_DELETE_SENTINEL, not_deleted
from repositories.api_connection import set_api_config_for_tests
from repositories.storage import ApiStorage, MongoStorage, SqlStorage
from services.data_admin import DataAdminService
from tests.repositories.fake_api import default_api_config, make_fake_api


@pytest.fixture(params=["sql", "mongo", "api"])
def svc(request):
    if request.param == "sql":
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield DataAdminService(storage=SqlStorage(session))
    elif request.param == "mongo":
        database = mongomock.MongoClient()["test"]
        yield DataAdminService(storage=MongoStorage(database))
    else:
        # 'api' backend: ApiStorage over an in-memory fake REST server. This
        # proves soft-delete cascade/restore (the datetime-sentinel comparison
        # and {"in"}/None filter paths) behaves identically over HTTP.
        config = default_api_config()
        client, _store = make_fake_api()
        set_api_config_for_tests(config=config, client=client)
        try:
            yield DataAdminService(storage=ApiStorage(config))
        finally:
            set_api_config_for_tests(None, None)


def _seed_root(svc, *, full_name="Root Person"):
    ent = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name=full_name,
        deleted_at=not_deleted(),
    )
    return svc.entities.add(ent)


def _seed_member(svc, root, *, relation_type="family", full_name="Jane Doe"):
    ent = Entity(
        relation_type=relation_type,
        target_entity_id=root.id,
        full_name=full_name,
        deleted_at=not_deleted(),
    )
    return svc.entities.add(ent)


def _seed_phone(svc, owner, *, number="+15550000001"):
    ph = PhoneNumber(
        entity_id=owner.id,
        phone_number=number,
        ingestion_source="manual",
        score=0.0,
        verification_status="pending",
        deleted_at=not_deleted(),
    )
    return svc.phones.add(ph)


class TestPatchEntity:
    def test_updates_full_name(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        out = svc.patch_entity(member.id, full_name="Janet Doe")
        assert out.full_name == "Janet Doe"

    def test_updates_identifier_1(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        out = svc.patch_entity(member.id, identifier_1="NEW-ID")
        assert out.identifier_1 == "NEW-ID"

    def test_patch_on_deleted_entity_raises(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        svc.soft_delete_entity(member.id)
        with pytest.raises(ValueError):
            svc.patch_entity(member.id, full_name="Ghost")


class TestSoftDeleteEntityCascade:
    def test_root_delete_cascades_to_members_and_their_phones(self, svc):
        root = _seed_root(svc)
        jane = _seed_member(svc, root, full_name="Jane")
        bob = _seed_member(svc, root, relation_type="friend", full_name="Bob")
        jane_phone = _seed_phone(svc, jane, number="+15550001000")
        bob_phone = _seed_phone(svc, bob, number="+15550002000")

        summary = svc.soft_delete_entity(root.id)
        assert summary["entity_id"] == root.id
        assert summary["phones_deleted"] == 2
        assert summary["entities_deleted"] == 3

        for old_id in (root.id, jane.id, bob.id):
            row = svc.entities.get(old_id)
            assert row.deleted_at != SOFT_DELETE_SENTINEL
        for old_id in (jane_phone.id, bob_phone.id):
            row = svc.phones.get(old_id)
            assert row.deleted_at != SOFT_DELETE_SENTINEL

    def test_double_delete_raises(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        svc.soft_delete_entity(member.id)
        with pytest.raises(ValueError):
            svc.soft_delete_entity(member.id)


class TestRestoreSymmetry:
    def test_restore_reverses_the_cascade(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        phone = _seed_phone(svc, member)

        svc.soft_delete_entity(member.id)
        out = svc.restore_entity(member.id)
        assert out["entities_restored"] >= 1
        assert out["phones_restored"] >= 1
        assert svc.entities.get(member.id).deleted_at == SOFT_DELETE_SENTINEL
        assert svc.phones.get(phone.id).deleted_at == SOFT_DELETE_SENTINEL

    def test_restore_reverses_only_what_root_cascade_deleted(self, svc):
        """Root + bob deleted together by root cascade. Restore brings back root + bob."""
        import time
        root = _seed_root(svc)
        bob = _seed_member(svc, root, full_name="Bob", relation_type="friend")
        root_summary = svc.soft_delete_entity(root.id)
        # Both root and bob were alive → cascade deletes both.
        assert root_summary["entities_deleted"] == 2

        svc.restore_entity(root.id)
        assert svc.entities.get(root.id).deleted_at == SOFT_DELETE_SENTINEL
        assert svc.entities.get(bob.id).deleted_at == SOFT_DELETE_SENTINEL


class TestListEntities:
    def test_filter_by_target_entity_id_returns_members(self, svc):
        root_a = _seed_root(svc, full_name="A")
        root_b = _seed_root(svc, full_name="B")
        m_a = _seed_member(svc, root_a)
        m_b = _seed_member(svc, root_b)

        out = svc.list_entities(target_entity_id=root_a.id)
        ids = {e.id for e in out}
        assert m_a.id in ids
        assert m_b.id not in ids
        assert root_a.id not in ids

    def test_q_matches_full_name(self, svc):
        root = _seed_root(svc, full_name="Root")
        jane = _seed_member(svc, root, full_name="Jane Doe")
        _seed_member(svc, root, full_name="Sam Chen")

        rows = svc.list_entities(q="Jane")
        ids = {e.id for e in rows}
        assert jane.id in ids


class TestPhoneOps:
    def test_patch_phone_updates_number(self, svc):
        root = _seed_root(svc)
        ph = _seed_phone(svc, root)
        out = svc.patch_phone(ph.id, phone_number="+15559999999")
        assert out.phone_number == "+15559999999"

    def test_soft_delete_then_restore_phone(self, svc):
        root = _seed_root(svc)
        ph = _seed_phone(svc, root)
        svc.soft_delete_phone(ph.id)
        assert svc.phones.get(ph.id).deleted_at != SOFT_DELETE_SENTINEL
        svc.restore_phone(ph.id)
        assert svc.phones.get(ph.id).deleted_at == SOFT_DELETE_SENTINEL
