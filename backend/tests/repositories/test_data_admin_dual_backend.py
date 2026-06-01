"""
test_data_admin_dual_backend.py — proves DataAdminService is backend-agnostic.

Runs a single set of behavioural assertions twice — once against an SQL-backed
Storage (in-memory SQLite) and once against a Mongo-backed Storage (in-memory
mongomock). If the service behaves differently on the two backends, this suite
fails. That is the guarantee that lets the System Settings storage selector
flip the database under a live service without changing service code.

DataAdminService is the first service migrated onto the repository seam, so it
is also the canary: passing here means the architecture survives the trickiest
parts of the service (the cascade soft-delete + symmetric restore via
deletion_group_id).
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401  — registers table metadata
from models.entity import Entity
from models.phone_number import PhoneNumber
from repositories.storage import MongoStorage, SqlStorage
from services.data_admin import DataAdminService


# ---------------------------------------------------------------------------
# Both backends behind one fixture
# ---------------------------------------------------------------------------


@pytest.fixture(params=["sql", "mongo"])
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
    else:
        database = mongomock.MongoClient()["test"]
        yield DataAdminService(storage=MongoStorage(database))


# ---------------------------------------------------------------------------
# Tiny aggregate factory that goes through the service's repos so both backends
# see the writes in the right place.
# ---------------------------------------------------------------------------


def _seed_root(svc, *, first_name="Root", last_name="Target"):
    ent = Entity(entity_type="target", target_entity_id=None,
                 extra_data={"first_name": first_name, "last_name": last_name})
    return svc.entities.add(ent)


def _seed_member(svc, root, *, entity_type="family", first_name="Jane"):
    ent = Entity(entity_type=entity_type, target_entity_id=root.id,
                 extra_data={"first_name": first_name})
    return svc.entities.add(ent)


def _seed_phone(svc, owner, *, number="+15550000001"):
    ph = PhoneNumber(
        entity_id=owner.id,
        phone_number=number,
        classification_type="type_a",
        ingestion_source="manual",
        verification_status="pending",
    )
    return svc.phones.add(ph)


# ---------------------------------------------------------------------------
# patch + soft-delete + restore — all the behaviours the SQL-only suite pins
# ---------------------------------------------------------------------------


class TestPatchEntity:
    def test_updates_first_name(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        out = svc.patch_entity(member.id, first_name="Janet")
        assert out.extra_data["first_name"] == "Janet"

    def test_strong_identifier_is_added_and_can_be_cleared(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        out = svc.patch_entity(member.id, strong_identifier="X-7842")
        assert out.strong_identifier == "X-7842"
        out2 = svc.patch_entity(member.id, strong_identifier="")
        assert out2.strong_identifier is None


class TestSoftDeleteEntityCascade:
    def test_root_delete_cascades_to_members_and_their_phones(self, svc):
        root = _seed_root(svc)
        jane = _seed_member(svc, root, first_name="Jane")
        bob  = _seed_member(svc, root, first_name="Bob", entity_type="friend")
        jane_phone = _seed_phone(svc, jane, number="+15550001000")
        bob_phone  = _seed_phone(svc, bob, number="+15550002000")

        summary = svc.soft_delete_entity(root.id)
        assert summary["entity_id"] == root.id
        assert summary["phones_deleted"] == 2
        assert summary["entities_deleted"] == 3
        gid = summary["deletion_group_id"]
        assert gid

        for old_id in (root.id, jane.id, bob.id):
            row = svc.entities.get(old_id)
            assert row.deleted_at is not None
            assert row.deletion_group_id == gid
        for old_id in (jane_phone.id, bob_phone.id):
            row = svc.phones.get(old_id)
            assert row.deleted_at is not None
            assert row.deletion_group_id == gid


class TestRestoreSymmetry:
    def test_restore_reverses_the_cascade(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root)
        phone = _seed_phone(svc, member)

        svc.soft_delete_entity(member.id)
        out = svc.restore_entity(member.id)
        assert out == {
            "entity_id":          member.id,
            "phones_restored":    1,
            "entities_restored":  1,
        }
        assert svc.entities.get(member.id).deleted_at is None
        assert svc.phones.get(phone.id).deleted_at is None

    def test_restore_does_not_resurrect_unrelated_deletes(self, svc):
        root = _seed_root(svc)
        member = _seed_member(svc, root, first_name="Jane")
        # Pre-tombstone the member in a SEPARATE action — different group id.
        svc.soft_delete_entity(member.id)
        # Now delete the root in its own cascade.
        bob = _seed_member(svc, root, first_name="Bob", entity_type="friend")
        root_summary = svc.soft_delete_entity(root.id)
        # bob was alive at root-delete time → joins the cascade.
        assert root_summary["entities_deleted"] == 2

        # Restoring the root brings bob back, NOT the pre-existing member tombstone.
        svc.restore_entity(root.id)
        assert svc.entities.get(root.id).deleted_at is None
        assert svc.entities.get(bob.id).deleted_at is None
        assert svc.entities.get(member.id).deleted_at is not None


class TestListEntitiesByDerivedClientId:
    def test_filter_by_client_ids_returns_whole_family(self, svc):
        root_a = _seed_root(svc, first_name="A")
        root_b = _seed_root(svc, first_name="B")
        m_a = _seed_member(svc, root_a)
        m_b = _seed_member(svc, root_b)

        out = svc.list_entities(client_ids=[root_a.id])
        assert {e.id for e in out} == {root_a.id, m_a.id}

        out = svc.list_entities(client_ids=[root_a.id, root_b.id])
        assert {e.id for e in out} == {root_a.id, root_b.id, m_a.id, m_b.id}


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
        assert svc.phones.get(ph.id).deleted_at is not None
        svc.restore_phone(ph.id)
        assert svc.phones.get(ph.id).deleted_at is None
