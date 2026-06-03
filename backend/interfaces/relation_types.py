"""
interfaces/relation_types.py — Controlled vocabulary for Entity.entity_type.

A single source of truth for every relation/entity-type token the backend
accepts. Two enums export the vocabulary at different scopes:

    RelationType            — full system vocabulary. Every legal value of
                              `Entity.entity_type` lives here. Used by the
                              schema layer and any code that needs to
                              enumerate or test against the complete set.

    AssociatedRelationType  — strict operator-creatable subset. Used by the
                              `POST /api/v1/entities*` endpoints to reject
                              tokens that are NOT operator-facing (TARGET is
                              seeded by client onboarding; SOCIAL_ENVELOPE
                              is auto-minted by the phone-side bulk-text
                              ingestion when no named owner is known).

NAMING NOTE
-----------
The Entity model stores this vocabulary on the column called `entity_type`
(NOT `relation_type` — `Entity.relation_type` is a separate two-value
column carrying 'primary' | 'associated'). The operator-facing UI labels
the field "Relation Type" because that reads more naturally; this module
keeps the operator-facing name, but the values land on `Entity.entity_type`
at the DB layer.

PRIVACY CONTRACT
----------------
These tokens are structural (English single words, controlled vocabulary).
They carry no proprietary information and may appear in API contracts,
logs, and the open-source frontend without redaction. Names, free-text
descriptions, and any other human-readable per-person data live in the
opaque `Entity.extra_data` JSON blob instead.
"""

from enum import Enum


class RelationType(str, Enum):
    """
    Full controlled vocabulary for `Entity.entity_type`.

    Inheriting from `str` makes each member directly comparable to plain
    strings — `RelationType.FAMILY == "family"` is True — so existing code
    that compares against string literals keeps working without conversion.

    Members:
        TARGET          — Root marketing target. Always paired with
                          `Entity.target_entity_id IS NULL`.
        FAMILY          — Named family member of a root target.
        FRIEND          — Named close acquaintance of a root target.
        COLLEAGUE       — Named work contact of a root target.
        SPOUSE          — Named spouse / partner of a root target.
        SOCIAL_ENVELOPE — Anonymous cluster pseudo-entity. Owns Vector-B
                          phones (numbers found near the target but without
                          a confirmed person attached). Promoted to a named
                          relation when an operator identifies the owner.
    """

    TARGET          = "target"
    FAMILY          = "family"
    FRIEND          = "friend"
    COLLEAGUE       = "colleague"
    SPOUSE          = "spouse"
    SOCIAL_ENVELOPE = "social_envelope"


class AssociatedRelationType(str, Enum):
    """
    Operator-creatable subset of `RelationType`.

    Used as the Pydantic field type on every request body that lets an
    operator mint a new Entity row (single-entry, bulk-text grid,
    bulk-upload). Pydantic v2 rejects values outside this set at request
    parse time, so the service layer never sees an illegal token.

    Deliberately EXCLUDES:
        TARGET           — Targets are seeded via the client-onboarding
                           flow, not by operators. Allowing operator-created
                           targets would break the invariant that every
                           target's client_id is curated.
        SOCIAL_ENVELOPE  — Envelopes are auto-minted by the phone-side
                           bulk-text ingestion when a cluster of numbers
                           has no confirmed owner. Operators promote
                           envelopes to named relations via the verdict
                           endpoint, not by creating fresh ones here.
    """

    FAMILY    = "family"
    FRIEND    = "friend"
    COLLEAGUE = "colleague"
    SPOUSE    = "spouse"


# Frozen string set, exported for callers that need to test membership
# without importing the enum (e.g. service-layer guards, log filters).
# Kept in lockstep with the AssociatedRelationType enum.
ASSOCIATED_RELATIONS: frozenset[str] = frozenset(
    member.value for member in AssociatedRelationType
)


def is_associated(value: str) -> bool:
    """
    True iff `value` is one of the operator-creatable relation tokens.

    Convenience helper for code paths that already hold a string (e.g.
    a value pulled out of `Entity.entity_type` at runtime) and don't want
    to construct an enum just to test membership.

    Args:
        value (str): A token to check (case-sensitive).

    Returns:
        bool: True if the token is operator-creatable, False otherwise.
              Returns False for None, empty string, and any non-member.
    """
    return value in ASSOCIATED_RELATIONS
