"""
services/generic_filters.py — admin-defined ("custom") filter handling.

The list endpoints (phones / entities / tasks) accept a single opaque
`filters` query parameter: a JSON object mapping a field name to a filter
clause, in the same shape as the storage filter DSL (see
repositories/base.py). This is what backs the admin-configurable filters
defined in System Settings — including filters on opaque `extra_data` keys
via dotted paths (`extra_data.region`).

Two concerns live here so the endpoint's **two code paths stay in lockstep**:

  - parse_filters(raw, model)  → validate + decode the param into a where-dict
                                 the DB fallback path can hand straight to the
                                 repository (and thus to SQL / Mongo).
  - row_matches(row, where)    → the equivalent predicate for the in-memory
                                 ReadModelStore fast path, evaluated in Python.

Security: only stored columns of the target model and `extra_data.*` keys are
accepted; anything else (unknown attributes, other JSON columns, malformed
clauses) is silently dropped. Operators are still gated by the DSL's
SUPPORTED_OPS through normalise_clause. extra_data values are compared as
text on both paths, mirroring SqlRepository's `.as_string()` so the memory
and DB paths agree.
"""

from __future__ import annotations

import json
from typing import Optional

from repositories.base import WhereError, normalise_clause

# Operators whose Python evaluation we implement for the memory path. Mirrors
# repositories.base.SUPPORTED_OPS; kept explicit so a drift fails loudly here.
_MEMORY_OPS = frozenset(
    {"eq", "ne", "in", "nin", "gt", "gte", "lt", "lte", "contains"}
)


def _allowed_fields(model) -> set[str]:
    """Stored column names for `model` — the allowlist for bare field paths."""
    return set(model.__table__.columns.keys())


def _is_allowed(field: str, columns: set[str]) -> bool:
    """A field is filterable if it's a stored column or an extra_data key."""
    if "." in field:
        # Only the opaque JSON bucket may be addressed by path; never reach
        # into any other column, and require a non-empty key after the dot.
        base, _, rest = field.partition(".")
        return base == "extra_data" and bool(rest)
    return field in columns


def parse_filters(raw: Optional[str], model) -> dict:
    """
    Decode the `filters` query param into a validated where-dict.

    `raw` is a JSON object string, e.g. '{"extra_data.region": "north",
    "phone_type": {"contains": "mob"}}'. Returns the subset of clauses that
    reference an allowed field and a supported operator; everything else is
    dropped. A malformed / non-object payload yields an empty dict (the
    surface simply shows no custom filtering rather than erroring).
    """
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}

    columns = _allowed_fields(model)
    where: dict = {}
    for field, clause in parsed.items():
        if not isinstance(field, str) or not _is_allowed(field, columns):
            continue
        try:
            normalise_clause(clause)  # validates operator / shape
        except WhereError:
            continue
        where[field] = clause
    return where


def _resolve_value(row, field: str):
    """Read `field` off a domain object, descending into extra_data by path."""
    if "." not in field:
        return getattr(row, field, None)
    base, *path = field.split(".")
    val = getattr(row, base, None)
    for key in path:
        if isinstance(val, dict):
            val = val.get(key)
        else:
            return None
    return val


def _clause_matches(op: str, value, operand, *, as_text: bool) -> bool:
    """Evaluate one (op, operand) against a resolved value, in Python.

    `as_text` mirrors SqlRepository's `.as_string()` for extra_data paths:
    both sides are coerced to str so the memory and DB paths agree.
    """
    if as_text:
        value = None if value is None else str(value)
        if op in ("eq", "ne", "contains"):
            operand = None if operand is None else str(operand)
        elif op in ("in", "nin"):
            operand = [str(o) for o in operand]

    if op == "eq":
        return value == operand
    if op == "ne":
        return value != operand
    if op == "in":
        return value in set(operand)
    if op == "nin":
        return value not in set(operand)
    if op == "contains":
        return value is not None and str(operand).lower() in str(value).lower()
    # Ordering ops: a missing value never matches.
    if value is None:
        return False
    if op == "gt":
        return value > operand
    if op == "gte":
        return value >= operand
    if op == "lt":
        return value < operand
    if op == "lte":
        return value <= operand
    raise AssertionError(f"unreachable op {op}")  # parse_filters guards this


def row_matches(row, where: dict) -> bool:
    """True iff `row` satisfies every clause in `where` (AND-ed).

    The in-memory equivalent of handing `where` to a Repository. Clauses are
    assumed already validated by parse_filters.
    """
    if not where:
        return True
    for field, clause in where.items():
        op, operand = normalise_clause(clause)
        as_text = "." in field  # dotted == extra_data path == text comparison
        value = _resolve_value(row, field)
        if not _clause_matches(op, value, operand, as_text=as_text):
            return False
    return True
