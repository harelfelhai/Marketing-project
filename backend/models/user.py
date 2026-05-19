"""
models/user.py — `User` + `Session` tables (Phase AUTH).

Two tables, one role:

    User
        Authenticatable identity. Holds a bcrypt password hash and a
        coarse `role` flag ('admin' | 'regular'). The `managed_client_ids`
        list — the seed for the personalization filter — lives inside
        `extra_data`.

    Session
        One row per active login. Opaque urlsafe token is the PK;
        deleting the row revokes the session. Sessions have no TTL —
        they live until logout or manual cleanup. This matches the
        Phase AUTH guardrail (not security wall) framing: revocation
        is operator-driven, not policy-driven.

ARCHITECTURAL ROLE
------------------
Auth is treated as a guardrail to prevent ACCIDENTAL operator
mis-clicks on Admin-only surfaces (Task Center), NOT as a defense
against insider attacks. The implementation reflects that — bcrypt
for password hygiene, HttpOnly + SameSite=Lax cookies as free
hardening, but no CSRF tokens, no session rotation, no expiry
policies.

PRIVACY CONTRACT
----------------
The structured columns hold only structural identity (username,
role, active). Proprietary per-user metadata — managed_client_ids,
display_name, contact_email — lives inside `extra_data`. The same
Secrets-Free Mandate the rest of the codebase follows.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from models.types import UTCDateTime, utc_now as _utc_now


# Vocabulary of allowed roles. Stored as a string column for forward
# compatibility — if future tiers ('senior_admin', 'auditor') land,
# they're a config change, not a schema migration. The application's
# `require_admin` dep is the only place that checks against this set.
_ALLOWED_ROLES: frozenset[str] = frozenset({"admin", "regular"})


# ===========================================================================
# User
# ===========================================================================


class User(SQLModel, table=True):
    """
    An authenticatable identity in the system.

    Two creation paths:
        1. Self-serve registration via POST /api/v1/auth/register
           — operator chooses username + password + managed_client_ids.
        2. Static admin file (`admins.json`) synced at app startup
           — admin entries are reconciled INSERT / UPDATE / DEACTIVATE
           from the file into this table by AdminSyncService.

    The `active` flag is the soft-disable switch. Sessions are kept
    in lockstep: when an admin is removed from `admins.json`, their
    row's `active` flips to False and the startup hook deletes their
    sessions. We do not hard-delete users — historical audit fields
    (PipelineTask.resolved_by, etc.) still reference the username
    string for posterity.
    """

    __tablename__ = "user"

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    id: Optional[int] = Field(
        default=None,
        primary_key=True,
        description="Auto-incrementing surrogate PK.",
    )

    username: str = Field(
        unique=True,
        index=True,
        nullable=False,
        max_length=80,
        description=(
            "Unique login identifier. Case-sensitive by design — the "
            "auth flow normalizes input via .strip() but not via "
            ".lower() so 'Alice' and 'alice' are distinct usernames."
        ),
    )

    # ------------------------------------------------------------------
    # Credentials
    # ------------------------------------------------------------------

    password_hash: str = Field(
        nullable=False,
        max_length=120,
        description=(
            "bcrypt hash of the operator's password. Generated with "
            "the library's default cost (12). NEVER set this column "
            "from raw input — always route through services.auth.hash_password."
        ),
    )

    # ------------------------------------------------------------------
    # Authorization
    # ------------------------------------------------------------------

    role: str = Field(
        default="regular",
        index=True,
        nullable=False,
        description=(
            "Coarse role flag: 'admin' (Task Center access) or "
            "'regular' (everything else). Indexed for the rare "
            "'list all admins' admin-audit query."
        ),
    )

    active: bool = Field(
        default=True,
        nullable=False,
        description=(
            "Soft-disable flag. The auth flow rejects login attempts "
            "when False. Existing sessions for a deactivated user are "
            "kept (the cookie still points at a valid row) but the "
            "per-request `get_current_user` dep returns None for them, "
            "so they're effectively logged out on next request."
        ),
    )

    # ------------------------------------------------------------------
    # Timestamps
    # ------------------------------------------------------------------

    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
        description="UTC timestamp when this user was created.",
    )

    updated_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, onupdate=_utc_now),
        description="UTC timestamp of the most recent update.",
    )

    # ------------------------------------------------------------------
    # Extensible payload bucket
    # ------------------------------------------------------------------

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description=(
            "Proprietary per-user payload. Conventions for keys (NOT "
            "enforced at DB level):"
            "\n  - managed_client_ids: list[int]  ← personalization seed"
            "\n  - display_name:       str"
            "\n  - contact_email:      str"
            "\n"
            "The auth services read `managed_client_ids` for the "
            "personalization filter; everything else is opaque to the "
            "backend and treated as pass-through."
        ),
    )


# ===========================================================================
# Session
# ===========================================================================


class Session(SQLModel, table=True):
    """
    One row per active login.

    The `token` is the cookie value AND the PK — opaque urlsafe
    random string, 32 bytes (~43 chars base64). Cookie-side it's
    HttpOnly + SameSite=Lax. DB-side it's just a string. Looking up
    "who is making this request" is one PK lookup followed by a JOIN
    to user.

    No `expires_at` column. Sessions live until:
        1. The operator hits POST /auth/logout (we DELETE the row).
        2. An admin is deactivated by the admin-sync startup hook
           (their sessions get bulk-deleted).
        3. Someone manually runs a cleanup script.

    This matches the Phase AUTH guardrail framing — we're not
    enforcing security policies, just preventing accidental
    mis-clicks. TTL housekeeping is out of scope.
    """

    __tablename__ = "session"

    token: str = Field(
        primary_key=True,
        max_length=80,
        description=(
            "Opaque urlsafe random token. Generated via "
            "`secrets.token_urlsafe(32)` at login time; never reused. "
            "Doubles as the cookie value (set HttpOnly + "
            "SameSite=Lax) and the PK of this table."
        ),
    )

    user_id: int = Field(
        foreign_key="user.id",
        index=True,
        nullable=False,
        description=(
            "FK to the owning user. Indexed for the rare 'log this "
            "user out everywhere' bulk-delete query."
        ),
    )

    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False),
        description="UTC timestamp when this session was issued.",
    )

    last_seen_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(UTCDateTime(), nullable=False, onupdate=_utc_now),
        description=(
            "UTC timestamp of the most recent request authenticated "
            "by this session. Updated on every successful "
            "`get_current_user` lookup. Useful for future audit / "
            "'who was active last week' reports — not enforced today."
        ),
    )

    extra_data: Optional[dict] = Field(
        default=None,
        sa_column=Column(JSON),
        description=(
            "Optional session metadata bucket — User-Agent string, "
            "IP prefix, anything else useful for future audit. The "
            "auth layer never reads this column; it's write-only "
            "audit context."
        ),
    )


# ===========================================================================
# Module-level helpers
# ===========================================================================


def is_allowed_role(role: str) -> bool:
    """
    True iff `role` is in the controlled vocabulary. Used by the
    user-creation paths (registration + admin sync) to reject bad
    role tokens before they reach the DB.
    """
    return role in _ALLOWED_ROLES
