"""
services/admin_sync.py — Phase AUTH startup reconciliation.

On every application boot, this module reads the static `admins.json`
file and reconciles it into the `user` table:

    - Entry in file, missing in DB     → INSERT (role='admin', active=True)
    - Entry in file, hash differs      → UPDATE password_hash
    - Entry in DB, missing from file   → mark active=False
                                          + delete any open sessions
                                          (effectively logging the
                                          ex-admin out everywhere).

The file is read fresh on every boot. To rotate an admin's password
or add a new admin: edit the file, restart the process. No API
surface — this matches the requirement that admins NOT be creatable
through the UI.

File format (JSON):

    {
      "admins": [
        { "username": "alice", "password": "alice-password" },
        { "username": "bob",   "password": "bob-password", "display_name": "Bob" }
      ]
    }

Plaintext passwords are accepted in the file (the deployer's trust
boundary — see Phase AUTH design discussion). They're hashed on
INSERT / UPDATE before persistence; the file is never modified.

ABSENT FILE
-----------
If the file is missing OR contains an empty `admins` array, the
sync is a quiet no-op. The application boots normally — the
`require_admin` dep will simply reject every request to the Task
Center because no admin user exists. This is the right failure
mode: an unconfigured deployment loses Task Center access entirely
rather than silently dropping the role check.

MALFORMED FILE
--------------
A JSON parse error or schema violation aborts the sync with a
clear log line. The application still boots — better to have a
running pipeline with no Task Center access than a crashed
server.
"""

import json
import logging
from pathlib import Path
from typing import Any, Optional

from sqlmodel import Session as DbSession, delete

from config import settings
from models.user import Session as SessionRow
from services.user import UserService


_LOG = logging.getLogger(__name__)


def sync_admins(session: DbSession, config_path: Optional[Path] = None) -> dict:
    """
    Reconcile `admins.json` into the `user` table.

    Args:
        session (DbSession): Active DB session. The caller owns its
            lifecycle (it's the same session the startup hook gets
            via `next(get_session())`).
        config_path (Optional[Path]): Override the file location. The
            production path is `settings.admin_config_path`; tests
            pass a temp file via this parameter.

    Returns:
        dict: Summary of changes — keys 'created', 'updated',
              'deactivated', 'unchanged' map to int counts. Useful
              for the startup log line so deployers can confirm the
              sync did what they expected.
    """
    path = config_path or Path(settings.admin_config_path)

    summary = {
        "created":     0,
        "synced":      0,    # existing rows reconciled (whether actually
                             # modified or already matching the file). The
                             # cost of distinguishing "really modified" vs
                             # "already matched" is more code than it's
                             # worth for a startup log line.
        "deactivated": 0,
        "errors":      [],
    }

    if not path.exists():
        _LOG.info("sync_admins: file not found at %s — skipping", path)
        return summary

    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        # Don't crash the app. A malformed admins file means no Task
        # Center access — that's a much friendlier failure than a
        # production process refusing to boot.
        msg = f"sync_admins: failed to read {path}: {exc}"
        _LOG.error(msg)
        summary["errors"].append(msg)
        return summary

    entries = doc.get("admins") if isinstance(doc, dict) else None
    if not isinstance(entries, list):
        msg = f"sync_admins: {path} has no 'admins' array; skipping"
        _LOG.warning(msg)
        summary["errors"].append(msg)
        return summary

    svc = UserService(session=session)

    # Track usernames present in the file so we can deactivate any
    # admin in the DB that DOESN'T appear (the removed-from-file case).
    seen_usernames: set[str] = set()

    for entry in entries:
        try:
            _apply_one(svc, entry, summary)
            seen_usernames.add(_validate_username(entry["username"]))
        except _SyncEntryError as exc:
            summary["errors"].append(str(exc))
            _LOG.error("sync_admins: %s", exc)

    # Deactivate admins present in DB but missing from file. We DO
    # NOT hard-delete — historical attribution columns
    # (PipelineTask.resolved_by, etc.) still reference the username.
    for admin in svc.list_admins():
        if admin.username not in seen_usernames and admin.active:
            svc.deactivate_admin(admin.username)
            summary["deactivated"] += 1
            # Also blow away any open sessions so an ex-admin's
            # cookie stops working immediately on the next request.
            session.execute(
                delete(SessionRow).where(SessionRow.user_id == admin.id)
            )
            session.commit()

    _LOG.info(
        "sync_admins: created=%d synced=%d deactivated=%d errors=%d",
        summary["created"], summary["synced"], summary["deactivated"],
        len(summary["errors"]),
    )
    return summary


# ===========================================================================
# Internal helpers
# ===========================================================================


class _SyncEntryError(Exception):
    """Raised when one file entry is malformed. Caught at the loop boundary."""


def _validate_username(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _SyncEntryError(f"invalid username: {value!r}")
    return value.strip()


def _apply_one(svc: UserService, entry: Any, summary: dict) -> None:
    """
    Reconcile one file entry. Mutates `summary` in place.
    """
    if not isinstance(entry, dict):
        raise _SyncEntryError(f"entries must be objects, got {type(entry).__name__}")

    username = _validate_username(entry.get("username"))
    password = entry.get("password")
    if not isinstance(password, str) or not password:
        raise _SyncEntryError(f"missing/invalid password for username={username!r}")
    display_name = entry.get("display_name")
    if display_name is not None and not isinstance(display_name, str):
        raise _SyncEntryError(f"display_name must be str for username={username!r}")

    existed = svc.get_by_username(username) is not None
    svc.upsert_admin(
        username=username,
        password=password,
        display_name=display_name,
    )
    summary["created" if not existed else "synced"] += 1
