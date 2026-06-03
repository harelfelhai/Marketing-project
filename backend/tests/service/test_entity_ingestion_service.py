"""
Service-layer tests for EntityIngestionService.create_single.

Covers:
    - happy path: row inserted with correct fields
    - target validation: missing, non-root
    - row with all optional fields
    - transaction safety: failed target does not create entity
"""

import pytest
from sqlmodel import select

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.types import not_deleted
from services.entity_ingestion import EntityIngestionService
from repositories.storage import SqlStorage


@pytest.fixture()
def svc(session):
    return EntityIngestionService(storage=SqlStorage(session))


@pytest.fixture()
def root_target(session):
    e = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root Person",
        deleted_at=not_deleted(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@pytest.fixture()
def associated_non_root(session, root_target):
    e = Entity(
        relation_type="family",
        target_entity_id=root_target.id,
        deleted_at=not_deleted(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


class TestHappyPath:
    def test_creates_entity_with_target_fk(self, svc, root_target, session):
        new = svc.create_single(
            relation_type="family",
            target_entity_id=root_target.id,
            full_name="Jane Doe",
        )
        assert new.id is not None
        assert new.target_entity_id == root_target.id
        assert new.relation_type == "family"
        assert new.full_name == "Jane Doe"

    def test_all_optional_fields(self, svc, root_target):
        new = svc.create_single(
            relation_type="family",
            target_entity_id=root_target.id,
            full_name="Jane",
            identifier_1="ID-001",
            identifier_2="ID-002",
            extra_data={"note": "test"},
        )
        assert new.identifier_1 == "ID-001"
        assert new.identifier_2 == "ID-002"
        assert new.extra_data["note"] == "test"

    def test_root_entity_no_target(self, svc):
        new = svc.create_single(
            relation_type="primary",
            full_name="Root New",
        )
        assert new.id is not None
        assert new.target_entity_id is None


class TestTargetValidation:
    def test_missing_target_raises(self, svc):
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.create_single(
                relation_type="family",
                target_entity_id="nonexistent-id",
            )
        assert "nonexistent-id" in str(exc_info.value)

    def test_non_root_target_raises(self, svc, associated_non_root):
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.create_single(
                relation_type="family",
                target_entity_id=associated_non_root.id,
            )
        assert "not a root target" in str(exc_info.value)

    def test_missing_target_does_not_create_entity(self, svc, session):
        before = session.exec(select(Entity)).all()
        with pytest.raises(TargetNotFoundError):
            svc.create_single(
                relation_type="family",
                target_entity_id="nonexistent",
            )
        after = session.exec(select(Entity)).all()
        assert len(before) == len(after)
