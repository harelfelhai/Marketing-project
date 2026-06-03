"""
test_api_repository.py — the 'api' (HTTP/REST) backend, isolated.

Exercises ApiRepository against an in-memory httpx MockTransport (no network),
with the same intent as the cross-backend contract suite: CRUD round-trips,
the full filter DSL, the soft-delete sentinel datetime surviving JSON, field
mapping, the bare-array envelope vs a wrapped envelope, and the Session
aggregate whose PK is `token` (not `id`).
"""

import json

import httpx
import pytest

from models.entity import Entity
from models.user import Session as UserSession
from models.types import SOFT_DELETE_SENTINEL, not_deleted, utc_now
from repositories.api_repository import ApiBackendError, ApiRepository
from tests.repositories.fake_api import BASE_URL, make_fake_api


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _entity_repo(field_map=None, rows_path=""):
    client, store = make_fake_api()
    repo = ApiRepository(
        client, BASE_URL, Entity,
        path="entity", rows_path=rows_path, field_map=field_map or {},
    )
    return repo, store


def _root(**extra):
    return Entity(relation_type="primary", target_entity_id=None,
                  deleted_at=not_deleted(), extra_data=extra or {})


def _member(root_id, relation_type="family", **extra):
    return Entity(relation_type=relation_type, target_entity_id=root_id,
                  deleted_at=not_deleted(), extra_data=extra or {})


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

class TestCrud:
    def test_add_then_get_round_trips(self):
        repo, _ = _entity_repo()
        ent = _root(some_key="value")
        repo.add(ent)
        got = repo.get(ent.id)
        assert got is not None and got.id == ent.id
        assert got.relation_type == "primary"
        assert got.extra_data["some_key"] == "value"

    def test_get_missing_returns_none(self):
        repo, _ = _entity_repo()
        assert repo.get("does-not-exist") is None

    def test_update_persists_mutation(self):
        repo, _ = _entity_repo()
        ent = _root()
        repo.add(ent)
        ent.full_name = "Updated"
        repo.update(ent)
        assert repo.get(ent.id).full_name == "Updated"

    def test_delete_removes_row(self):
        repo, _ = _entity_repo()
        ent = _root()
        repo.add(ent)
        repo.delete(ent.id)
        assert repo.get(ent.id) is None

    def test_delete_missing_is_noop(self):
        repo, _ = _entity_repo()
        repo.delete("nope")  # must not raise

    def test_count(self):
        repo, _ = _entity_repo()
        repo.add(_root())
        repo.add(_root())
        assert repo.count() == 2


# ---------------------------------------------------------------------------
# Datetime / soft-delete sentinel — the load-bearing round-trip
# ---------------------------------------------------------------------------

class TestDatetimeSentinel:
    def test_sentinel_serialises_to_iso_string_on_the_wire(self):
        repo, store = _entity_repo()
        ent = _root()
        repo.add(ent)
        wire = store["entity"][ent.id]
        assert isinstance(wire["deleted_at"], str)
        assert wire["deleted_at"].startswith("9999")

    def test_sentinel_round_trips_back_to_aware_datetime(self):
        repo, _ = _entity_repo()
        ent = _root()
        repo.add(ent)
        got = repo.get(ent.id)
        assert got.deleted_at == SOFT_DELETE_SENTINEL
        assert got.deleted_at.tzinfo is not None

    def test_active_row_filter_matches_only_active(self):
        repo, _ = _entity_repo()
        active = _root()
        deleted = _root()
        repo.add(active)
        repo.add(deleted)
        deleted.deleted_at = utc_now()
        repo.update(deleted)
        rows = repo.list({"deleted_at": SOFT_DELETE_SENTINEL})
        assert [r.id for r in rows] == [active.id]

    def test_tolerates_z_suffix_from_remote(self):
        # A remote that emits a 'Z' offset must still parse to aware UTC.
        client, store = make_fake_api()
        repo = ApiRepository(client, BASE_URL, Entity, path="entity")
        ent = _root()
        repo.add(ent)
        store["entity"][ent.id]["deleted_at"] = "9999-12-31T23:59:59Z"
        assert repo.get(ent.id).deleted_at == SOFT_DELETE_SENTINEL


