"""
Phase E1 unit tests for the pure-function tokenizer + normalizer in
services/bulk_ingestion.py. These tests do not need a database — they
pin the parsing contract that the service-layer + API tests depend on.
"""

import pytest

from services.bulk_ingestion import _normalize, _tokenize


class TestTokenize:
    def test_commas(self):
        out = _tokenize("+1111111, +2222222, +3333333")
        assert out == [(1, "+1111111"), (2, "+2222222"), (3, "+3333333")]

    def test_spaces(self):
        out = _tokenize("+1111111 +2222222 +3333333")
        assert out == [(1, "+1111111"), (2, "+2222222"), (3, "+3333333")]

    def test_newlines(self):
        out = _tokenize("+1111111\n+2222222\n+3333333")
        assert out == [(1, "+1111111"), (2, "+2222222"), (3, "+3333333")]

    def test_semicolons(self):
        out = _tokenize("+1111111;+2222222;+3333333")
        assert out == [(1, "+1111111"), (2, "+2222222"), (3, "+3333333")]

    def test_mixed_delimiters(self):
        out = _tokenize("+1111111,  +2222222\n+3333333;+4444444")
        assert [r for r, _ in out] == [1, 2, 3, 4]

    def test_collapses_consecutive_delimiters(self):
        # Multiple commas/spaces in a row should NOT produce empty tokens.
        out = _tokenize("+1111111,,  ,\n\n+2222222")
        assert out == [(1, "+1111111"), (2, "+2222222")]

    def test_leading_trailing_whitespace(self):
        out = _tokenize("   +1111111   ")
        assert out == [(1, "+1111111")]

    def test_empty_input(self):
        assert _tokenize("") == []

    def test_only_delimiters(self):
        assert _tokenize(", , \n;;") == []

    def test_row_index_is_1_based(self):
        out = _tokenize("a b c")
        # Rows reported to the operator should start at 1, not 0.
        assert out[0][0] == 1


class TestNormalize:
    @pytest.mark.parametrize("raw,expected", [
        ("+1 (415) 555-1111",     "+14155551111"),
        (" 052-1234567 ",          "0521234567"),
        ("+972 52 456 7890",       "+972524567890"),
        ("+1.415.555.1111",        "+14155551111"),
        ("(02) 555-1212",          "025551212"),
        ("+1‎4155551111",     "+14155551111"),  # bidi mark stripped
    ])
    def test_strips_cosmetic_chars(self, raw, expected):
        assert _normalize(raw) == expected

    def test_preserves_leading_plus(self):
        assert _normalize("+14155551111") == "+14155551111"

    def test_drops_non_digit_non_plus_chars(self):
        # The normalizer is deliberately context-blind — it strips every
        # char that isn't a digit or '+', regardless of position. So
        # "ext42" leaks its digits into the result. The normalizer is a
        # sanitizer, not a parser; operators are expected to paste clean
        # tokens. Format validation runs as a separate pass downstream.
        assert _normalize("phone:+14155551111#ext42") == "+1415555111142"
        # Purely cosmetic input behaves as expected:
        assert _normalize("(+1) 415-555-1111") == "+14155551111"

    def test_empty_input(self):
        assert _normalize("") == ""

    def test_pure_whitespace(self):
        assert _normalize("   \t  ") == ""

    def test_no_change_if_already_clean(self):
        assert _normalize("+14155551111") == "+14155551111"
