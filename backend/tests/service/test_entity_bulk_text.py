"""
Service-layer tests for `EntityIngestionService.ingest_bulk_text`.

Covers the Phase E2-B two-step grid contract end-to-end:
    - happy path: defaults applied, names land in extra_data
    - per-row relation_type override
    - per-row target_entity_id override
    - request-level default target missing → TargetNotFoundError (422)
    - request-level default target is non-root → TargetNotFoundError (422)
    - per-row target override missing → per-row failure (NOT 422)
    - per-row target override is non-root → per-row failure (NOT 422)
    - empty first_name → per-row failure
    - row_token round-trips into Entity.extra_data
    - audit-trail bulk_submission_id stamped on every new entity
    - phone_ids is always empty (entity-only path)
    - same first/last name across rows DOES NOT dedup (people share names)
"""

import pytest

from exceptions import TargetNotFoundError
from models.entity import Entity
from services.entity_ingestion import EntityIngestionService


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture()
def svc(session):
    return EntityIngestionService(session=session)


@pytest.fixture()
def root_target(session):
    """A root target. target_entity_id IS NULL, client_id=1."""
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=1,
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@pytest.fixture()
def second_root_target(session):
    """A second root target, different client_id (=2)."""
    e = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=2,
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@pytest.fixture()
def associated_non_root(session, root_target):
    """An associated entity hanging off `root_target`. Not itself a root."""
    e = Entity(
        entity_type="family",
        relation_type="associated",
        client_id=root_target.client_id,
        target_entity_id=root_target.id,
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


def _row(token, first, last=None, relation=None, target=None):
    """Build a row dict matching the service's input contract."""
    return {
        "row_token":        token,
        "first_name":       first,
        "last_name":        last,
        "relation_type":    relation,
        "target_entity_id": target,
    }


# ===========================================================================
# Happy path
# ===========================================================================


class TestHappyPath:
    def test_three_rows_all_defaults(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("Jane Doe",  "Jane",  "Doe"),
                _row("Sam Chen",  "Sam",   "Chen"),
                _row("Mononym",   "Alex"),       # no last_name
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 3
        assert summary["failed_count"] == 0
        assert summary["failed_rows"] == []
        assert summary["phone_ids"] == []           # entity path → no phones
        assert len(summary["entity_ids"]) == 3

        # Every new entity attaches to the same default target.
        for eid in summary["entity_ids"]:
            ent = session.get(Entity, eid)
            assert ent.target_entity_id == root_target.id
            assert ent.entity_type == "family"      # inherited default
            assert ent.client_id == root_target.client_id

    def test_names_land_inside_extra_data(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[_row("Jane Doe", "Jane", "Doe")],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        # Secrets-Free Mandate — names inside the opaque blob, not on
        # schema-level columns.
        assert ent.extra_data["first_name"] == "Jane"
        assert ent.extra_data["last_name"] == "Doe"

    def test_audit_trail_stamped_on_every_entity(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a", "A"),
                _row("b", "B"),
            ],
            default_relation_type="friend",
            default_target_entity_id=root_target.id,
        )
        sid = summary["bulk_submission_id"]
        assert sid
        for eid in summary["entity_ids"]:
            ent = session.get(Entity, eid)
            assert ent.extra_data["bulk_submission_id"] == sid

    def test_row_token_round_trips_into_extra_data(
        self, svc, root_target, session
    ):
        summary = svc.ingest_bulk_text(
            rows=[_row("Jane Doe", "Jane", "Doe")],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        assert ent.extra_data["row_token"] == "Jane Doe"

    def test_empty_row_token_does_not_set_key(self, svc, root_target, session):
        # Rows the operator manually adds inside the grid have no
        # original token. The service must not insert an empty-string
        # row_token key — that would be noise.
        summary = svc.ingest_bulk_text(
            rows=[_row("", "Jane")],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        assert "row_token" not in ent.extra_data

    def test_duplicate_names_across_rows_do_not_dedup(
        self, svc, root_target, session
    ):
        # Unlike phones (UNIQUE constraint on phone_number), people can
        # legitimately share names — two "Jane Doe"s under the same
        # target are valid input and must both insert.
        summary = svc.ingest_bulk_text(
            rows=[
                _row("Jane Doe (1)", "Jane", "Doe"),
                _row("Jane Doe (2)", "Jane", "Doe"),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0


# ===========================================================================
# Per-row overrides
# ===========================================================================


class TestPerRowOverrides:
    def test_relation_type_override(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a", "A"),                            # inherits family
                _row("b", "B", relation="colleague"),      # override
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ents = [session.get(Entity, eid) for eid in summary["entity_ids"]]
        types = sorted(e.entity_type for e in ents)
        assert types == ["colleague", "family"]

    def test_target_override_other_client_inherits_client_id(
        self, svc, root_target, second_root_target, session
    ):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a", "A"),                                       # default target
                _row("b", "B", target=second_root_target.id),         # override
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        # Each entity's client_id is inherited from its OWN target,
        # not the default — this is the partition-drift guard.
        ent_ids = summary["entity_ids"]
        first  = session.get(Entity, ent_ids[0])
        second = session.get(Entity, ent_ids[1])
        assert first.target_entity_id == root_target.id
        assert first.client_id == root_target.id
        assert second.target_entity_id == second_root_target.id
        assert second.client_id == second_root_target.id


# ===========================================================================
# Request-level errors (raise TargetNotFoundError → 422)
# ===========================================================================


class TestRequestErrors:
    def test_default_target_missing_raises(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                rows=[_row("a", "A")],
                default_relation_type="family",
                default_target_entity_id=99_999,
            )

    def test_default_target_non_root_raises(
        self, svc, associated_non_root
    ):
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.ingest_bulk_text(
                rows=[_row("a", "A")],
                default_relation_type="family",
                default_target_entity_id=associated_non_root.id,
            )
        assert "not a root" in str(exc_info.value)

    def test_failed_default_target_creates_no_entities(
        self, svc, session
    ):
        before = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                rows=[_row("a", "A")],
                default_relation_type="family",
                default_target_entity_id=99_999,
            )
        after = session.exec(
            __import__("sqlmodel").select(Entity)
        ).all()
        assert len(before) == len(after)


# ===========================================================================
# Per-row failures (collected in failed_rows; NOT a request-level abort)
# ===========================================================================


class TestPerRowFailures:
    def test_empty_first_name_is_per_row_failure(self, svc, root_target):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good",  "Jane", "Doe"),
                _row("empty", ""),                       # bad
                _row("ws",    "   "),                    # whitespace-only
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 2
        assert summary["failed_rows"][0]["row"] == 2
        assert "first_name" in summary["failed_rows"][0]["error"].lower()
        assert summary["failed_rows"][1]["row"] == 3

    def test_per_row_target_override_missing_is_per_row_failure(
        self, svc, root_target
    ):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good", "Jane", "Doe"),
                _row("bad",  "Bad",  target=99_999),     # override doesn't resolve
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        # The default target IS valid, so the request does not abort.
        # The bad per-row override lands as a per-row failure.
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert summary["failed_rows"][0]["row"] == 2
        assert "99999" in summary["failed_rows"][0]["error"]

    def test_per_row_target_override_non_root_is_per_row_failure(
        self, svc, root_target, associated_non_root
    ):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good", "Jane", "Doe"),
                _row("bad",  "Bad",  target=associated_non_root.id),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "not a root" in summary["failed_rows"][0]["error"]

    def test_invalid_relation_token_is_per_row_failure(self, svc, root_target):
        # The endpoint's Pydantic guard catches illegal request-level
        # tokens, but the service-layer guard is defensive — direct
        # callers (tests, internal scripts) might construct rows in
        # code without the enum. The service must still reject.
        summary = svc.ingest_bulk_text(
            rows=[
                _row("good", "Jane"),
                _row("bad",  "Mal", relation="hacker"),  # not in subset
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 1
        assert summary["failed_count"] == 1
        assert "hacker" in summary["failed_rows"][0]["error"]

    def test_failed_rows_sorted_by_input_index(self, svc, root_target):
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a", "A"),                  # ok
                _row("b", ""),                   # fail row 2
                _row("c", "C"),                  # ok
                _row("d", "", target=99_999),    # fail row 4 (first_name fails first)
                _row("e", "E"),                  # ok
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        rows_indices = [r["row"] for r in summary["failed_rows"]]
        assert rows_indices == sorted(rows_indices)


# ===========================================================================
# Empty-result edge case
# ===========================================================================


class TestEmptyResult:
    def test_all_rows_fail_returns_clean_summary(self, svc, root_target):
        # Every row is bad in some way; the service should still return
        # a well-formed summary, not raise.
        summary = svc.ingest_bulk_text(
            rows=[
                _row("a", ""),
                _row("b", ""),
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 2
        assert summary["entity_ids"] == []
        assert summary["phone_ids"] == []
        assert summary["bulk_submission_id"]   # uuid still minted
