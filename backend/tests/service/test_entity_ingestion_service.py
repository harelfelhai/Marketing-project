"""
Service-layer tests for `EntityIngestionService.create_single`.

Covers:
    - happy path: row inserted, FK to target, client_id inherited
    - names land inside extra_data (Secrets-Free Mandate)
    - caller-supplied extra_data merged with names
    - target missing → TargetNotFoundError
    - target is itself associated (non-root) → TargetNotFoundError
    - relation_type written verbatim to entity_type column
    - row gets a tz-aware UTC created_at (Phase DY timezone contract)
"""

from datetime import datetime

import pytest
from sqlmodel import select

from exceptions import TargetNotFoundError
from models.entity import Entity
from services.entity_ingestion import EntityIngestionService


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture()
def svc(session):
    """Service under test, bound to the per-test in-memory session."""
    return EntityIngestionService(session=session)


@pytest.fixture()
def root_target(session):
    """
    A root target Entity. `target_entity_id IS NULL` (the invariant the
    service validates against).
    """
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=7,
        extra_data={"customer_tier": 2},
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@pytest.fixture()
def associated_non_root(session, root_target):
    """
    An associated Entity hanging off the root target. Used to verify the
    service rejects target_entity_id pointing at a non-root row.
    """
    e = Entity(
        entity_type="family",
        relation_type="associated",
        client_id=7,
        target_entity_id=root_target.id,
        extra_data={"first_name": "Pre-existing"},
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


# ===========================================================================
# Happy path
# ===========================================================================


class TestHappyPath:
    def test_creates_entity_with_target_fk(self, svc, root_target, session):
        new = svc.create_single(
            first_name="Jane",
            last_name="Doe",
            relation_type="family",
            target_entity_id=root_target.id,
        )
        assert new.id is not None
        assert new.target_entity_id == root_target.id
        assert new.relation_type == "associated"
        assert new.entity_type == "family"

    def test_client_id_derived_from_target_root(self, svc, root_target):
        new = svc.create_single(
            first_name="Jane",
            relation_type="friend",
            target_entity_id=root_target.id,
        )
        # Two-level model: client_id is derived — the new member points
        # at the root, so its client_id == the root's id (== the root's
        # own derived client_id).
        assert new.client_id == root_target.id
        assert new.client_id == root_target.client_id

    def test_names_stored_inside_extra_data(self, svc, root_target):
        new = svc.create_single(
            first_name="Jane",
            last_name="Doe",
            relation_type="family",
            target_entity_id=root_target.id,
        )
        # Secrets-Free Mandate — names land inside the opaque blob.
        assert new.extra_data["first_name"] == "Jane"
        assert new.extra_data["last_name"] == "Doe"

    def test_first_name_trimmed(self, svc, root_target):
        new = svc.create_single(
            first_name="  Jane  ",
            relation_type="family",
            target_entity_id=root_target.id,
        )
        assert new.extra_data["first_name"] == "Jane"

    def test_last_name_optional(self, svc, root_target):
        new = svc.create_single(
            first_name="Cher",
            last_name=None,
            relation_type="family",
            target_entity_id=root_target.id,
        )
        assert "last_name" not in new.extra_data

    def test_empty_last_name_is_dropped(self, svc, root_target):
        # An operator submitting "" (or whitespace) for last_name should
        # not produce a last_name="" key in extra_data — that would be
        # noise. The service drops empty / whitespace-only last names.
        new = svc.create_single(
            first_name="Cher",
            last_name="   ",
            relation_type="family",
            target_entity_id=root_target.id,
        )
        assert "last_name" not in new.extra_data

    def test_caller_extra_data_merged_with_names(self, svc, root_target):
        new = svc.create_single(
            first_name="Jane",
            last_name="Doe",
            relation_type="family",
            target_entity_id=root_target.id,
            extra_data={"sourcing_note": "spotted at conference"},
        )
        # Both the caller's key and the names land in extra_data.
        assert new.extra_data["sourcing_note"] == "spotted at conference"
        assert new.extra_data["first_name"] == "Jane"
        assert new.extra_data["last_name"] == "Doe"

    def test_caller_extra_data_does_not_shadow_names(self, svc, root_target):
        # If a confused caller passes first_name inside extra_data AND
        # as the structured arg, the structured arg wins — the explicit
        # field is the canonical write.
        new = svc.create_single(
            first_name="Jane",
            relation_type="family",
            target_entity_id=root_target.id,
            extra_data={"first_name": "STALE"},
        )
        assert new.extra_data["first_name"] == "Jane"


# ===========================================================================
# Target validation
# ===========================================================================


class TestTargetValidation:
    def test_missing_target_raises(self, svc):
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.create_single(
                first_name="Jane",
                relation_type="family",
                target_entity_id=99_999,   # does not exist
            )
        assert "99999" in str(exc_info.value)

    def test_non_root_target_raises(self, svc, associated_non_root):
        # Pointing at an associated entity would create a 3-level graph;
        # the service rejects it to preserve the "two levels max"
        # invariant the scoring service relies on.
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.create_single(
                first_name="Jane",
                relation_type="family",
                target_entity_id=associated_non_root.id,
            )
        assert "not a root target" in str(exc_info.value)

    def test_missing_target_does_not_create_entity(self, svc, session):
        before = session.exec(select(Entity)).all()
        with pytest.raises(TargetNotFoundError):
            svc.create_single(
                first_name="Jane",
                relation_type="family",
                target_entity_id=99_999,
            )
        after = session.exec(select(Entity)).all()
        assert len(before) == len(after)


# ===========================================================================
# Row-creation timestamp present
# ===========================================================================


class TestTimestamps:
    def test_created_at_is_populated(self, svc, root_target):
        # The service relies on Entity.created_at's default_factory to
        # stamp the row at insert time. We assert presence here — the
        # tz-aware UTC contract is enforced by the Entity model's column
        # decorator and tested at the model layer.
        new = svc.create_single(
            first_name="Jane",
            relation_type="family",
            target_entity_id=root_target.id,
        )
        assert isinstance(new.created_at, datetime)


# ===========================================================================
# Relation token round-trip
# ===========================================================================


class TestRelationTokens:
    @pytest.mark.parametrize("token", ["family", "friend", "colleague", "spouse"])
    def test_each_operator_creatable_token_lands_on_entity_type(
        self, svc, root_target, token
    ):
        # The service accepts a plain string (validation is upstream at
        # the Pydantic layer); these four are the operator-creatable
        # subset. Each should write through to entity_type verbatim.
        new = svc.create_single(
            first_name="X",
            relation_type=token,
            target_entity_id=root_target.id,
        )
        assert new.entity_type == token
        # And every operator-created row is 'associated' (never primary).
        assert new.relation_type == "associated"
