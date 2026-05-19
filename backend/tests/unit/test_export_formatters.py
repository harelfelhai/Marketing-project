"""Unit tests for services/export_formatters.py."""

from datetime import datetime, timezone

import pytest

from services.export_formatters import format_value, resolve_column


# ===========================================================================
# resolve_column — dotted-key resolution
# ===========================================================================


class TestResolveColumn:
    def test_flat_key_returns_value(self):
        assert resolve_column({"a": 1}, "a") == 1

    def test_flat_key_missing_returns_none(self):
        assert resolve_column({}, "a") is None

    def test_dotted_key_descends_into_nested_dict(self):
        assert resolve_column({"a": {"b": "X"}}, "a.b") == "X"

    def test_dotted_key_missing_segment_returns_none(self):
        assert resolve_column({"a": {}}, "a.b") is None

    def test_dotted_key_into_non_dict_returns_none(self):
        # Defensive — never raises when the path mid-walk lands on a
        # scalar instead of a dict.
        assert resolve_column({"a": 5}, "a.b") is None

    def test_dotted_key_into_none_returns_none(self):
        assert resolve_column({"a": None}, "a.b") is None

    def test_deeply_nested_key(self):
        assert resolve_column({"a": {"b": {"c": 7}}}, "a.b.c") == 7


# ===========================================================================
# format_value — cell-type coercion
# ===========================================================================


class TestFormatText:
    def test_text_none_collapses_to_empty_string(self):
        assert format_value(None, "text") == ""

    def test_text_passes_strings_through(self):
        assert format_value("hello", "text") == "hello"

    def test_text_coerces_non_strings(self):
        assert format_value(42, "text") == "42"


class TestFormatNumber:
    def test_number_none_returns_none(self):
        # Empty cell — NOT 0. Operators sorting numerically must see
        # the absence as absent.
        assert format_value(None, "number") is None

    def test_integer_input_returns_int(self):
        result = format_value(42, "number")
        assert result == 42
        assert isinstance(result, int)

    def test_float_with_no_fractional_part_returns_int(self):
        result = format_value(42.0, "number")
        assert isinstance(result, int)

    def test_float_with_fractional_part_returns_float(self):
        assert format_value(3.14, "number") == 3.14

    def test_string_digit_coerces_to_int(self):
        assert format_value("7", "number") == 7

    def test_garbage_string_falls_back_to_string(self):
        # Defensive — never raises.
        assert format_value("abc", "number") == "abc"

    def test_bool_does_NOT_become_int(self):
        # Python bool is a subtype of int; we explicitly coerce to
        # string so True/False don't render as 1/0 in operator exports.
        assert format_value(True, "number") == "True"


class TestFormatNumber2:
    def test_rounds_to_two_decimals(self):
        assert format_value(3.14159, "number2") == 3.14

    def test_none_returns_none(self):
        assert format_value(None, "number2") is None

    def test_garbage_falls_back_to_string(self):
        assert format_value("not-a-number", "number2") == "not-a-number"


class TestFormatDatetime:
    def test_aware_datetime_is_normalised_to_naive_utc(self):
        # UAT round-3: openpyxl rejects tz-aware datetimes outright,
        # so the formatter strips tzinfo after converting to UTC.
        dt = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        out = format_value(dt, "datetime")
        assert isinstance(out, datetime)
        assert out.tzinfo is None
        assert out == datetime(2026, 5, 19, 12, 0)

    def test_iso_string_parses(self):
        result = format_value("2026-05-19T12:00:00+00:00", "datetime")
        assert isinstance(result, datetime)
        # Normalised to naive UTC for openpyxl compatibility.
        assert result.tzinfo is None

    def test_iso_string_with_trailing_z_parses(self):
        result = format_value("2026-05-19T12:00:00Z", "datetime")
        assert isinstance(result, datetime)
        assert result.tzinfo is None      # stripped for openpyxl

    def test_garbage_string_left_as_string(self):
        # Defensive — operator sees the literal value rather than an
        # error.
        assert format_value("not-a-date", "datetime") == "not-a-date"

    def test_none_returns_none(self):
        assert format_value(None, "datetime") is None


class TestFormatUnknown:
    def test_unknown_format_falls_back_to_string_coercion(self):
        # Defensive — never raises on a malformed format token.
        assert format_value(42, "weird-format") == "42"
