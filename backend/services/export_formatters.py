"""
services/export_formatters.py — Phase EXP: per-cell value resolution and formatting.

Pure helpers used by `ExportService` to turn raw model rows + a list of
column keys into the (typed) values that land in the .xlsx cells.

PRIVACY CONTRACT
----------------
The dotted-key resolver here treats `extra_data.X` as a structural
access into a JSON blob. The CALLER is responsible for validating that
`X` is on the per-table allowlist (see ALLOWED_EXPORT_COLUMNS_*). This
module deliberately knows nothing about which keys are safe — it just
walks the dict.
"""

from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Column-key resolution
# ---------------------------------------------------------------------------


def resolve_column(row: dict, key: str) -> Any:
    """
    Look up one column's value in a flattened row dict.

    Supports two key shapes:

      1. Flat key  — `"phone_number"`, `"status"`. Returned verbatim from
                     the dict (None if missing).
      2. Dotted    — `"extra_data.first_name"`. Walks the dict tree; if
                     any segment is missing or non-dict, returns None.

    Args:
        row (dict): Flattened row dict (already merged with JOIN fields).
        key (str):  Column key. Single segment or dotted.

    Returns:
        Any: The raw value at that path, or None if not present.

    Example:
        >>> resolve_column({"a": {"b": 1}}, "a.b")
        1
        >>> resolve_column({"a": None}, "a.b")
        None
    """
    if "." not in key:
        return row.get(key)
    cursor: Any = row
    for segment in key.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(segment)
        if cursor is None:
            return None
    return cursor


# ---------------------------------------------------------------------------
# Value formatting — cell-type coercion for openpyxl
# ---------------------------------------------------------------------------


def format_value(value: Any, fmt: str) -> Any:
    """
    Coerce a raw value into a type openpyxl understands as the right cell
    kind. Returning the right Python type makes Excel sort and filter
    correctly (numeric columns sort numerically, dates sort as dates).

    Supported `fmt` tokens:

        "text"      — string-cast; None → "".
        "number"    — int-cast when possible, else float; None → None
                      (empty cell, NOT 0).
        "number2"   — float rounded to 2 decimals; None → None.
        "datetime"  — passes through aware datetime; ISO-string → parsed
                      datetime; naive datetime treated as UTC. None → None.
        unknown     — falls back to "text" semantics with a defensive
                      string-cast (never raises).

    Args:
        value (Any): Raw value from `resolve_column`.
        fmt   (str): One of the tokens above.

    Returns:
        Any: A value of the appropriate Python type, ready for openpyxl.
    """
    if value is None:
        # Numbers + dates collapse to None (empty cell). Text collapses
        # to "" so the cell renders blank rather than the literal "None".
        if fmt == "text":
            return ""
        return None

    if fmt == "text":
        return str(value)

    if fmt == "number":
        try:
            if isinstance(value, bool):
                # bool is a subtype of int; coerce explicitly so True/False
                # don't show up as 1/0 in operator exports.
                return str(value)
            f = float(value)
            return int(f) if f.is_integer() else f
        except (TypeError, ValueError):
            return str(value)

    if fmt == "number2":
        try:
            return round(float(value), 2)
        except (TypeError, ValueError):
            return str(value)

    if fmt == "datetime":
        # openpyxl rejects tz-aware datetimes with a TypeError. Our
        # UTCDateTime TypeDecorator hands back tz-aware UTC objects, so
        # we must strip the tzinfo before handing off to the Workbook
        # writer. We normalise to UTC first (no-op when already UTC)
        # so naive cells remain comparable across timezones in Excel.
        if isinstance(value, datetime):
            if value.tzinfo is not None:
                value = value.astimezone(timezone.utc).replace(tzinfo=None)
            return value
        if isinstance(value, str):
            try:
                # Accept ISO strings (with or without trailing Z).
                trimmed = value.replace("Z", "+00:00") if value.endswith("Z") else value
                dt = datetime.fromisoformat(trimmed)
                if dt.tzinfo is not None:
                    dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
                return dt
            except ValueError:
                return value      # leave the literal string for the cell
        return str(value)

    # Unknown format token — defensive string fallback. Never raises so
    # one malformed column descriptor can't blow up the whole export.
    return str(value)
