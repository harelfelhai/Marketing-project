"""
repositories/ — pluggable storage abstraction (System Settings → DB engine).

All persistent data access flows through a `Repository` so the service layer
never speaks SQL (or Mongo) directly. Two interchangeable implementations:

    - SqlRepository   — SQLModel / SQLAlchemy session (Postgres / SQLite).
    - MongoRepository — pymongo collection (production) / mongomock (tests).

The active backend is chosen by the `storage_backend` system setting and
takes effect on reconnect / restart. Repositories return DOMAIN MODEL
instances (the SQLModel classes used as plain models), so the service layer
keeps reading attributes (`entity.extra_data`, `entity.client_id`) unchanged
regardless of which backend is active.
"""

from repositories.base import Repository, WhereError
from repositories.mongo_repository import MongoRepository
from repositories.sql_repository import SqlRepository
from repositories.storage import MongoStorage, SqlStorage, Storage

__all__ = [
    "Repository",
    "WhereError",
    "SqlRepository",
    "MongoRepository",
    "Storage",
    "SqlStorage",
    "MongoStorage",
]