# ---------------------------------------------------------------------------
# Filter DSL (client-side)
# ---------------------------------------------------------------------------

class TestFilterDsl:
    def test_eq_and_none(self):
        repo, _ = _entity_repo()
        root = _root()
        repo.add(root)
        repo.add(_member(root.id))
        assert len(repo.list({"target_entity_id": None})) == 1
        assert len(repo.list({"target_entity_id": root.id})) == 1

    def test_in_and_nin(self):
        repo, _ = _entity_repo()
        a, b, c = _root(), _root(), _root()
        for e in (a, b, c):
            repo.add(e)
        got = repo.list({"id": {"in": [a.id, c.id]}})
        assert {r.id for r in got} == {a.id, c.id}
        got2 = repo.list({"id": {"nin": [a.id]}})
        assert {r.id for r in got2} == {b.id, c.id}

    def test_ne(self):
        repo, _ = _entity_repo()
        repo.add(_root())
        repo.add(_member(_root().id, relation_type="friend"))
        assert all(r.relation_type != "primary" for r in repo.list({"relation_type": {"ne": "primary"}}))

    def test_dotted_extra_data_path(self):
        repo, _ = _entity_repo()
        repo.add(_root(region="north"))
        repo.add(_root(region="south"))
        got = repo.list({"extra_data.region": "north"})
        assert len(got) == 1 and got[0].extra_data["region"] == "north"

    def test_contains(self):
        repo, _ = _entity_repo()
        e = _root()
        e.full_name = "Alphabet"
        repo.add(e)
        repo.add(_root())
        assert len(repo.list({"full_name": {"contains": "phab"}})) == 1

    def test_limit(self):
        repo, _ = _entity_repo()
        for _ in range(5):
            repo.add(_root())
        assert len(repo.list(limit=3)) == 3


# ---------------------------------------------------------------------------
# Field mapping + envelope
# ---------------------------------------------------------------------------

class TestFieldMapAndEnvelope:
    def test_field_map_translates_both_directions(self):
        # Remote uses "name" for our full_name and "parent" for target_entity_id.
        store = {}

        def handler(request):
            parts = request.url.path.strip("/").split("/")
            table = store.setdefault(parts[0], {})
            if request.method == "POST":
                row = json.loads(request.content)
                table[row["person_id"]] = row
                return httpx.Response(201, json=row)
            if request.method == "GET" and len(parts) == 2:
                rid = parts[1]
                return httpx.Response(200, json=table[rid]) if rid in table else httpx.Response(404)
            if request.method == "GET":
                return httpx.Response(200, json={"data": list(table.values())})
            return httpx.Response(400)

        client = httpx.Client(transport=httpx.MockTransport(handler))
        repo = ApiRepository(
            client, BASE_URL, Entity, path="people", rows_path="data",
            field_map={"id": "person_id", "full_name": "name", "target_entity_id": "parent"},
        )
        ent = _root()
        ent.full_name = "Mapped"
        repo.add(ent)
        wire = store["people"][ent.id]
        assert "name" in wire and "full_name" not in wire
        assert "person_id" in wire and "id" not in wire
        got = repo.get(ent.id)
        assert got.full_name == "Mapped" and got.id == ent.id

    def test_wrapped_envelope_rows_path(self):
        store = {"entity": {}}

        def handler(request):
            if request.method == "GET":
                return httpx.Response(200, json={"result": {"items": list(store["entity"].values())}})
            return httpx.Response(400)

        client = httpx.Client(transport=httpx.MockTransport(handler))
        store["entity"]["e1"] = {"id": "e1", "relation_type": "primary",
                                 "deleted_at": "9999-12-31T23:59:59+00:00"}
        repo = ApiRepository(client, BASE_URL, Entity, path="entity", rows_path="result.items")
        assert len(repo.list()) == 1


# ---------------------------------------------------------------------------
# Session — PK is `token`, not `id`
# ---------------------------------------------------------------------------

