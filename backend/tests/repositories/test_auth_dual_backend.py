"""
test_auth_dual_backend.py — UserService + AuthService on SQL and Mongo.

Runs every assertion against both backends. If registration, login, session
minting, or logout behaves differently on SQL vs Mongo, this suite fails —
that is the guarantee that auth keeps working when the System Settings
storage selector flips the database.

The Session aggregate is the trickiest of the lot because its PK is `token`,
not `id`. Passing here proves the dynamic PK detection in
repositories/serialization.py works for non-`id` primary keys.
"""

import mongomock
import pytest
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

import models  # noqa: F401  — registers table metadata
from exceptions import InvalidCredentialsError, UserAlreadyExistsError
from repositories.storage import MongoStorage, SqlStorage
from services.auth import AuthService
from services.user import UserService


# ---------------------------------------------------------------------------
# Both backends behind one storage-yielding fixture
# ---------------------------------------------------------------------------


@pytest.fixture(params=["sql", "mongo"])
def storage(request):
    if request.param == "sql":
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(engine)
        with Session(engine) as session:
            yield SqlStorage(session)
    else:
        database = mongomock.MongoClient()["test"]
        yield MongoStorage(database)


@pytest.fixture()
def users(storage):
    return UserService(storage=storage)


@pytest.fixture()
def auth(storage):
    return AuthService(storage=storage)


# ---------------------------------------------------------------------------
# UserService
# ---------------------------------------------------------------------------


class TestRegister:
    def test_creates_regular_user(self, users):
        u = users.register(
            username="alice",
            password="pass1234",
            managed_client_ids=["ent-1", "ent-2"],
            display_name="Alice",
        )
        assert u.username == "alice"
        assert u.role == "regular"
        assert u.active is True
        assert u.extra_data["managed_client_ids"] == ["ent-1", "ent-2"]
        assert u.extra_data["display_name"] == "Alice"

    def test_duplicate_username_raises(self, users):
        users.register(username="dup", password="pass1234", managed_client_ids=[])
        with pytest.raises(UserAlreadyExistsError):
            users.register(username="dup", password="pass1234", managed_client_ids=[])

    def test_get_by_username_returns_the_row(self, users):
        users.register(username="alice", password="pass1234", managed_client_ids=[])
        fetched = users.get_by_username("alice")
        assert fetched is not None
        assert fetched.username == "alice"

    def test_get_by_username_missing_returns_none(self, users):
        assert users.get_by_username("ghost") is None


class TestUpsertAdmin:
    def test_creates_new_admin(self, users):
        admin = users.upsert_admin(username="root", password="pw", display_name="Root")
        assert admin.role == "admin"
        assert admin.active is True

    def test_reactivates_inactive_admin(self, users):
        a = users.upsert_admin(username="root", password="pw")
        users.deactivate_admin("root")
        b = users.upsert_admin(username="root", password="pw")
        assert b.id == a.id
        assert b.active is True

    def test_list_admins(self, users):
        users.upsert_admin(username="a", password="pw")
        users.upsert_admin(username="b", password="pw")
        users.register(username="reg", password="pass1234", managed_client_ids=[])
        admins = users.list_admins()
        assert {a.username for a in admins} == {"a", "b"}


class TestUpdateExtras:
    def test_update_managed_client_ids_replaces_list(self, users):
        u = users.register(
            username="alice", password="pass1234",
            managed_client_ids=["ent-1"],
        )
        out = users.update_managed_client_ids(u.id, ["ent-2", "ent-3"])
        assert out.extra_data["managed_client_ids"] == ["ent-2", "ent-3"]

    def test_update_managed_client_ids_missing_user_raises(self, users):
        with pytest.raises(ValueError):
            users.update_managed_client_ids("nope", ["ent-1"])

    def test_update_display_name(self, users):
        u = users.register(
            username="alice", password="pass1234", managed_client_ids=[],
        )
        out = users.update_display_name(u.id, "Alice the Operator")
        assert out.extra_data["display_name"] == "Alice the Operator"


# ---------------------------------------------------------------------------
# AuthService
# ---------------------------------------------------------------------------


class TestLogin:
    def test_happy_path_returns_user_and_session(self, users, auth):
        u = users.register(
            username="alice", password="pass1234", managed_client_ids=[],
        )
        out_user, sess = auth.login(username="alice", password="pass1234")
        assert out_user.id == u.id
        assert sess.token  # opaque, non-empty
        assert sess.user_id == u.id

    def test_wrong_password_raises(self, users, auth):
        users.register(username="alice", password="pass1234", managed_client_ids=[])
        with pytest.raises(InvalidCredentialsError):
            auth.login(username="alice", password="wrong")

    def test_unknown_username_raises(self, auth):
        with pytest.raises(InvalidCredentialsError):
            auth.login(username="ghost", password="pass1234")

    def test_inactive_user_raises(self, users, auth):
        users.register(username="alice", password="pass1234", managed_client_ids=[])
        users.deactivate_admin("alice")  # works for regulars too — it just flips active
        with pytest.raises(InvalidCredentialsError):
            auth.login(username="alice", password="pass1234")


class TestSessionLifecycle:
    def test_session_user_round_trips(self, users, auth):
        users.register(username="alice", password="pass1234", managed_client_ids=[])
        _, sess = auth.login(username="alice", password="pass1234")
        resolved = auth.session_user(sess.token)
        assert resolved is not None
        assert resolved.username == "alice"

    def test_logout_makes_token_unresolvable(self, users, auth):
        users.register(username="alice", password="pass1234", managed_client_ids=[])
        _, sess = auth.login(username="alice", password="pass1234")
        auth.logout(sess.token)
        assert auth.session_user(sess.token) is None

    def test_logout_is_idempotent(self, auth):
        # Unknown token → no-op, no raise.
        auth.logout("never-existed")

    def test_session_user_none_for_empty_token(self, auth):
        assert auth.session_user(None) is None
        assert auth.session_user("") is None

    def test_mint_session_skips_password_check(self, users, auth):
        u = users.register(
            username="alice", password="pass1234", managed_client_ids=[],
        )
        sess = auth.mint_session(u)
        # The minted session is immediately usable.
        assert auth.session_user(sess.token).id == u.id
