"""
repositories/serialization.py — domain model ↔ Mongo document mapping.

The Mongo backend stores plain documents; this module converts between a
SQLModel domain instance and the document shape, in both directions.

Conventions
-----------
- The domain `id` (a uuid string) is stored as the Mongo `_id`, so there is
  exactly one identity field and no duplication.
- Derived attributes that are NOT stored model fields (e.g. Entity.client_id,
  a hybrid property) are denormalised onto the document at write time so the
  filter DSL can match them. They are stripped on read (the model recomputes
  them) so reconstruction never sees an unexpected constructor kwarg.
"""

from __future__ import annotations

from typing import Type, TypeVar

T = TypeVar("T")

# Derived/denormalised attributes written to the document for query support
# but removed before reconstructing the model (which recomputes them).
_DERIVED_FIELDS = ("client_id",)


def to_document(obj) -> dict:
    """
    Serialise a domain model instance to a Mongo document.

    Uses `model_dump()` for the stored fields, maps `id` → `_id`, and
    denormalises any derived attribute the model exposes (so filtering on it
    works on Mongo too).
    """
    doc = obj.model_dump()
    for name in _DERIVED_FIELDS:
        if name not in doc:
            value = getattr(obj, name, None)
            if value is not None:
                doc[name] = value
    doc["_id"] = doc.pop("id")
    return doc


def from_document(doc: dict, model: Type[T]) -> T:
    """
    Reconstruct a domain model instance from a Mongo document.

    Maps `_id` → `id` and drops denormalised derived fields so the model
    recomputes them from the authoritative columns.
    """
    data = dict(doc)
    _id = data.pop("_id", None)
    if _id is not None:
        data["id"] = _id
    for name in _DERIVED_FIELDS:
        data.pop(name, None)
    return model(**data)