class TestSessionTokenPk:
    def test_token_pk_round_trips_via_get_update_delete(self):
        client, store = make_fake_api()
        repo = ApiRepository(client, BASE_URL, UserSession, path="session")
        sess = UserSession(token="tok-123", user_id="u1")
        repo.add(sess)
        assert store["session"]["tok-123"]["token"] == "tok-123"
        got = repo.get("tok-123")
        assert got is not None and got.token == "tok-123"
        got.user_id = "u2"
        repo.update(got)  # PUT /session/tok-123 — id segment sourced via pk_field
        assert repo.get("tok-123").user_id == "u2"
        repo.delete("tok-123")
        assert repo.get("tok-123") is None


# ---------------------------------------------------------------------------
# Generic knobs — pagination, method/path overrides, envelopes, body wrapper,
# per-table query params. These are what make the backend wirable without code.
# ---------------------------------------------------------------------------

class TestGenericKnobs:
    def test_pagination_page_style_fetches_all(self):
        rows = [{"id": f"e{i}", "relation_type": "primary",
                 "deleted_at": "9999-12-31T23:59:59+00:00"} for i in range(250)]

        def handler(request):
            page = int(request.url.params.get("page", "1"))
            size = int(request.url.params.get("per_page", "100"))
            start = (page - 1) * size
            return httpx.Response(200, json={"data": rows[start:start + size]})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        repo = ApiRepository(client, BASE_URL, Entity, path="entity", rows_path="data",
                             pagination={"style": "page", "size_param": "per_page", "size": 100})
        assert len(repo.list()) == 250

    def test_pagination_cursor_style_follows_next(self):
        pages = {
            None: ({"id": "a"}, "c1"),
            "c1": ({"id": "b"}, "c2"),
            "c2": ({"id": "c"}, None),
        }

        def handler(request):
            row, nxt = pages[request.url.params.get("cursor")]
            return httpx.Response(200, json={
                "rows": [{**row, "relation_type": "primary",
                          "deleted_at": "9999-12-31T23:59:59+00:00"}],
                "paging": {"next": nxt},
            })

        client = httpx.Client(transport=httpx.MockTransport(handler))
        repo = ApiRepository(client, BASE_URL, Entity, path="entity", rows_path="rows",
                             pagination={"style": "cursor", "next_path": "paging.next"})
        assert {r.id for r in repo.list()} == {"a", "b", "c"}

    def test_method_override_path_template_item_path_body_wrapper_query(self):
        store, seen = {}, {}

        def handler(request):
            path = request.url.path
            seen["method"] = request.method
            seen["api_key"] = request.url.params.get("api_key")
            if request.method == "POST" and path == "/people":
                row = json.loads(request.content)["record"]      # body_wrapper
                store[row["id"]] = row
                return httpx.Response(201, json={})
            if request.method == "PATCH" and path.startswith("/people/"):   # method override
                store[path.split("/")[-1]] = json.loads(request.content)["record"]
                return httpx.Response(200, json={})
            if request.method == "GET" and path.startswith("/people/"):
                rid = path.split("/")[-1]
                return httpx.Response(200, json={"result": store[rid]}) if rid in store else httpx.Response(404)
            return httpx.Response(400)

        client = httpx.Client(transport=httpx.MockTransport(handler))
        repo = ApiRepository(client, BASE_URL, Entity, path="people", item_path="result",
                             methods={"update": "PATCH"}, body_wrapper="record",
                             query_params={"api_key": "K"})
        ent = _root()
        repo.add(ent)
        assert seen["api_key"] == "K"            # per-table query param on every op
        got = repo.get(ent.id)                    # item_path envelope unwrap
        assert got is not None and got.id == ent.id
        repo.update(got)
        assert seen["method"] == "PATCH"          # method override applied


# ---------------------------------------------------------------------------
# Error handling — reads fail loud, not silent-empty
# ---------------------------------------------------------------------------

class TestErrors:
    def test_non_2xx_list_raises(self):
        def handler(request):
            return httpx.Response(500, text="boom")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        repo = ApiRepository(client, BASE_URL, Entity, path="entity")
        with pytest.raises(ApiBackendError):
            repo.list()

    def test_transport_error_raises(self):
        def handler(request):
            raise httpx.ConnectError("refused")

        client = httpx.Client(transport=httpx.MockTransport(handler))
        repo = ApiRepository(client, BASE_URL, Entity, path="entity")
        with pytest.raises(ApiBackendError):
            repo.get("x")
