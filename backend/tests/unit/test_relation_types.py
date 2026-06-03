"""
Unit tests for `interfaces/relation_types.py`.

Pure-function tests with no DB. Covers:
    - enum membership (full vocabulary and operator-creatable subset)
    - string-equality behavior (str-mixin semantics)
    - frozenset constant stays in lockstep with the subset enum
    - is_associated() helper accepts strings, rejects non-members
"""

import pytest

from interfaces.relation_types import (
    ASSOCIATED_RELATIONS,
    AssociatedRelationType,
    RelationType,
    is_associated,
)


# ===========================================================================
# Full vocabulary — RelationType
# ===========================================================================


class TestRelationTypeMembers:
    @pytest.mark.parametrize("value", [
        "target", "family", "friend", "colleague", "spouse", "social_envelope",
    ])
    def test_known_token_resolves_to_enum_member(self, value):
        # The (str, Enum) mixin means RelationType("family") works.
        assert RelationType(value).value == value

    def test_unknown_token_raises_value_error(self):
        with pytest.raises(ValueError):
            RelationType("not-a-real-token")

    def test_full_vocabulary_size(self):
        # If this count changes, downstream code (scoring weight tables,
        # frontend label maps) likely needs to be reviewed — fail loud.
        assert len(list(RelationType)) == 6


class TestRelationTypeStringSemantics:
    def test_enum_compares_equal_to_string(self):
        # Critical: existing code compares Entity.entity_type strings
        # against literal tokens, so the enum must behave as a string.
        assert RelationType.FAMILY == "family"

    def test_enum_value_serializes_as_string(self):
        # `.value` is what Pydantic emits on serialization.
        assert RelationType.SOCIAL_ENVELOPE.value == "social_envelope"


# ===========================================================================
# Operator-creatable subset — AssociatedRelationType
# ===========================================================================


class TestAssociatedRelationType:
    @pytest.mark.parametrize("value", ["family", "friend", "colleague", "spouse"])
    def test_each_subset_member_is_creatable(self, value):
        assert AssociatedRelationType(value).value == value

    @pytest.mark.parametrize("excluded", ["target", "social_envelope"])
    def test_subset_explicitly_excludes_target_and_envelope(self, excluded):
        # The "+ Add Person" modal MUST NOT mint targets or envelopes.
        # Targets come from client onboarding; envelopes from phone bulk.
        with pytest.raises(ValueError):
            AssociatedRelationType(excluded)

    def test_subset_size_matches_constant(self):
        # Frozenset constant kept in lockstep with the enum members.
        assert {m.value for m in AssociatedRelationType} == ASSOCIATED_RELATIONS

    def test_subset_size(self):
        assert len(list(AssociatedRelationType)) == 4


# ===========================================================================
# is_associated() helper
# ===========================================================================


class TestIsAssociated:
    @pytest.mark.parametrize("value", ["family", "friend", "colleague", "spouse"])
    def test_accepts_operator_creatable_tokens(self, value):
        assert is_associated(value) is True

    @pytest.mark.parametrize("value", [
        "target",
        "social_envelope",
        "stranger",       # not in any vocabulary
        "",               # empty string
        "FAMILY",         # case-sensitive — uppercase must be rejected
    ])
    def test_rejects_non_subset_tokens(self, value):
        assert is_associated(value) is False

    def test_none_is_safely_rejected(self):
        # The helper is called from code paths that may pass None
        # (e.g. legacy rows with NULL entity_type). It must return
        # False rather than raising.
        assert is_associated(None) is False  # type: ignore[arg-type]
