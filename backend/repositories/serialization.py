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
