"""
tests/repositories/fake_api.py — an in-memory fake REST server (httpx
MockTransport) for exercising the 'api' storage backend with no real network.

Implements the conventional routes ApiRepository expects, over a dict-of-tables
store, returning the collection as a BARE JSON ARRAY (so a table config with no
`rows_path` round-trips):

    GET    /{table}          -> 200 [ ...rows ]
    GET    /{table}/{id}     -> 200 {row} | 404
    POST   /{table}          -> 201 {row}     (PK read from id|token in body)
    PUT    /{table}/{id}     -> 200 {row}     (upsert)
    DELETE /{table}/{id}     -> 204 | 404

Not for field-map cases (those tests use a bespoke handler) — here the wire
field names equal our field names, so the PK is `id` (or `token` for session).
"""

from __future__ import annotations

import json

import httpx

# Base URL the fake answers on; tests point ApiStorage/ApiRepository here.
BASE_URL = "http://fake-api.test"


def make_fake_api(store: dict | None = None):
    """
    Return (client, store). `store` is {table_path: {pk: row_dict}} and is
    returned so tests can inspect / pre-seed it.
    """
    store = {} if store is None else store

    def handler(request: httpx.Request) -> httpx.Response:
        parts = request.url.path.strip("/").split("/")
        table = store.setdefault(parts[0], {})

        if request.method == "GET" and len(parts) == 1:
            return httpx.Response(200, json=list(table.values()))

        if len(parts) == 2:
            rid = parts[1]
            if request.method == "GET":
                return httpx.Response(200, json=table[rid]) if rid in table else httpx.Response(404)
            if request.method == "PUT":
                row = json.loads(request.content)
                table[rid] = row
                return httpx.Response(200, json=row)
            if request.method == "DELETE":
                if rid not in table:
                    return httpx.Response(404)
                table.pop(rid, None)
                return httpx.Response(204)

        if request.method == "POST" and len(parts) == 1:
            row = json.loads(request.content)
            pk = row.get("id") or row.get("token")
            table[pk] = row
            return httpx.Response(201, json=row)

        return httpx.Response(400, text=f"unhandled {request.method} {request.url.path}")

    return httpx.Client(transport=httpx.MockTransport(handler)), store


# Default per-table descriptors for ApiStorage: path == aggregate key, no
# rows_path (bare array), no field map. Matches make_fake_api's routes.
def default_api_config(base_url: str = BASE_URL) -> dict:
    keys = [
        "entity", "phone_number", "pipeline_task", "user", "session",
        "notification_subscription", "notification_delivery",
    ]
    return {"base_url": base_url, "tables": {k: {"path": k} for k in keys}}
