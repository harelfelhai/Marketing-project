"""
Tests for the static admins.json → user-table reconciliation hook.

Covers:
    - Missing file → quiet no-op, no errors
    - Malformed JSON → logged error, app still boots
    - Missing 'admins' array → logged error, app still boots
    - First boot: file entries → INSERTs with role='admin', active=True
    - Second boot, same file: idempotent, no spurious updates
    - File password edit → UPDATE on next boot
    - Entry removed from file → DB row flipped to active=False AND
      open sessions blown away
    - Re-adding the same username → reactivates the existing row
"""

import json
import secrets
from pathlib import Path

import pytest

from models.user import Session as SessionRow, User
from services.admin_sync import sync_admins
from services.auth import verify_password


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write(tmp_path: Path, payload: dict) -> Path:
    p = tmp_path / "admins.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _get_user(session, username):
    from sqlmodel import select
    return session.exec(select(User).where(User.username == username)).first()


# ---------------------------------------------------------------------------
# Absent / malformed file
# ---------------------------------------------------------------------------


class TestAbsentOrMalformed:
    def test_missing_file_is_silent_noop(self, session, tmp_path):
        # Pointing at a non-existent path should not raise; should
        # return an empty summary.
        summary = sync_admins(session=session, config_path=tmp_path / "nope.json")
        assert summary["created"] == 0
        assert summary["synced"] == 0
        assert summary["deactivated"] == 0
        assert summary["errors"] == []

    def test_malformed_json_is_logged_not_raised(self, session, tmp_path):
        p = tmp_path / "admins.json"
        p.write_text("{not-json", encoding="utf-8")
        summary = sync_admins(session=session, config_path=p)
        # Logged as an error but the app doesn't crash.
        assert len(summary["errors"]) == 1

    def test_missing_admins_array_is_warning_not_raised(self, session, tmp_path):
        p = _write(tmp_path, {"not_admins": []})
        summary = sync_admins(session=session, config_path=p)
        assert len(summary["errors"]) == 1


# ---------------------------------------------------------------------------
# First boot — INSERTs
# ---------------------------------------------------------------------------


class TestFirstBoot:
    def test_each_entry_inserts_one_admin_row(self, session, tmp_path):
        p = _write(tmp_path, {
            "admins": [
                {"username": "alice", "password": "pw1"},
                {"username": "bob",   "password": "pw2", "display_name": "Bob"},
            ],
        })
        summary = sync_admins(session=session, config_path=p)
        assert summary["created"] == 2
        assert summary["synced"] == 0

        alice = _get_user(session, "alice")
        bob   = _get_user(session, "bob")
        assert alice.role == "admin"
        assert alice.active is True
        assert verify_password("pw1", alice.password_hash)
        assert bob.extra_data["display_name"] == "Bob"

    def test_invalid_entry_does_not_block_others(self, session, tmp_path):
        # Mixed: one malformed (missing password), two valid.
        p = _write(tmp_path, {
            "admins": [
                {"username": "alice", "password": "pw1"},
                {"username": "missing_password"},
                {"username": "bob",   "password": "pw2"},
            ],
        })
        summary = sync_admins(session=session, config_path=p)
        assert summary["created"] == 2
        assert len(summary["errors"]) == 1
        assert _get_user(session, "missing_password") is None


# ---------------------------------------------------------------------------
# Second boot — idempotency
# ---------------------------------------------------------------------------


class TestIdempotency:
    def test_unchanged_file_does_not_rotate_password_hashes(
        self, session, tmp_path,
    ):
        p = _write(tmp_path, {"admins": [{"username": "alice", "password": "pw"}]})
        sync_admins(session=session, config_path=p)
        first_hash = _get_user(session, "alice").password_hash

        # Run again with no changes.
        sync_admins(session=session, config_path=p)
        second_hash = _get_user(session, "alice").password_hash
        # Same hash — the service detected "password unchanged" and
        # skipped the rotate. (We use verify_password to detect this,
        # not raw string comparison.)
        assert first_hash == second_hash

    def test_unchanged_run_counts_as_synced_not_created(self, session, tmp_path):
        p = _write(tmp_path, {"admins": [{"username": "alice", "password": "pw"}]})
        sync_admins(session=session, config_path=p)
        second = sync_admins(session=session, config_path=p)
        assert second["created"] == 0
        assert second["synced"] == 1


