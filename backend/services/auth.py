"""
services/auth.py — Phase AUTH session + password primitives.

The single writer to the `session` aggregate and the centralized source
of password-hashing semantics. Kept narrow so future auth-flavor
changes (e.g., 2FA, token expiry) land in ONE place.

ARCHITECTURAL ROLE
------------------
This module sits beneath the FastAPI dep layer:

    Endpoint  →  Depends(get_current_user)
                       ↓
                 AuthService.session_user(token)
                       ↓
                 [reads `session` + `user` rows, returns User|None]

The endpoint handlers never call bcrypt directly; they go through
`AuthService.verify_password()`. Same for token issuance — every
new cookie is minted by `AuthService.create_session()`.

CONFIGURATION
-------------
Cookie name is a class-level constant (`AuthService.COOKIE_NAME`) so
the endpoint layer and the dep layer can import the same string
without circular references.

Storage seam
------------
All reads and writes flow through repositories so the service runs
identically on SQL and MongoDB.
"""

import secrets
from typing import Optional

import bcrypt

from exceptions import InvalidCredentialsError
from models.types import utc_now
from models.user import Session, User
from repositories.storage import Storage


# ===========================================================================
# Module-level password primitives
# ===========================================================================
#
# Exposed at module scope (not on the service class) so the admin-
# sync startup hook can hash plaintext passwords from `admins.json`
# without having to instantiate an AuthService.


def hash_password(plaintext: str) -> str:
    """
    Hash a plaintext password with bcrypt at the library default cost.

    The library's default cost (12 as of bcrypt 4.x) gives a ~250ms
    per-hash latency on modern hardware — fine for the auth flow's
    single-login-per-request cadence, and fine as a typo-deterrent
    for the admin-sync startup path.
    """
    return bcrypt.hashpw(
        plaintext.encode("utf-8"),
        bcrypt.gensalt(),
    ).decode("utf-8")


def verify_password(plaintext: str, hashed: str) -> bool:
    """
    Compare a plaintext password against a stored bcrypt hash.

    Never raises — a malformed hash returns False rather than
    propagating bcrypt's ValueError, so a corrupted DB row can't
    crash the login endpoint.
    """
    try:
        return bcrypt.checkpw(
            plaintext.encode("utf-8"),
            hashed.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


# ===========================================================================
# AuthService — sole writer to the session aggregate
# ===========================================================================


class AuthService:
    """
    Per-request service. Handles login (verify password + mint
    session), logout (delete session row), and the lookup that the
    `get_current_user` dep uses on every authenticated request.
    """

    # Cookie name. Single source of truth — endpoints set it on
    # Response.set_cookie(); the dep reads it via Request.cookies.get().
    COOKIE_NAME: str = "marketing_session"

    # Token byte length. `secrets.token_urlsafe(32)` yields ~43 chars
    # base64url. Plenty of entropy for an opaque session id.
    _TOKEN_BYTES: int = 32

    def __init__(self, storage: Storage) -> None:
        self.users = storage.users
        self.sessions = storage.sessions

    # ----------------------------------------------------------------
    # Login + logout
    # ----------------------------------------------------------------

    def mint_session(self, user: User) -> Session:
        """
        Mint a fresh session row for a user without re-verifying credentials.

        Used by the registration endpoint to log the operator in atomically
        with the account creation — the password was just hashed; running it
        back through `verify_password` here would be wasteful.
        """
        sess = Session(
            token=secrets.token_urlsafe(self._TOKEN_BYTES),
            user_id=user.id,
        )
        return self.sessions.add(sess)

    def login(self, *, username: str, password: str) -> tuple[User, Session]:
        """
        Verify credentials and mint a fresh session row.

        Raises:
            InvalidCredentialsError: username unknown, user inactive,
                or password mismatch. The error message is identical
                for all three cases — operator-friendly courtesy, not
                a security hardening posture.
        """
        rows = self.users.list({"username": username}, limit=1)
        user = rows[0] if rows else None
        if user is None or not user.active:
            raise InvalidCredentialsError()
        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError()

        sess = Session(
            token=secrets.token_urlsafe(self._TOKEN_BYTES),
            user_id=user.id,
        )
        return user, self.sessions.add(sess)

    def logout(self, token: str) -> None:
        """
        Delete the session row for `token`. Idempotent — a token that
        doesn't exist (already logged out, never existed) is a no-op
        rather than an error.
        """
        self.sessions.delete(token)

    # ----------------------------------------------------------------
    # Per-request lookup (powers get_current_user)
    # ----------------------------------------------------------------

    def session_user(self, token: Optional[str]) -> Optional[User]:
        """
        Resolve a cookie value to the owning User.

        Bumps `Session.last_seen_at` on every hit so the audit story
        is honest: "who was actively using the system at time T?" is
        one indexed scan.

        Returns None on every failure path:
            - token is None / empty (no cookie)
            - session row doesn't exist (revoked / mistyped cookie)
            - user row doesn't exist (admin removed from file but
              session not yet cleaned up)
            - user.active is False (deactivated mid-session)
        """
        if not token:
            return None
        sess = self.sessions.get(token)
        if sess is None:
            return None
        user = self.users.get(sess.user_id)
        if user is None or not user.active:
            return None

        # Touch last_seen_at so audit queries can answer "who was
        # active recently?".
        sess.last_seen_at = utc_now()
        self.sessions.update(sess)
        return user
