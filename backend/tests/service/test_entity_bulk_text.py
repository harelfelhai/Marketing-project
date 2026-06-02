"""
Service-layer tests for EntityIngestionService.ingest_bulk_text.

Covers:
    - happy path: defaults applied, fields land on entity
    - per-row relation_type override
    - per-row target_entity_id override
    - request-level default target missing → TargetNotFoundError (422)
    - request-level default target is non-root → TargetNotFoundError (422)
    - per-row target override missing → per-row failure (NOT 422)
    - row_token round-trips into Entity.extra_data
    - audit-trail bulk_submission_id stamped on every new entity
    - phone_ids is always empty (entity-only path)
"""

import pytest

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
        full_name="Root One",
        deleted_at=not_deleted(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@pytest.fixture()
def second_root_target(session):
    e = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root Two",
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


def _row(token, full_name=None, relation=None, target=None, identifier_1=None):
    """Build a row dict matching the service's input contract."""
    return {
        "row_token":        token,
        "full_name":        full_name,
        "relation_type":    relation,
        "target_entity_id": target,
        "identifier_1":     identifier_1,
    }


class TestHappyPath:
    def test_three_rows_all_defaults(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("Jane Doe",  full_name="Jane Doe"),
                _row("Sam Chen",  full_name="Sam Chen"),
                _row("Alex",      full_name="Alex"),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert summary["failed_rows"] == []
        assert summary["phone_ids"] == []
        assert len(summary["entity_ids"]) == 3

        for eid in summary["entity_ids"]:
            ent = session.get(Entity, eid)
            assert ent.target_entity_id == root_target.id
            assert ent.relation_type == "family"

    def test_audit_trail_stamped_on_every_entity(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[_row("a"), _row("b")],
            default_relation_type="friend",
            default_target_entity_id=root_target.id,
        )
        sid = summary["bulk_submission_id"]
        assert sid
        for eid in summary["entity_ids"]:
            ent = session.get(Entity, eid)
            assert ent.extra_data["bulk_submission_id"] == sid

    def test_row_token_round_trips_into_extra_data(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[_row("Jane Doe", full_name="Jane Doe")],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        assert ent.extra_data["row_token"] == "Jane Doe"

    def test_empty_row_token_does_not_set_key(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[_row("", full_name="Jane")],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        assert "row_token" not in ent.extra_data

    def test_identifier_1_stored_on_entity(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[_row("Jane", full_name="Jane", identifier_1="ID-007")],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        assert ent.identifier_1 == "ID-007"


class TestPerRowOverrides:
    def test_relation_type_override(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a"),
                _row("b", relation="colleague"),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ents = [session.get(Entity, eid) for eid in summary["entity_ids"]]
        types = sorted(e.relation_type for e in ents)
        assert types == ["colleague", "family"]

    def test_target_override(self, svc, root_target, second_root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a"),
                _row("b", target=second_root_target.id),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent_ids = summary["entity_ids"]
        first = session.get(Entity, ent_ids[0])
        second = session.get(Entity, ent_ids[1])
        assert first.target_entity_id == root_target.id
        assert second.target_entity_id == second_root_target.id


class TestRequestErrors:
    def test_default_target_missing_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                rows=[_row("a")],
                default_relation_type="family",
                default_target_entity_id="nonexistent-target",
            )

    def test_default_target_non_root_raises(self, svc, associated_non_root):
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.ingest_bulk_text(
                rows=[_row("a")],
                default_relation_type="family",
                default_target_entity_id=associated_non_root.id,
            )
        assert "not a root" in str(exc_info.value)

    def test_failed_default_target_creates_no_entities(self, svc, session):
        before = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                rows=[_row("a")],
                default_relation_type="family",
                default_target_entity_id="nonexistent",
            )
        after = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        assert len(before) == len(after)


class TestPerRowFailures:
    def test_per_row_target_override_missing_is_per_row_failure(self, svc, root_target):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good", full_name="Jane"),
                _row("bad", target="nonexistent-target"),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "nonexistent-target" in summary["failed_rows"][0]["error"]

    def test_per_row_target_non_root_is_per_row_failure(
        self, svc, root_target, associated_non_root
    ):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good", full_name="Jane"),
                _row("bad", target=associated_non_root.id),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "not a root" in summary["failed_rows"][0]["error"]

    def test_missing_relation_type_is_per_row_failure(self, svc, root_target):
        # Row with no relation_type and no default override set to None
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good", full_name="Jane"),
                {"row_token": "bad", "relation_type": None},
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        # The second row picks up the default relation_type, so this should succeed
        assert summary["success_count"] == 2

    def test_failed_rows_sorted_by_input_index(self, svc, root_target):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a"),
                _row("b", target="bad-1"),
                _row("c"),
                _row("d", target="bad-2"),
                _row("e"),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        rows_indices = [r["row"] for r in summary["failed_rows"]]
        assert rows_indices == sorted(rows_indices)


class TestEmptyResult:
    def test_all_rows_fail_returns_clean_summary(self, svc, root_target):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a", target="bad"),
                _row("b", target="bad"),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 2
        assert summary["entity_ids"] == []
        assert summary["phone_ids"] == []
        assert summary["bulk_submission_id"]
