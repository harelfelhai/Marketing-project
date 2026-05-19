"""
Service-layer tests for UserService.

Covers:
    - register: happy path, duplicate username → UserAlreadyExistsError,
      empty managed_client_ids → ValueError
    - upsert_admin: INSERT new, UPDATE existing password, reactivate
      inactive, role upgrade from regular → admin
    - deactivate_admin: idempotent
    - update_managed_client_ids: replaces the list, empty rejected
    - module-level helpers: managed_client_ids_of / display_name_of
      degrade gracefully on missing keys
"""

import pytest

from exceptions import UserAlreadyExistsError
from models.user import User
from services.auth import verify_password
from services.user import (
    UserService,
    display_name_of,
    managed_client_ids_of,
)


@pytest.fixture()
def svc(session):
    return UserService(session=session)


# ---------------------------------------------------------------------------
# register
# ---------------------------------------------------------------------------


class TestRegister:
    def test_happy_path_creates_regular_user(self, svc):
        u = svc.register(
            username="alice",
            password="hunter2",
            managed_client_ids=[1, 2, 3],
            display_name="Alice",
        )
        assert u.id is not None
        assert u.role == "regular"
        assert u.active is True
        assert verify_password("hunter2", u.password_hash)
        # Managed clients + display name live in extra_data.
        assert u.extra_data["managed_client_ids"] == [1, 2, 3]
        assert u.extra_data["display_name"] == "Alice"

    def test_duplicate_username_raises(self, svc):
        svc.register(username="alice", password="x", managed_client_ids=[1])
        with pytest.raises(UserAlreadyExistsError):
            svc.register(username="alice", password="y", managed_client_ids=[2])

    def test_empty_managed_client_ids_is_accepted(self, svc):
        # UAT round-3: registration with no managed clients is now
        # valid. The operator can add clients later from /profile.
        user = svc.register(
            username="bob",
            password="x",
            managed_client_ids=[],
        )
        # Empty list flows through to extra_data.
        from services.user import managed_client_ids_of
        assert managed_client_ids_of(user) == []

    def test_display_name_optional(self, svc):
        u = svc.register(username="bob", password="x", managed_client_ids=[1])
        assert "display_name" not in (u.extra_data or {})


# ---------------------------------------------------------------------------
# upsert_admin
# ---------------------------------------------------------------------------


class TestUpsertAdmin:
    def test_creates_new_admin(self, svc):
        u = svc.upsert_admin(username="admin1", password="pw")
        assert u.role == "admin"
        assert u.active is True
        assert verify_password("pw", u.password_hash)

    def test_idempotent_on_same_password(self, svc):
        a = svc.upsert_admin(username="admin1", password="pw")
        b = svc.upsert_admin(username="admin1", password="pw")
        assert a.id == b.id
        # Same hash — second call shouldn't have rotated it (uses
        # verify_password to detect "really changed" not "looks different").
        assert a.password_hash == b.password_hash

    def test_updates_hash_when_password_changes(self, svc):
        first  = svc.upsert_admin(username="admin1", password="old")
        second = svc.upsert_admin(username="admin1", password="new")
        assert first.id == second.id
        assert verify_password("new", second.password_hash)
        assert not verify_password("old", second.password_hash)

    def test_promotes_regular_user_to_admin(self, svc):
        # Pre-existing regular user — admin sync should upgrade.
        regular = svc.register(username="dual", password="pw", managed_client_ids=[1])
        assert regular.role == "regular"
        upgraded = svc.upsert_admin(username="dual", password="pw")
        assert upgraded.id == regular.id
        assert upgraded.role == "admin"

    def test_reactivates_deactivated_user(self, svc):
        a = svc.upsert_admin(username="admin1", password="pw")
        svc.deactivate_admin("admin1")
        # Now re-add — same username should flip back to active.
        b = svc.upsert_admin(username="admin1", password="pw")
        assert b.id == a.id
        assert b.active is True

    def test_display_name_written_when_provided(self, svc):
        u = svc.upsert_admin(username="admin1", password="pw", display_name="Admin One")
        assert u.extra_data["display_name"] == "Admin One"


# ---------------------------------------------------------------------------
# deactivate_admin
# ---------------------------------------------------------------------------


class TestDeactivate:
    def test_flips_active_to_false(self, svc):
        svc.upsert_admin(username="admin1", password="pw")
        u = svc.deactivate_admin("admin1")
        assert u.active is False

    def test_already_inactive_is_noop(self, svc):
        svc.upsert_admin(username="admin1", password="pw")
        svc.deactivate_admin("admin1")
        # Calling again must not raise.
        u = svc.deactivate_admin("admin1")
        assert u.active is False

    def test_unknown_username_returns_none(self, svc):
        assert svc.deactivate_admin("ghost") is None


# ---------------------------------------------------------------------------
# update_managed_client_ids
# ---------------------------------------------------------------------------


class TestUpdateManagedClients:
    def test_replaces_the_list(self, svc):
        u = svc.register(username="alice", password="pw", managed_client_ids=[1])
        updated = svc.update_managed_client_ids(u.id, [2, 3])
        assert updated.extra_data["managed_client_ids"] == [2, 3]

    def test_empty_list_now_accepted_clears_managed_clients(self, svc):
        # UAT round-3: clearing the list opts the operator out of
        # personalization. No exception.
        u = svc.register(username="alice", password="pw", managed_client_ids=[1])
        updated = svc.update_managed_client_ids(u.id, [])
        assert updated.extra_data["managed_client_ids"] == []

    def test_unknown_user_rejected(self, svc):
        with pytest.raises(ValueError, match="not found"):
            svc.update_managed_client_ids(99_999, [1])


# ---------------------------------------------------------------------------
# Module-level helpers — defensive accessors
# ---------------------------------------------------------------------------


class TestExtractors:
    def test_managed_clients_returns_empty_when_extra_data_none(self):
        u = User(username="x", password_hash="x", role="regular", extra_data=None)
        assert managed_client_ids_of(u) == []

    def test_managed_clients_returns_empty_when_key_missing(self):
        u = User(username="x", password_hash="x", role="regular", extra_data={})
        assert managed_client_ids_of(u) == []

    def test_managed_clients_filters_non_ints(self):
        u = User(
            username="x", password_hash="x", role="regular",
            extra_data={"managed_client_ids": [1, "bad", 3, None]},
        )
        assert managed_client_ids_of(u) == [1, 3]

    def test_managed_clients_returns_empty_when_value_not_list(self):
        u = User(
            username="x", password_hash="x", role="regular",
            extra_data={"managed_client_ids": "not-a-list"},
        )
        assert managed_client_ids_of(u) == []

    def test_display_name_optional(self):
        u_with = User(
            username="x", password_hash="x", role="regular",
            extra_data={"display_name": "X"},
        )
        u_without = User(
            username="x", password_hash="x", role="regular",
            extra_data=None,
        )
        assert display_name_of(u_with) == "X"
        assert display_name_of(u_without) is None
