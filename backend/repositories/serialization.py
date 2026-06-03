"""
repositories/serialization.py — domain model <-> Mongo document mapping.

The Mongo backend stores plain documents; this module converts between a
SQLModel domain instance and the document shape, in both directions.

Conventions
-----------
- Each model's primary-key field is stored as the Mongo `_id`, so identity
  is single-sourced. The PK field name is discovered from the SQLAlchemy
  table metadata, so models that name their PK something other than `id`
  (e.g. Session.token) round-trip correctly without per-model code here.
- No derived fields are denormalised: the new Entity schema has no hybrid
  properties, so all fields are direct model columns.
- DateTime fields: mongomock (and some pymongo configurations) strip tzinfo
  when storing/retrieving datetimes. We normalise all datetime fields to
  UTC-aware on the way out so sentinel comparisons work correctly.
"""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Type, TypeVar

T = TypeVar("T")


def _ensure_utc(value):
    """Ensure a datetime value is timezone-aware (UTC)."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@lru_cache(maxsize=None)
def pk_field(model) -> str:
    """Return the model's single-column PK field name (e.g. 'id' or 'token')."""
    pk_cols = list(model.__table__.primary_key.columns)
    if len(pk_cols) != 1:
        raise ValueError(
            f"{model.__name__} must have a single-column primary key; "
            f"got {[c.name for c in pk_cols]}"
        )
    return pk_cols[0].name


def to_document(obj) -> dict:
    """
    Serialise a domain model instance to a Mongo document.

    Uses `model_dump()` for the stored fields, maps the PK field -> `_id`.
    """
    pk = pk_field(type(obj))
    doc = obj.model_dump()
    doc["_id"] = doc.pop(pk)
    return doc


def from_document(doc: dict, model: Type[T]) -> T:
    """
    Reconstruct a domain model instance from a Mongo document.

    Maps `_id` -> the model's PK field name. Normalises all datetime
    values to timezone-aware UTC so sentinel comparisons work correctly
    (mongomock can strip tzinfo on round-trip).
    """
    data = dict(doc)
    _id = data.pop("_id", None)
    pk = pk_field(model)
    if _id is not None:
        data[pk] = _id
    # Ensure all datetime values have UTC timezone.
    for key, value in data.items():
        if isinstance(value, datetime):
            data[key] = _ensure_utc(value)
    return model(**data)


# ===========================================================================
# HTTP/REST ("api" backend) <-> domain model mapping
# ===========================================================================
#
# Unlike Mongo (which stores native datetimes as BSON dates and uses `_id` as
# its PK), an HTTP/JSON API carries datetimes as strings and has no `_id`
# convention. So the API backend gets its own pair of helpers:
#
#   - The PK stays under its REAL field name (`id` / `token`) on the wire —
#     no `_id` rename. The matcher and URL-building stay uniform.
#   - Datetimes serialise to ISO-8601 UTC strings and parse back to tz-aware
#     `datetime` via `_ensure_utc`. This is load-bearing: the soft-delete
#     sentinel (year 9999) MUST round-trip as a datetime, or every active-row
#     query (`deleted_at == SOFT_DELETE_SENTINEL`) silently returns nothing.
#
# Field-name translation (our field <-> the remote API's field name) lives in
# ApiRepository, not here — these helpers operate purely in our field space.


@lru_cache(maxsize=None)
def datetime_fields(model) -> frozenset:
    """
    Return the set of field names on `model` whose type is `datetime`
    (including `Optional[datetime]`).

    Discovered from the pydantic/SQLModel field annotations rather than the
    SQLAlchemy column types — the `UTCDateTime` TypeDecorator does not report a
    usable `python_type`, but the annotation (`datetime` / `Optional[datetime]`)
    is always present and unambiguous. Cached per model.
    """
    import typing

    out: set[str] = set()
    for name, field in model.model_fields.items():
        annotation = field.annotation
        args = typing.get_args(annotation)
        candidates = args if args else (annotation,)
        if any(t is datetime for t in candidates):
            out.add(name)
    return frozenset(out)


def to_api_payload(obj) -> dict:
    """
    Serialise a domain model instance to a JSON-safe dict for an HTTP request.

    `model_dump()` yields native Python values (incl. `datetime` objects and
    the `extra_data` dict); we convert datetime fields to ISO-8601 UTC strings.
    The PK is kept under its real field name.
    """
    dt_fields = datetime_fields(type(obj))
    data = obj.model_dump()
    for field in dt_fields:
        value = data.get(field)
        if isinstance(value, datetime):
            data[field] = _ensure_utc(value).isoformat()
    return data


def _parse_dt(value):
    """Parse an ISO-8601 string (or pass a datetime) to tz-aware UTC."""
    if isinstance(value, datetime):
        return _ensure_utc(value)
    if isinstance(value, str) and value:
        text = value
        if text.endswith("Z"):  # tolerate a 'Z' suffix on Python < 3.11
            text = text[:-1] + "+00:00"
        return _ensure_utc(datetime.fromisoformat(text))
    return value


def from_api_row(row: dict, model: Type[T]) -> T:
    """
    Reconstruct a domain model instance from an HTTP/JSON row.

    Expects keys already translated into OUR field names (ApiRepository applies
    the per-table field map before calling this). Parses model-declared
    datetime fields back to tz-aware UTC and drops any keys the model doesn't
    define, so a remote returning extra fields doesn't blow up `model(**data)`.
    """
    dt_fields = datetime_fields(model)
    known = set(model.model_fields.keys())
    data: dict = {}
    for key, value in row.items():
        if key not in known:
            continue
        data[key] = _parse_dt(value) if key in dt_fields and value is not None else value
    return model(**data)
