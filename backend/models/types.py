"""
models/types.py — Shared SQLModel column type decorators.

Today this file exports just `UTCDateTime`, but it exists as a package
member rather than living inside one model so future column types
(JSONStrict, BoundedFloat, …) have a home that does not couple them to
a specific table.

`UTCDateTime` was introduced by DX-1 inside `models/pipeline_task.py`;
it is promoted here in DY-1 because Phase DY migrates `PhoneNumber`'s
timestamps onto the same tz-aware contract.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


def utc_now() -> datetime:
    """
    Return a timezone-aware UTC datetime. The canonical replacement for
    the deprecated `datetime.utcnow()` (Python 3.12 deprecation warning;
    scheduled for removal in a future Python release).

    Used as a `default_factory=` for SQLModel Field declarations and as
    a direct write target by services that update timestamps.
    """
    return datetime.now(timezone.utc)


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
