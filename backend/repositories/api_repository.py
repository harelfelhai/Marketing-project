"""
repositories/api_repository.py — HTTP/REST ("api") backend implementation.

Codes against an `httpx.Client`. Each ApiRepository binds one aggregate to one
remote "table" described by a per-table descriptor (configured in System
Settings). The descriptor is intentionally GENERIC so almost any REST-ish API
can be wired without code changes:

    {
      "path": "people",                 # endpoint name, relative to base_url
      "rows_path": "data.items",         # dot-path to the array in a LIST response
      "item_path": "data",               # dot-path to the object in a GET-one response
      "field_map": {"full_name": "name"},# OUR field -> THEIR field
      "methods": {"update": "PATCH"},     # per-operation HTTP method override
      "path_templates": {                 # per-operation path override ({id} placeholder)
        "list": "people/search"
      },
      "query_params": {"include": "all"}, # extra query params on this table's requests
      "headers": {"X-Scope": "people"},   # extra headers on this table's requests
      "body_wrapper": "data",             # wrap write bodies as {"data": {...}}
      "pagination": {                     # how to fetch ALL rows on list
        "style": "page",                  # none | page | offset | cursor
        "page_param": "page", "size_param": "per_page", "size": 100, "start_page": 1
      }
    }

Operations map to conventional REST routes derived from base_url + path, each
overridable via `methods` / `path_templates`:

    list   -> GET    {base}/{path}
    get    -> GET    {base}/{path}/{id}
    create -> POST   {base}/{path}
    update -> PUT    {base}/{path}/{id}   (upsert)
    delete -> DELETE {base}/{path}/{id}

Filter DSL — applied CLIENT-SIDE
--------------------------------
The storage-agnostic filter DSL (see repositories/base.py) is evaluated in
Python AFTER fetching the table, mirroring MongoRepository's value semantics.
This keeps the per-table config trivial — no need to translate the DSL into
each remote API's bespoke query-string convention.

Errors
------
A non-2xx response or transport error on a READ raises `ApiBackendError`
(mapped to HTTP 503 at the endpoint layer) rather than returning a silent
empty result. `get()` treats 404 as "absent" and returns None.
"""

from __future__ import annotations

from typing import Optional, Type, TypeVar

import httpx

from repositories.base import Repository, normalise_clause
from repositories.cache import bump_data_version
from repositories.serialization import from_api_row, pk_field, to_api_payload

T = TypeVar("T")

# Default HTTP method per CRUD operation; overridable per table via `methods`.
_DEFAULT_METHODS = {
    "list": "GET", "get": "GET", "create": "POST", "update": "PUT", "delete": "DELETE",
}

# Safety cap on paginated list loops (prevents a runaway against a misconfigured
# remote that never signals "last page").
_MAX_PAGES = 10000


class ApiBackendError(RuntimeError):
    """Raised when the remote API is unreachable or returns a non-2xx status."""


def _dig(payload, dotpath: str):
    """Resolve a dot-path into a nested dict; '' / None returns payload as-is."""
    cur = payload
    if dotpath:
        for key in dotpath.split("."):
            cur = cur.get(key) if isinstance(cur, dict) else None
            if cur is None:
                break
    return cur


