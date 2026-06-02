"""
repositories/base.py — the storage-agnostic Repository contract + filter DSL.

A `Repository[T]` is a CRUD seam over one aggregate (one table / collection),
returning domain model instances of type T. Both the SQL and Mongo backends
implement this identical surface so the service layer is backend-agnostic.

Filter DSL (the `where` argument)
---------------------------------
`where` is a dict mapping a field name to either a bare value (equality,
including `None` → IS NULL) or a single-key operator dict:

    {"entity_type": "target"}                 # entity_type == 'target'
    {"deleted_at": None}                       # deleted_at IS NULL
    {"client_id": {"in": [...]}}               # membership
    {"id": {"nin": [...]}}                      # negated membership
    {"entity_type": {"ne": "target"}}          # not-equal
    {"phone_number": {"contains": "0521"}}     # case-insensitive substring
    {"created_at": {"gte": dt}}                # >=  (also gt / lt / lte)

Multiple keys are AND-ed together. The same dict is translated to SQLAlchemy
conditions by SqlRepository and to a Mongo query document by MongoRepository,
so a query written once behaves identically on both backends.

Dotted (JSON) field paths
-------------------------
A field name may address a key inside a JSON column using dot notation:

    {"extra_data.region": "north"}             # extra_data->>'region' == 'north'
    {"extra_data.bulk_submission_id": {"contains": "Q3"}}

The first segment is the stored JSON column; the rest is the path into it.
SqlRepository compares on the value's textual form (JSON_EXTRACT / ->>);
MongoRepository passes the dotted path straight through (native dot-path).
Filtering this way keeps opaque extra_data keys queryable without ever
promoting them to structured columns (Secrets-Free Mandate).

Derived fields
--------------
A model may expose a derived attribute that is not a stored column (e.g.
`Entity.client_id = COALESCE(target_entity_id, id)`). SQL resolves it through
the SQLAlchemy hybrid expression; Mongo stores a denormalised copy on the
document at write time (see repositories/serialization.py). Filtering on such
a field therefore works uniformly on both backends.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Generic, Optional, TypeVar

T = TypeVar("T")

# Operators accepted inside a `{op: value}` filter clause.
SUPPORTED_OPS = frozenset(
    {"eq", "ne", "in", "nin", "gt", "gte", "lt", "lte", "contains"}
)


class WhereError(ValueError):
    """Raised when a filter clause uses an unsupported operator."""


class Repository(ABC, Generic[T]):
    """
    Backend-agnostic CRUD over a single aggregate.

    Implementations MUST return domain model instances (type T), never raw
    rows or documents, so the service layer is identical across backends.
    """

    @abstractmethod
    def get(self, id: str) -> Optional[T]:
        """Return the row with this id, or None when absent."""

    @abstractmethod
    def list(
        self,
        where: Optional[dict] = None,
        *,
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: Optional[int] = None,
    ) -> list[T]:
        """Return all rows matching `where` (AND-ed), optionally ordered/limited."""

    @abstractmethod
    def count(self, where: Optional[dict] = None) -> int:
        """Count rows matching `where`."""

    @abstractmethod
    def add(self, obj: T) -> T:
        """Insert `obj` and return the persisted instance."""

    @abstractmethod
    def update(self, obj: T, *, commit: bool = True) -> T:
        """
        Persist the current field values of `obj` (matched by id).

        `commit=False` is an SQL-only escape hatch for callers running
        inside a parent transaction / savepoint that owns the final
        commit (e.g. the bulk-ingestion per-row savepoint). Mongo has
        no cross-document transactions, so the parameter is accepted
        but has no effect there — each write is atomic in itself.
        """

    @abstractmethod
    def delete(self, id: str) -> None:
        """Hard-delete the row with this id. No-op when absent."""


def normalise_clause(value) -> tuple[str, object]:
    """
    Reduce a filter value to an `(op, operand)` pair.

    A bare value means equality; a single-key dict names the operator. Raises
    WhereError for unknown operators or malformed multi-key dicts.
    """
    if isinstance(value, dict):
        if len(value) != 1:
            raise WhereError(
                f"Filter clause must have exactly one operator, got: {value!r}"
            )
        op, operand = next(iter(value.items()))
        if op not in SUPPORTED_OPS:
            raise WhereError(
                f"Unsupported filter operator '{op}'. "
                f"Supported: {', '.join(sorted(SUPPORTED_OPS))}."
            )
        return op, operand
    return "eq", value
