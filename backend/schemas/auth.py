"""
schemas/auth.py — Pydantic contracts for Phase AUTH endpoints.

The /api/v1/auth surface:

    RegisterRequest        — operator self-serve registration body
    LoginRequest           — username + password body
    PatchMeRequest         — partial-update body for /auth/me PATCH
                             (only operator-mutable fields are exposed)

    UserResponse           — the shape returned by /auth/me and after
                             successful login. Carries everything the
                             AuthContext needs to drive route gating +
                             personalization.

Validation philosophy mirrors the auth design's guardrail framing:
strict enough to catch typos, loose enough to avoid friction. No
password-strength enforcement (the docs would lie; we trust the
operator), no email-format validation (we don't store emails), no
reserved-username denylist.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class RegisterRequest(BaseModel):
    """
    Request body for POST /api/v1/auth/register.

    Self-serve. Anyone can create a regular-user account. Admins are
    NOT creatable via this endpoint — they only enter the system via
    the static `admins.json` file + startup sync.
    """

    username: str = Field(
        ...,
        min_length=2,
        max_length=80,
        description=(
            "Unique login identifier. Whitespace-trimmed server-side; "
            "case-sensitive (so 'Alice' and 'alice' are distinct)."
        ),
    )
    password: str = Field(
        ...,
        min_length=4,
        max_length=200,
        description=(
            "Plaintext password. Hashed via bcrypt before persistence "
            "— never stored in raw form. The min_length=4 floor is a "
            "typo guard, NOT a security policy."
        ),
    )
    managed_client_ids: List[str] = Field(
        default_factory=list,
        max_length=50,
        description=(
            "String ids of the clients the operator is responsible "
            "for. Drives the personalization default filter. May be "
            "empty at registration — operators can add or remove "
            "managed clients later from the profile editor (UAT "
            "round-3 change). Personalization toggle stays inert "
            "while the list is empty (nothing to filter to)."
        ),
    )
    display_name: Optional[str] = Field(
        default=None,
        max_length=80,
        description="Optional friendly name shown in the UI header.",
    )


class LoginRequest(BaseModel):
    """Request body for POST /api/v1/auth/login."""

    username: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Login identifier as registered.",
    )
    password: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Plaintext password — compared against the stored bcrypt hash.",
    )


class PatchMeRequest(BaseModel):
    """
    Request body for PATCH /api/v1/auth/me.

    True partial update — only non-None fields are applied. The
    operator can edit their `managed_client_ids` and `display_name`
    inline (e.g., from a future "Account settings" page).

    Username, password, and role are NOT exposed here. Password
    changes need a separate endpoint with old-password verification
    (out of scope for AUTH-A). Username changes risk breaking
    historical attribution columns (PipelineTask.resolved_by etc.) —
    we don't allow them. Role changes are the admin-sync file's job.
    """

    managed_client_ids: Optional[List[str]] = Field(
        default=None,
        max_length=50,
        description=(
            "Replace the operator's managed-client list. UAT round-3: "
            "an empty list is ACCEPTED — operators can opt out of "
            "personalization entirely. None (the field omitted) means "
            "'leave it untouched'; [] means 'clear it'."
        ),
    )
    display_name: Optional[str] = Field(default=None, max_length=80)


class UserResponse(BaseModel):
    """
    Public shape of the current user.

    Returned by:
        POST /auth/login   (after issuing the cookie)
        GET  /auth/me      (on mount in the frontend AuthContext)
        PATCH /auth/me     (after applying the patch)
        POST /auth/register

    The password_hash, last_seen_at, etc. are NEVER serialized — they
    have no consumer outside the backend and shipping them would
    invite confusion.
    """

    id: str
    username: str
    role: str
    managed_client_ids: List[str] = Field(default_factory=list)
    display_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