class ApiRepository(Repository[T]):
    def __init__(
        self,
        client: httpx.Client,
        base_url: str,
        model: Type[T],
        *,
        path: str,
        rows_path: str = "",
        item_path: str = "",
        field_map: Optional[dict] = None,
        methods: Optional[dict] = None,
        path_templates: Optional[dict] = None,
        query_params: Optional[dict] = None,
        headers: Optional[dict] = None,
        body_wrapper: str = "",
        pagination: Optional[dict] = None,
    ) -> None:
        self.client = client
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.path = path.strip("/")
        self.rows_path = rows_path or ""
        self.item_path = item_path or ""
        self.field_map = dict(field_map or {})
        self._inverse_map = {v: k for k, v in self.field_map.items()}
        self.methods = {k: v for k, v in (methods or {}).items() if v}
        self.path_templates = {k: v for k, v in (path_templates or {}).items() if v}
        self.query_params = dict(query_params or {})
        self.headers = dict(headers or {})
        self.body_wrapper = body_wrapper or ""
        self.pagination = dict(pagination or {})

    # ------------------------------------------------------------------
    # URL / method / name helpers
    # ------------------------------------------------------------------

    def _method(self, op: str) -> str:
        return (self.methods.get(op) or _DEFAULT_METHODS[op]).upper()

    def _collection_url(self) -> str:
        return f"{self.base_url}/{self.path}"

    def _item_url(self, id) -> str:
        return f"{self.base_url}/{self.path}/{id}"

    def _op_url(self, op: str, id=None) -> str:
        tmpl = self.path_templates.get(op)
        if tmpl:
            rel = tmpl.lstrip("/").replace("{id}", "" if id is None else str(id))
            return f"{self.base_url}/{rel}"
        if op in ("list", "create"):
            return self._collection_url()
        return self._item_url(id)

    def _to_our_names(self, remote_row: dict) -> dict:
        if not self._inverse_map:
            return remote_row
        return {self._inverse_map.get(k, k): v for k, v in remote_row.items()}

    def _to_their_names(self, payload: dict) -> dict:
        if not self.field_map:
            return payload
        return {self.field_map.get(k, k): v for k, v in payload.items()}

    def _wrap_body(self, payload: dict):
        return {self.body_wrapper: payload} if self.body_wrapper else payload

    # ------------------------------------------------------------------
    # HTTP
    # ------------------------------------------------------------------

    def _request(self, method: str, url: str, *, json=None, params=None) -> httpx.Response:
        # Per-table query params + headers ride on EVERY operation (not just
        # list); global ones are already baked into the client.
        merged = dict(self.query_params)
        if params:
            merged.update(params)
        try:
            return self.client.request(
                method, url, json=json,
                params=merged or None,
                headers=self.headers or None,
            )
        except httpx.HTTPError as exc:
            raise ApiBackendError(f"{method} {url} failed: {exc}") from exc

    @staticmethod
    def _raise_for_status(resp: httpx.Response, url: str) -> None:
        if resp.status_code >= 400:
            raise ApiBackendError(
                f"{resp.request.method} {url} -> HTTP {resp.status_code}: "
                f"{resp.text[:200]}"
            )

    def _extract_rows(self, payload) -> list:
        cur = _dig(payload, self.rows_path)
        if cur is None:
            return []
        if not isinstance(cur, list):
            raise ApiBackendError(
                f"GET {self._op_url('list')} did not yield a list at "
                f"rows_path={self.rows_path!r} (got {type(cur).__name__})."
            )
        return cur

    def _deserialize(self, rows: list) -> list[T]:
        return [from_api_row(self._to_our_names(r), self.model) for r in rows]

    # ------------------------------------------------------------------
    # Client-side filter DSL
    # ------------------------------------------------------------------

    def _value_at(self, obj, field: str):
        if "." not in field:
            return getattr(obj, field, None)
        base, *path = field.split(".")
        cur = getattr(obj, base, None)
        for key in path:
            if isinstance(cur, dict):
                cur = cur.get(key)
            else:
                return None
        return cur

    @staticmethod
    def _clause_ok(value, op: str, operand) -> bool:
        if op == "eq":
            return value == operand
        if op == "ne":
            return value != operand
        if op == "in":
            return value in list(operand)
        if op == "nin":
            return value not in list(operand)
        if op == "gt":
            return value is not None and value > operand
        if op == "gte":
            return value is not None and value >= operand
        if op == "lt":
            return value is not None and value < operand
        if op == "lte":
            return value is not None and value <= operand
        if op == "contains":
            return value is not None and str(operand).lower() in str(value).lower()
        raise AssertionError(f"unreachable op {op}")  # normalise_clause guards this

    def _matches(self, obj, where: Optional[dict]) -> bool:
        if not where:
            return True
        for field, raw in where.items():
            op, operand = normalise_clause(raw)
            if not self._clause_ok(self._value_at(obj, field), op, operand):
                return False
        return True

    # ------------------------------------------------------------------
    # List fetch (pagination-aware)
    # ------------------------------------------------------------------

    def _list_page(self, extra_params: Optional[dict] = None):
        """Issue one list request; return the raw JSON payload."""
        # _request already merges self.query_params; pass only pagination params.
        url = self._op_url("list")
        resp = self._request(self._method("list"), url, params=extra_params)
        self._raise_for_status(resp, url)
        return resp.json()

    def _fetch_all_rows(self) -> list:
        """Return all raw rows from the remote, following pagination."""
        pag = self.pagination
        style = (pag.get("style") or "none").lower()

        if style == "none":
            return self._extract_rows(self._list_page())

        out: list = []
        if style in ("page", "offset"):
            size = int(pag.get("size", 100))
            page = int(pag.get("start_page", 1))
            offset = int(pag.get("start_offset", 0))
            for _ in range(_MAX_PAGES):
                if style == "page":
                    params = {pag.get("page_param", "page"): page,
                              pag.get("size_param", "per_page"): size}
                else:
                    params = {pag.get("offset_param", "offset"): offset,
                              pag.get("limit_param", "limit"): size}
                payload = self._list_page(params)
                rows = self._extract_rows(payload)
                out.extend(rows)
                if not rows or len(rows) < size:
                    break
                total = _dig(payload, pag.get("total_path", "")) if pag.get("total_path") else None
                if isinstance(total, (int, float)) and len(out) >= total:
                    break
                page += 1
                offset += size
            return out

        if style == "cursor":
            cursor_param = pag.get("cursor_param", "cursor")
            next_path = pag.get("next_path", "")
            cursor = None
            for _ in range(_MAX_PAGES):
                payload = self._list_page({cursor_param: cursor} if cursor else None)
                rows = self._extract_rows(payload)
                out.extend(rows)
                cursor = _dig(payload, next_path) if next_path else None
                if not cursor or not rows:
                    break
            return out

        # Unknown style → single fetch (fail safe, not silent).
        return self._extract_rows(self._list_page())

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def get(self, id: str) -> Optional[T]:
        url = self._op_url("get", id)
        resp = self._request(self._method("get"), url)
        if resp.status_code == 404:
            return None
        self._raise_for_status(resp, url)
        obj = _dig(resp.json(), self.item_path) if self.item_path else resp.json()
        if obj is None:
            return None
        return from_api_row(self._to_our_names(obj), self.model)

    def list(
        self,
        where: Optional[dict] = None,
        *,
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: Optional[int] = None,
    ) -> list[T]:
        rows = [obj for obj in self._deserialize(self._fetch_all_rows()) if self._matches(obj, where)]
        if order_by is not None:
            present = [o for o in rows if getattr(o, order_by, None) is not None]
            missing = [o for o in rows if getattr(o, order_by, None) is None]
            present.sort(key=lambda o: getattr(o, order_by), reverse=descending)
            rows = present + missing  # rows with no sort key go last
        if limit is not None:
            rows = rows[:limit]
        return rows

    def count(self, where: Optional[dict] = None) -> int:
        return len(self.list(where))

    def add(self, obj: T) -> T:
        url = self._op_url("create")
        body = self._wrap_body(self._to_their_names(to_api_payload(obj)))
        resp = self._request(self._method("create"), url, json=body)
        self._raise_for_status(resp, url)
        bump_data_version()
        return obj

    def update(self, obj: T, *, commit: bool = True) -> T:
        # `commit` is the SQL-only nested-transaction escape hatch; over HTTP
        # each write is its own request, so the flag is accepted but ignored.
        id_value = getattr(obj, pk_field(self.model))
        url = self._op_url("update", id_value)
        body = self._wrap_body(self._to_their_names(to_api_payload(obj)))
        resp = self._request(self._method("update"), url, json=body)
        self._raise_for_status(resp, url)
        bump_data_version()
        return obj

    def delete(self, id: str) -> None:
        url = self._op_url("delete", id)
        resp = self._request(self._method("delete"), url)
        if resp.status_code == 404:
            return  # already absent — match SQL/Mongo "no-op when absent"
        self._raise_for_status(resp, url)
        bump_data_version()
