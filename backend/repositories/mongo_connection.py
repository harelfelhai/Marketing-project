"""
repositories/mongo_connection.py — MongoDB client lifecycle for the
'mongo' storage backend.

This module is only exercised when the System Settings storage backend is
set to 'mongo'. `pymongo` is imported lazily INSIDE `_build_client()` so the
dependency is required only by deployments that actually select MongoDB —
the SQL-backed default (and the test suite, which injects an in-memory
mongomock client) never imports it.

Index management
----------------
On first connection the unique index on `phone_number` is created so the
Mongo backend enforces the same uniqueness the SQL UNIQUE constraint does.
Additional indexes (the FK-ish lookup fields) are created best-effort.

Test seam
---------
`set_mongo_database(db)` lets the test suite inject a `mongomock` database so
the factory-selection path can be exercised without a running mongod. In
production nothing calls it and the real client is built on demand.
"""

from __future__ import annotations

from typing import Optional

from config import settings

# Process-wide singletons. The client is built once and reused across
# requests (connection pooling lives inside the driver).
_client = None
_database = None
_injected_database = None  # test seam


def set_mongo_database(db) -> None:
    """Inject a Mongo database (e.g. mongomock) for tests. Pass None to reset."""
    global _injected_database
    _injected_database = db


def _ensure_indexes(db) -> None:
    """Create the indexes that mirror the SQL schema's constraints."""
    # Unique phone number — mirrors the SQL UNIQUE on phone_number.
    db["phone_number"].create_index("phone_number", unique=True)
    # Common lookup fields (best-effort; non-unique).
    db["phone_number"].create_index("entity_id")
    db["entity"].create_index("target_entity_id")
    db["entity"].create_index("client_id")
    db["action_log"].create_index("phone_id")
    db["pipeline_task"].create_index("phone_id")
    db["user"].create_index("username", unique=True)
    db["session"].create_index("user_id")


def _build_client():
    """Lazily import pymongo and open the real client. Production-only path."""
    import pymongo  # imported here so SQL-only deployments need not install it
    return pymongo.MongoClient(settings.mongo_url)


def get_mongo_database():
    """
    Return the active Mongo database — the injected test double when present,
    otherwise the lazily-built singleton from the configured URL.
    """
    if _injected_database is not None:
        return _injected_database

    global _client, _database
    if _database is None:
        _client = _build_client()
        _database = _client[settings.mongo_db_name]
        _ensure_indexes(_database)
    return _database
