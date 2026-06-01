"""
test_data_admin_service.py — UAT round-3: soft-delete + edit + restore.

Covers the new `DataAdminService` end-to-end at the service layer:
  - patch_entity applies partial updates and merges extra_data
  - soft_delete_entity tombstones the row AND cascades to phones
  - restore_entity clears the tombstone but does NOT auto-restore phones
  - patch_phone / soft_delete_phone / restore_phone mirror the same shape
  - get_entity / get_phone raise when called on missing or deleted rows
  - list_entities filters by client / entity_type / deleted state / q

The service is the single writer for tombstones — these tests pin the
contract the endpoint layer and the frontend mock-parity layer both
depend on.
"""

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool

# Triggers metadata registration of every table.
import models  # noqa: F401
from models.entity import Entity
from models.phone_number import PhoneNumber
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
        client_id=1,
        entity_type="target",
        target_entity_id=None,
        extra_data={"first_name": "Root", "last_name": "Target"},
    )
    session.add(ent)
    session.commit()
    session.refresh(ent)
    return ent


@pytest.fixture()
def associated(session, primary) -> Entity:
    ent = Entity(
        client_id=1,
        entity_type="family",
        target_entity_id=primary.id,
        extra_data={"first_name": "Jane", "last_name": "Doe"},
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
        classification_type="type_a",
        ingestion_source="manual",
        verification_status="pending",
    )
    session.add(ph)
    session.commit()
    session.refresh(ph)
    return ph


# ---------------------------------------------------------------------------
# patch_entity
# ---------------------------------------------------------------------------


class TestPatchEntity:
    def test_updates_first_name_inside_extra_data(self, svc, associated):
        out = svc.patch_entity(associated.id, first_name="Janet")
        assert out.extra_data["first_name"] == "Janet"
        # untouched
        assert out.extra_data["last_name"] == "Doe"

    def test_updates_relation_and_moves_to_new_client_root(self, svc, session, associated):
        # Two-level model: "changing the client" = repointing
        # target_entity_id at a different root. client_id derives.
        other_root = Entity(
            entity_type="target", target_entity_id=None,
            extra_data={"first_name": "Other Root"},
        )
        session.add(other_root)
        session.commit()
        session.refresh(other_root)
        out = svc.patch_entity(
            associated.id, relation_type="colleague",
            target_entity_id=other_root.id,
        )
        assert out.entity_type == "colleague"
        assert out.client_id == other_root.id

    def test_strong_identifier_is_added_and_can_be_cleared(self, svc, associated):
        # UAT round-3: strong_identifier moved from extra_data to a
        # first-class indexed column.
        out = svc.patch_entity(associated.id, strong_identifier="X-7842")
        assert out.strong_identifier == "X-7842"
        out2 = svc.patch_entity(associated.id, strong_identifier="")
        assert out2.strong_identifier is None

    def test_patch_on_missing_entity_raises(self, svc):
        with pytest.raises(ValueError):
            svc.patch_entity(99999, first_name="Ghost")

    def test_patch_on_deleted_entity_raises(self, svc, associated):
        svc.soft_delete_entity(associated.id)
        with pytest.raises(ValueError):
            svc.patch_entity(associated.id, first_name="Resurrected")


# ---------------------------------------------------------------------------
# soft_delete_entity — cascade rule
# ---------------------------------------------------------------------------


class TestSoftDeleteEntity:
    def test_tombstones_entity_and_cascades_to_phones(
        self, svc, session, associated, phone
    ):
        summary = svc.soft_delete_entity(associated.id)
        assert summary["entity_id"]       == associated.id
        assert summary["phones_deleted"]   == 1
        assert summary["entities_deleted"] == 1
        # UAT round-3 — every cascaded row shares the same group id.
        assert summary["deletion_group_id"]
        gid = summary["deletion_group_id"]

        session.refresh(associated)
        session.refresh(phone)
        assert associated.deleted_at is not None
        assert phone.deleted_at is not None
        assert associated.deletion_group_id == gid
        assert phone.deletion_group_id == gid

    def test_root_delete_cascades_through_children_and_their_phones(
        self, svc, session, primary, associated, phone
    ):
        """
        UAT round-3: deleting a root (client head) must propagate to
        every associated entity that points to it AND to those
        associated entities' phones — not just the root's own phones.
        """
        from models.phone_number import PhoneNumber
        # Add a second associated entity + its own phone, to prove the
        # cascade walks more than one child.
        bob = Entity(
            client_id=1,
            entity_type="friend",
            target_entity_id=primary.id,
            extra_data={"first_name": "Bob"},
        )
        session.add(bob)
        session.commit()
        session.refresh(bob)
        bob_phone = PhoneNumber(
            entity_id=bob.id,
            phone_number="+972502222222",
            classification_type="type_a",
            ingestion_source="manual",
            verification_status="pending",
        )
        session.add(bob_phone)
        session.commit()

        summary = svc.soft_delete_entity(primary.id)
        # 3 entities deleted: primary + associated (Jane) + bob.
        # 2 phones deleted: Jane's phone + Bob's phone.
        assert summary["entity_id"]         == primary.id
        assert summary["phones_deleted"]    == 2
        assert summary["entities_deleted"]  == 3
        assert summary["deletion_group_id"]

        gid = summary["deletion_group_id"]
        for row in (primary, associated, bob, phone, bob_phone):
            session.refresh(row)
            assert row.deleted_at is not None
            assert row.deletion_group_id == gid

    def test_already_deleted_phones_are_not_re_tombstoned(
        self, svc, session, associated, phone
    ):
        # Pre-tombstone the phone independently.
        svc.soft_delete_phone(phone.id)
        session.refresh(phone)
        first_ts = phone.deleted_at

        # Cascade should leave the prior timestamp untouched.
        svc.soft_delete_entity(associated.id)
        session.refresh(phone)
        assert phone.deleted_at == first_ts

    def test_double_delete_raises(self, svc, associated):
        svc.soft_delete_entity(associated.id)
        with pytest.raises(ValueError):
            svc.soft_delete_entity(associated.id)


