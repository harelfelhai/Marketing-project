"""
services/auth.py — Phase AUTH session + password primitives.

The single writer to the `session` table and the centralized source
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
"""

import secrets
from typing import Optional

import bcrypt
from sqlmodel import Session as DbSession, select

from exceptions import InvalidCredentialsError
from models.types import utc_now
from models.user import Session, User


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

    Args:
        plaintext (str): The raw password.

    Returns:
        str: The bcrypt hash as a UTF-8 string. Suitable for storage
        in `User.password_hash`.
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

    Args:
        plaintext (str): The user-supplied password attempt.
        hashed    (str): The stored bcrypt hash from `User.password_hash`.

    Returns:
        bool: True iff the plaintext matches.
    """
    try:
        return bcrypt.checkpw(
            plaintext.encode("utf-8"),
            hashed.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


# ===========================================================================
# AuthService — sole writer to the session table
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

    def __init__(self, session: DbSession) -> None:
        """
        Args:
            session (DbSession): Active SQLModel session (per-request).
        """
        self.session = session

    # ----------------------------------------------------------------
    # Login + logout
    # ----------------------------------------------------------------

    def login(self, *, username: str, password: str) -> tuple[User, Session]:
        """
        Verify credentials and mint a fresh session row.

        Args:
            username (str): The login identifier. NOT normalized
                (case-sensitive); leading/trailing whitespace is
                stripped by the caller (the endpoint layer).
            password (str): Plaintext password attempt.

        Returns:
            (User, Session): The authenticated user + the freshly
            persisted session row. The caller writes
            `session.token` into the cookie.

        Raises:
            InvalidCredentialsError: username unknown, user inactive,
                or password mismatch. The error message is identical
                for all three cases — operator-friendly courtesy, not
                a security hardening posture.
        """
        user = self.session.exec(
            select(User).where(User.username == username)
        ).first()
        if user is None or not user.active:
            raise InvalidCredentialsError()
        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError()

        sess = Session(
            token=secrets.token_urlsafe(self._TOKEN_BYTES),
            user_id=user.id,
        )
        self.session.add(sess)
        self.session.commit()
        self.session.refresh(sess)
        return user, sess

    def logout(self, token: str) -> None:
        """
        Delete the session row for `token`. Idempotent — a token that
        doesn't exist (already logged out, never existed) is a no-op
        rather than an error.

        Args:
            token (str): The cookie value supplied by the client.
        """
        row = self.session.get(Session, token)
        if row is None:
            return
        self.session.delete(row)
        self.session.commit()

    # ----------------------------------------------------------------
    # Per-request lookup (powers get_current_user)
    # ----------------------------------------------------------------

    def session_user(self, token: Optional[str]) -> Optional[User]:
        """
        Resolve a cookie value to the owning User.

        Bumps `Session.last_seen_at` on every hit (via the column's
        onupdate=utc_now). This makes the audit story honest: "who
        was actively using the system at time T?" is one indexed
        scan.

        Returns None on every failure path:
            - token is None / empty (no cookie)
            - session row doesn't exist (revoked / mistyped cookie)
            - user row doesn't exist (admin removed from file but
              session not yet cleaned up)
            - user.active is False (deactivated mid-session)

        Args:
            token (Optional[str]): Cookie value from the request.

        Returns:
            Optional[User]: The owning user, or None.
        """
        if not token:
            return None
        sess = self.session.get(Session, token)
        if sess is None:
            return None
        user = self.session.get(User, sess.user_id)
        if user is None or not user.active:
            return None

        # Touch last_seen_at so audit queries can answer "who was
        # active recently?". The column's `onupdate` hook only fires
        # when SQLAlchemy sees the row as DIRTY — assigning a fresh
        # value forces that. Explicitly setting via utc_now() also
        # makes the read flow's write-side intent unambiguous.
        sess.last_seen_at = utc_now()
        self.session.add(sess)
        self.session.commit()
        return user
