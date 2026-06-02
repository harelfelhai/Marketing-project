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
    db["phone_number"].create_index("deleted_at")
    db["entity"].create_index("target_entity_id")
    db["entity"].create_index("deleted_at")
    db["pipeline_task"].create_index("phone_id")
    db["pipeline_task"].create_index("entity_id")
    db["pipeline_task"].create_index("deleted_at")
    db["user"].create_index("username", unique=True)
    db["session"].create_index("user_id")


def _read_configured_mongo_url() -> str:
    """
    Return the MongoDB URL: admin-configured value from system_settings.json
    takes priority over the MONGO_URL env var. Reads the file directly so
    this module has no import dependency on services.system_settings.
    """
    import json as _json
    from pathlib import Path
    try:
        path = Path(settings.system_settings_path)
        if path.exists():
            data = _json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("mongo_url"):
                return data["mongo_url"]
    except Exception:
        pass
    return settings.mongo_url


def _build_client():
    """Lazily import pymongo and open the real client. Production-only path."""
    import pymongo  # imported here so SQL-only deployments need not install it
    return pymongo.MongoClient(_read_configured_mongo_url())


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


def test_mongo_url(url: str, timeout_ms: int = 2000) -> tuple[bool, str]:
    """
    Probe a MongoDB URL without touching the process-wide singletons.
    Returns (True, '') on success, (False, error_message) on failure.
    """
    try:
        import pymongo
        client = pymongo.MongoClient(url, serverSelectionTimeoutMS=timeout_ms)
        client.server_info()
        client.close()
        return True, ""
    except Exception as exc:
        return False, str(exc)


def reset_mongo_connection() -> None:
    """
    Clear the process-wide singletons so the next get_mongo_database() call
    reconnects with whatever URL is current in system_settings.json.
    Called after an admin updates the MongoDB URL via System Settings.
    """
    global _client, _database
    if _client is not None:
        try:
            _client.close()
        except Exception:
            pass
    _client = None
    _database = None