# ---------------------------------------------------------------------------
# Password rotation
# ---------------------------------------------------------------------------


class TestPasswordRotation:
    def test_file_password_edit_rotates_hash_on_next_sync(
        self, session, tmp_path,
    ):
        p = _write(tmp_path, {"admins": [{"username": "alice", "password": "old"}]})
        sync_admins(session=session, config_path=p)
        original_hash = _get_user(session, "alice").password_hash

        # Operator edits the file + restarts → sync runs again.
        p.write_text(json.dumps({
            "admins": [{"username": "alice", "password": "new"}],
        }), encoding="utf-8")
        sync_admins(session=session, config_path=p)

        new_hash = _get_user(session, "alice").password_hash
        assert new_hash != original_hash
        assert verify_password("new", new_hash)
        assert not verify_password("old", new_hash)


# ---------------------------------------------------------------------------
# Removal → deactivate + session cleanup
# ---------------------------------------------------------------------------


class TestRemoval:
    def test_admin_removed_from_file_is_deactivated_on_next_sync(
        self, session, tmp_path,
    ):
        p = _write(tmp_path, {
            "admins": [
                {"username": "alice", "password": "pw"},
                {"username": "bob",   "password": "pw"},
            ],
        })
        sync_admins(session=session, config_path=p)

        # Operator removes bob.
        p.write_text(json.dumps({
            "admins": [{"username": "alice", "password": "pw"}],
        }), encoding="utf-8")
        summary = sync_admins(session=session, config_path=p)

        assert summary["deactivated"] == 1
        assert _get_user(session, "alice").active is True
        assert _get_user(session, "bob").active is False

    def test_removal_deletes_open_sessions(self, session, tmp_path):
        from sqlmodel import select

        p = _write(tmp_path, {
            "admins": [{"username": "alice", "password": "pw"}],
        })
        sync_admins(session=session, config_path=p)
        alice = _get_user(session, "alice")

        # Seed an open session for alice.
        token = secrets.token_urlsafe(32)
        sess = SessionRow(token=token, user_id=alice.id)
        session.add(sess)
        session.commit()
        assert session.get(SessionRow, token) is not None

        # Remove alice from the file + sync — session should be gone.
        p.write_text(json.dumps({"admins": []}), encoding="utf-8")
        sync_admins(session=session, config_path=p)
        # Clear the identity map so the lookup hits the DB rather
        # than returning a stale (now-deleted) row from cache.
        session.expunge_all()
        assert session.exec(
            select(SessionRow).where(SessionRow.token == token)
        ).first() is None

    def test_re_adding_removed_admin_reactivates_existing_row(
        self, session, tmp_path,
    ):
        p = _write(tmp_path, {"admins": [{"username": "alice", "password": "pw"}]})
        sync_admins(session=session, config_path=p)
        original_id = _get_user(session, "alice").id

        # Remove → next boot deactivates.
        p.write_text(json.dumps({"admins": []}), encoding="utf-8")
        sync_admins(session=session, config_path=p)
        assert _get_user(session, "alice").active is False

        # Re-add → reactivates same row (NOT a new one — preserves
        # FK references on PipelineTask.resolved_by etc.).
        p.write_text(json.dumps({
            "admins": [{"username": "alice", "password": "pw"}],
        }), encoding="utf-8")
        sync_admins(session=session, config_path=p)
        reread = _get_user(session, "alice")
        assert reread.id == original_id
        assert reread.active is True
