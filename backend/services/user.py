"""
services/user.py — Phase AUTH user-account CRUD.

Sole writer to the `user` aggregate. Two creation paths:

    1. Self-serve registration (POST /api/v1/auth/register)
       — operator chooses username + password + managed_client_ids.

    2. Admin sync (startup hook reading `admins.json`)
       — reconciles file entries into the aggregate on every boot.

Both paths go through the same INSERT / UPDATE primitives here so
the controlled-vocabulary role check and password-hashing happen in
ONE place.

PRIVACY CONTRACT
----------------
The structured columns hold only structural identity (username,
role, active). Operator-visible fields beyond that — display_name,
managed_client_ids — live inside `extra_data`. Same Secrets-Free
pattern as the rest of the codebase. Reading them is a JSON-dict
access; writing them goes through `update_extra` to keep the merge
semantics in one helper.

Storage seam
------------
Reads and writes flow through repositories (see `repositories/`) so the
service runs identically on SQL and MongoDB. The two backends are kept
in sync by the dual-backend tests under tests/repositories/.
"""

from typing import List, Optional

from exceptions import UserAlreadyExistsError
from models.user import User, is_allowed_role
from repositories.storage import Storage
from services.auth import hash_password


class UserService:
    """
    Per-request user-aggregate writer + reader.

    The endpoint layer calls into this; the admin-sync startup hook
    also calls into this (it gets a fresh Storage at boot time via the
    same factory the request path uses).
    """

    def __init__(self, storage: Storage) -> None:
        self.users = storage.users

    # ----------------------------------------------------------------
    # Writers
    # ----------------------------------------------------------------

    def register(
        self,
        *,
        username: str,
        password: str,
        managed_client_ids: List[str],
        display_name: Optional[str] = None,
    ) -> User:
        """
        Self-serve registration. Always creates a `role='regular'`
        user — admins enter exclusively via the static-file sync path.

        Args:
            username (str): Trimmed and de-spaced by the caller; we
                only verify uniqueness here.
            password (str): Plaintext; hashed via bcrypt before storage.
            managed_client_ids (List[str]): Personalization seed.
                Caller (endpoint layer) is the source of truth for
                the non-empty invariant — we double-check defensively.
            display_name (Optional[str]): Optional friendly label.

        Returns:
            User: The committed, refreshed row.

        Raises:
            UserAlreadyExistsError: A row with this username already
                exists. The endpoint maps to 409.
        """
        if self.get_by_username(username) is not None:
            raise UserAlreadyExistsError(username=username)

        extra = {"managed_client_ids": list(managed_client_ids)}
        if display_name is not None:
            extra["display_name"] = display_name

        user = User(
            username=username,
            password_hash=hash_password(password),
            role="regular",
            active=True,
            extra_data=extra,
        )
        return self.users.add(user)

    def upsert_admin(
        self,
        *,
        username: str,
        password: str,
        display_name: Optional[str] = None,
    ) -> User:
        """
        Reconcile one entry from `admins.json` into the user aggregate.

        Three branches:
            - User missing      → INSERT with role='admin', active=True.
            - Hash differs      → UPDATE password_hash (admin rotated
                                   their password in the file).
            - Inactive/regular  → flip back to active=True, role='admin'.
                                   This is the "I removed and re-added
                                   the same username" recovery path.

        This method is called ONLY by the admin-sync startup hook —
        never from a request handler. There is no API endpoint for
        admin creation per the requirement.
        """
        user = self.get_by_username(username)

        new_hash = hash_password(password)

        if user is None:
            extra = {}
            if display_name is not None:
                extra["display_name"] = display_name
            # Admins don't need managed_client_ids — personalization
            # is off by default for them anyway, and they're not
            # tied to specific clients structurally.
            user = User(
                username=username,
                password_hash=new_hash,
                role="admin",
                active=True,
                extra_data=extra or None,
            )
            return self.users.add(user)

        # Existing row — reconcile fields. We only rewrite
        # password_hash when the plaintext genuinely changed; bcrypt
        # is deterministic given the same salt, but each new
        # `hash_password()` call generates a fresh salt, so direct
        # string comparison would always "differ." Verify the OLD
        # hash against the file's plaintext to detect actual changes.
        from services.auth import verify_password
        password_changed = not verify_password(password, user.password_hash)

        dirty = False
        if password_changed:
            user.password_hash = new_hash
            dirty = True
        if user.role != "admin":
            user.role = "admin"
            dirty = True
        if not user.active:
            user.active = True
            dirty = True
        if display_name is not None:
            extra = dict(user.extra_data or {})
            if extra.get("display_name") != display_name:
                extra["display_name"] = display_name
                user.extra_data = extra
                dirty = True

        if dirty:
            return self.users.update(user)
        return user

    def deactivate_admin(self, username: str) -> Optional[User]:
        """
        Soft-disable an admin whose entry has been removed from
        `admins.json`. NOT a hard delete — historical attribution
        columns (PipelineTask.resolved_by etc.) still reference the
        username as a free-form string.

        Returns None when the username isn't in the aggregate (no-op).
        """
        user = self.get_by_username(username)
        if user is None or not user.active:
            return user
        user.active = False
        return self.users.update(user)

    def update_managed_client_ids(
        self,
        user_id: str,
        client_ids: List[str],
    ) -> User:
        """
        Replace the operator's managed-client list.

        UAT round-3: empty lists are now ACCEPTED — an operator can
        opt out of personalization by clearing their managed-client
        list entirely. The toggle simply has no narrowing effect.
        """
        user = self.users.get(user_id)
        if user is None:
            raise ValueError(f"User id={user_id} not found.")
        extra = dict(user.extra_data or {})
        extra["managed_client_ids"] = list(client_ids)
        user.extra_data = extra
        return self.users.update(user)

    def update_display_name(self, user_id: str, display_name: str) -> User:
        """Patch `extra_data.display_name`. Operator-mutable UI field."""
        user = self.users.get(user_id)
        if user is None:
            raise ValueError(f"User id={user_id} not found.")
        extra = dict(user.extra_data or {})
        extra["display_name"] = display_name
        user.extra_data = extra
        return self.users.update(user)

    # ----------------------------------------------------------------
    # Readers (used by tests + by the admin-sync hook)
    # ----------------------------------------------------------------

    def get(self, user_id: str) -> Optional[User]:
        return self.users.get(user_id)

    def get_by_username(self, username: str) -> Optional[User]:
        rows = self.users.list({"username": username}, limit=1)
        return rows[0] if rows else None

    def list_admins(self) -> List[User]:
        """All admin rows, active OR inactive — used by the startup
        sync to find ex-admins to deactivate."""
        return list(self.users.list({"role": "admin"}))


# ===========================================================================
# Module-level helpers — read-only convenience exposed to the response layer
# ===========================================================================


def managed_client_ids_of(user: User) -> List[str]:
    """
    Convenience accessor — extract the personalization seed from the
    user's `extra_data`. Defensive against malformed JSON: returns
    an empty list when the key is missing or the value isn't a list
    of string ids. The response-shape layer + `require_admin` dep both
    need this; keeping it as a module-level helper avoids importing
    the whole UserService just for read access.
    """
    if user.extra_data is None:
        return []
    raw = user.extra_data.get("managed_client_ids", [])
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, str)]


def display_name_of(user: User) -> Optional[str]:
    """Same convenience for the optional display name."""
    if user.extra_data is None:
        return None
    raw = user.extra_data.get("display_name")
    return raw if isinstance(raw, str) else None


def is_role_supported(role: str) -> bool:
    """Re-export of the model-level `is_allowed_role` for symmetry."""
    return is_allowed_role(role)
