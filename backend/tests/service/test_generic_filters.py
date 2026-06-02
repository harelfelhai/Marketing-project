"""
test_generic_filters.py — the admin-defined ("custom") filter helper.

Covers parse_filters (validation / decoding of the opaque `filters` query
param) and row_matches (the in-memory ReadModelStore fast-path predicate).
The DB-path equivalent is exercised through the repository contract suite
(TestExtraDataFilters) and the API tests; this file pins the Python side and
the security allowlist.
"""

from models.phone_number import PhoneNumber
from services.generic_filters import parse_filters, row_matches


def _phone(**extra):
    return PhoneNumber(
        entity_id="ent-1",
        phone_number="+15550001111",
        phone_type="mobile",
        verification_status="pending",
        ingestion_source="manual",
        score=0.0,
        extra_data=extra or None,
    )


# ---------------------------------------------------------------------------
# parse_filters — allowlist + decoding
# ---------------------------------------------------------------------------


class TestParseFilters:
    def test_none_and_blank_yield_empty(self):
        assert parse_filters(None, PhoneNumber) == {}
        assert parse_filters("", PhoneNumber) == {}

    def test_malformed_json_yields_empty(self):
        assert parse_filters("{not json", PhoneNumber) == {}

    def test_non_object_json_yields_empty(self):
        assert parse_filters("[1, 2, 3]", PhoneNumber) == {}
        assert parse_filters('"hello"', PhoneNumber) == {}

    def test_known_column_passes(self):
        out = parse_filters('{"phone_type": "mobile"}', PhoneNumber)
        assert out == {"phone_type": "mobile"}

    def test_extra_data_path_passes(self):
        out = parse_filters('{"extra_data.region": "north"}', PhoneNumber)
        assert out == {"extra_data.region": "north"}

    def test_operator_clause_passes(self):
        out = parse_filters('{"extra_data.batch": {"contains": "Q3"}}', PhoneNumber)
        assert out == {"extra_data.batch": {"contains": "Q3"}}

    def test_unknown_column_dropped(self):
        assert parse_filters('{"bogus_col": "x"}', PhoneNumber) == {}

    def test_non_extra_data_json_path_dropped(self):
        # Only the opaque extra_data bucket may be addressed by path.
        assert parse_filters('{"phone_number.foo": "x"}', PhoneNumber) == {}

    def test_empty_extra_data_key_dropped(self):
        assert parse_filters('{"extra_data.": "x"}', PhoneNumber) == {}

    def test_unsupported_operator_dropped(self):
        assert parse_filters('{"phone_type": {"regex": "m.*"}}', PhoneNumber) == {}

    def test_mixed_keeps_only_valid(self):
        out = parse_filters(
            '{"phone_type": "mobile", "bogus": "x", "extra_data.r": "n"}',
            PhoneNumber,
        )
        assert out == {"phone_type": "mobile", "extra_data.r": "n"}


# ---------------------------------------------------------------------------
# row_matches — in-memory predicate (mirrors the DSL on the DB path)
# ---------------------------------------------------------------------------


class TestRowMatches:
    def test_empty_where_matches_all(self):
        assert row_matches(_phone(), {}) is True

    def test_column_eq(self):
        assert row_matches(_phone(), {"phone_type": "mobile"}) is True
        assert row_matches(_phone(), {"phone_type": "landline"}) is False

    def test_extra_data_eq(self):
        p = _phone(region="north")
        assert row_matches(p, {"extra_data.region": "north"}) is True
        assert row_matches(p, {"extra_data.region": "south"}) is False

    def test_extra_data_missing_key_no_match(self):
        p = _phone(other="x")
        assert row_matches(p, {"extra_data.region": "north"}) is False

    def test_extra_data_none_bucket_no_match(self):
        p = _phone()  # extra_data is None
        assert row_matches(p, {"extra_data.region": "north"}) is False

    def test_extra_data_contains_case_insensitive(self):
        p = _phone(batch="Q3-2026-EXPORT")
        assert row_matches(p, {"extra_data.batch": {"contains": "q3"}}) is True
        assert row_matches(p, {"extra_data.batch": {"contains": "q4"}}) is False

    def test_extra_data_in_membership(self):
        p = _phone(tier="gold")
        assert row_matches(p, {"extra_data.tier": {"in": ["gold", "silver"]}}) is True
        assert row_matches(p, {"extra_data.tier": {"nin": ["gold", "silver"]}}) is False

    def test_extra_data_text_coercion(self):
        # A numeric extra_data value compares as text, matching .as_string() on SQL.
        p = _phone(rank=5)
        assert row_matches(p, {"extra_data.rank": "5"}) is True

    def test_multiple_clauses_are_anded(self):
        p = _phone(region="north", tier="gold")
        where = {"extra_data.region": "north", "extra_data.tier": "gold"}
        assert row_matches(p, where) is True
        where["extra_data.tier"] = "silver"
        assert row_matches(p, where) is False
