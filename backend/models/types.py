"""
models/types.py — Shared SQLModel column type decorators and sentinel values.
"""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


def new_id() -> str:
    """Generate a fresh opaque string primary key."""
    return uuid4().hex


def utc_now() -> datetime:
    """Return a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


# Sentinel value for soft-delete: a datetime far in the future meaning "not deleted".
SOFT_DELETE_SENTINEL: datetime = datetime(9999, 12, 31, 23, 59, 59, tzinfo=timezone.utc)


def not_deleted() -> datetime:
    """Return the soft-delete sentinel (= active / not deleted)."""
    return SOFT_DELETE_SENTINEL


class UTCDateTime(TypeDecorator):
    """
    DateTime column that guarantees timezone-aware UTC values on both
    write and read, regardless of backend.

    Why a TypeDecorator instead of just `DateTime(timezone=True)`:
        - PostgreSQL natively roundtrips TIMESTAMPTZ → tz-aware datetime.
        - SQLite has no native timezone storage; values come back NAIVE
          even when written as tz-aware. That mismatch turns naive-vs-
          aware comparison into a silent dev-vs-prod hazard.

    The decorator:
        process_bind_param  — refuses to silently store a naive datetime;
                              instead raises ValueError so the caller
                              knows to switch to `utc_now()`.
        process_result_value — reattaches `tzinfo=timezone.utc` if the
                              backend returned a naive value (SQLite path).

    `cache_ok = True` because the decorator carries no parameters.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError(
                "UTCDateTime columns require tz-aware datetimes. "
                "Use `from models.types import utc_now` (or "
                "`datetime.now(timezone.utc)`) instead of `datetime.utcnow()`."
            )
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