# ---------------------------------------------------------------------------
# restore_entity — asymmetric (no phone cascade)
# ---------------------------------------------------------------------------


class TestRestoreEntity:
    def test_restore_reverses_the_cascade_via_group_id(
        self, svc, session, associated, phone
    ):
        # UAT round-3: restore is symmetric with delete. Every row
        # stamped with the same deletion_group_id comes back.
        svc.soft_delete_entity(associated.id)
        summary = svc.restore_entity(associated.id)
        assert summary == {
            "entity_id":         associated.id,
            "phones_restored":   1,
            "entities_restored": 1,
        }
        session.refresh(associated)
        session.refresh(phone)
        assert associated.deleted_at is None
        assert associated.deletion_group_id is None
        assert phone.deleted_at is None
        assert phone.deletion_group_id is None

    def test_restore_does_not_resurrect_unrelated_deletes(
        self, svc, session, primary, associated, phone,
    ):
        # Deliberately delete the associated entity first (separate
        # group_id). Then delete the root (another group_id).
        # Restoring the root must bring back ONLY the rows from the
        # root's group — not the associated, which was wiped earlier
        # by a different operator action.
        svc.soft_delete_entity(associated.id)
        # Add a second associated to test the partial restore.
        from models.entity import Entity
        bob = Entity(
            client_id=1, entity_type="friend",
            target_entity_id=primary.id, extra_data={"first_name": "Bob"},
        )
        session.add(bob); session.commit(); session.refresh(bob)

        # Root delete cascades through bob (associated was already
        # tombstoned and stays out of the new cascade's scope).
        root_delete_summary = svc.soft_delete_entity(primary.id)
        # bob was alive at root-delete time → it joins the cascade.
        assert root_delete_summary["entities_deleted"] == 2  # primary + bob

        # Restore the root. Bob comes back. Associated stays deleted.
        restore_summary = svc.restore_entity(primary.id)
        assert restore_summary["entities_restored"] == 2  # primary + bob

        session.refresh(primary)
        session.refresh(associated)
        session.refresh(bob)
        assert primary.deleted_at is None
        assert bob.deleted_at is None
        assert associated.deleted_at is not None  # unrelated, stays deleted

    def test_restore_is_idempotent_on_active_row(self, svc, associated):
        out = svc.restore_entity(associated.id)
        assert out == {
            "entity_id":         associated.id,
            "phones_restored":   0,
            "entities_restored": 0,
        }

    def test_restore_missing_raises(self, svc):
        with pytest.raises(ValueError):
            svc.restore_entity(99999)


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

    def test_filter_by_client_id(self, svc, session, primary):
        # primary is a root → its derived client_id == primary.id.
        # Add a second-client root entity.
        other = Entity(entity_type="target", target_entity_id=None, extra_data={})
        session.add(other)
        session.commit()
        session.refresh(other)
        rows = svc.list_entities(client_id=primary.id)
        assert {r.client_id for r in rows} == {primary.id}

    def test_filter_by_client_ids_multivalue(self, svc, session, primary):
        roots = []
        for _ in range(2):
            root = Entity(entity_type="target", target_entity_id=None, extra_data={})
            session.add(root)
            roots.append(root)
        session.commit()
        for root in roots:
            session.refresh(root)
        root_b = roots[1]
        rows = svc.list_entities(client_ids=[primary.id, root_b.id])
        assert {r.client_id for r in rows} == {primary.id, root_b.id}

    def test_filter_by_entity_type(self, svc, primary, associated):
        targets = svc.list_entities(entity_type="target")
        assert all(r.entity_type == "target" for r in targets)
        family = svc.list_entities(entity_type="family")
        assert all(r.entity_type == "family" for r in family)

    def test_q_substring_matches_first_name(self, svc, associated):
        rows = svc.list_entities(q="Jan")
        assert associated.id in {r.id for r in rows}
        rows = svc.list_entities(q="no-such-needle")
        assert rows == []


# ---------------------------------------------------------------------------
# Phone operations — mirror the entity contract
# ---------------------------------------------------------------------------


class TestPhoneOps:
    def test_patch_phone_updates_number(self, svc, phone):
        out = svc.patch_phone(phone.id, phone_number="+972502222222")
        assert out.phone_number == "+972502222222"

    def test_soft_delete_phone_then_restore(self, svc, session, phone):
        svc.soft_delete_phone(phone.id)
        session.refresh(phone)
        assert phone.deleted_at is not None
        svc.restore_phone(phone.id)
        session.refresh(phone)
        assert phone.deleted_at is None

    def test_get_phone_default_hides_deleted(self, svc, phone):
        svc.soft_delete_phone(phone.id)
        with pytest.raises(ValueError):
            svc.get_phone(phone.id)
        # include_deleted=True bypass works.
        out = svc.get_phone(phone.id, include_deleted=True)
        assert out.deleted_at is not None
