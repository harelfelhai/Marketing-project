"""
Service-layer tests for AuthService + password primitives.

Covers:
    - hash_password produces a bcrypt hash that verify_password validates
    - Round-trip rejects wrong passwords / corrupted hashes
    - login() happy path issues a session row with a unique token
    - login() rejects unknown / inactive / wrong-password
    - logout() is idempotent
    - session_user() returns None on the documented failure paths
    - session_user() touches last_seen_at on every hit
"""

import time

import pytest

from exceptions import InvalidCredentialsError
from models.user import Session, User
from services.auth import (
    AuthService,
    hash_password,
    verify_password,
)


# ---------------------------------------------------------------------------
# Password primitives
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    def test_round_trip_matches(self):
        h = hash_password("hunter2")
        assert verify_password("hunter2", h) is True

    def test_wrong_password_rejected(self):
        h = hash_password("hunter2")
        assert verify_password("wrong", h) is False

    def test_corrupted_hash_returns_false_without_raising(self):
        # bcrypt would raise ValueError on a malformed hash;
        # verify_password must catch and return False so a corrupted
        # DB row doesn't crash the login endpoint.
        assert verify_password("anything", "not-a-real-hash") is False
        assert verify_password("anything", "") is False

    def test_each_hash_uses_a_fresh_salt(self):
        # bcrypt embeds the salt in the output; same plaintext should
        # produce DIFFERENT hashes each call (different salts).
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2
        assert verify_password("same", h1) is True
        assert verify_password("same", h2) is True


# ---------------------------------------------------------------------------
# AuthService.login + logout + session_user
# ---------------------------------------------------------------------------


@pytest.fixture()
def auth_svc(session):
    return AuthService(session=session)


@pytest.fixture()
def alice(session):
    u = User(
        username="alice",
        password_hash=hash_password("hunter2"),
        role="regular",
    )
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


class TestLogin:
    def test_happy_path_issues_session_row(self, auth_svc, alice, session):
        user, sess = auth_svc.login(username="alice", password="hunter2")
        assert user.id == alice.id
        assert sess.token   # non-empty
        # Session row is persisted.
        assert session.get(Session, sess.token) is not None

    def test_wrong_password_raises(self, auth_svc, alice):
        with pytest.raises(InvalidCredentialsError):
            auth_svc.login(username="alice", password="wrong")

    def test_unknown_username_raises(self, auth_svc):
        with pytest.raises(InvalidCredentialsError):
            auth_svc.login(username="nobody", password="anything")

    def test_inactive_user_cannot_login(self, auth_svc, alice, session):
        alice.active = False
        session.add(alice)
        session.commit()
        with pytest.raises(InvalidCredentialsError):
            auth_svc.login(username="alice", password="hunter2")

    def test_each_login_mints_a_unique_token(self, auth_svc, alice):
        _, s1 = auth_svc.login(username="alice", password="hunter2")
        _, s2 = auth_svc.login(username="alice", password="hunter2")
        assert s1.token != s2.token


class TestLogout:
    def test_deletes_session_row(self, auth_svc, alice, session):
        _, sess = auth_svc.login(username="alice", password="hunter2")
        auth_svc.logout(sess.token)
        assert session.get(Session, sess.token) is None

    def test_unknown_token_is_idempotent_noop(self, auth_svc):
        # No row, no error.
        auth_svc.logout("not-a-real-token")

    def test_empty_token_is_idempotent(self, auth_svc):
        auth_svc.logout("")


class TestSessionUser:
    def test_returns_user_for_valid_token(self, auth_svc, alice):
        _, sess = auth_svc.login(username="alice", password="hunter2")
        u = auth_svc.session_user(sess.token)
        assert u is not None
        assert u.id == alice.id

    def test_none_when_token_is_none(self, auth_svc):
        assert auth_svc.session_user(None) is None

    def test_none_when_token_empty(self, auth_svc):
        assert auth_svc.session_user("") is None

    def test_none_when_token_unknown(self, auth_svc):
        assert auth_svc.session_user("not-a-real-token") is None

    def test_none_when_user_deactivated_mid_session(
        self, auth_svc, alice, session,
    ):
        _, sess = auth_svc.login(username="alice", password="hunter2")
        alice.active = False
        session.add(alice)
        session.commit()
        # Same token, but user is now inactive — session_user must
        # treat it as logged-out.
        assert auth_svc.session_user(sess.token) is None

    def test_last_seen_at_bumps_on_each_hit(self, auth_svc, alice, session):
        _, sess = auth_svc.login(username="alice", password="hunter2")
        first = sess.last_seen_at
        # Sleep a tiny bit so the second utc_now() reads a different
        # timestamp. UTCDateTime has microsecond resolution on SQLite.
        time.sleep(0.01)
        auth_svc.session_user(sess.token)
        session.expire_all()
        reread = session.get(Session, sess.token)
        assert reread.last_seen_at > first
