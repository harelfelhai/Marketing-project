"""
services/system_settings.py — operator-editable system settings store.

The "System Settings" tab in the frontend is an admin-only surface for
runtime-selectable INFRASTRUCTURE choices — the things that historically
required editing many files to swap. The first such choice is the storage
backend (the database engine the app reads/writes through).

Persistence
-----------
Settings live in a small JSON file on disk (path from
`settings.system_settings_path`), NOT in the database. That is deliberate:
the `storage_backend` value selects which database is active, so it cannot
be stored inside the database it selects — it must be readable at boot
regardless of which engine is wired. The file is the single source of truth;
changes take effect on the next reconnect / restart.

Backend selector contract
-------------------------
`KNOWN_BACKENDS` are every engine the UI may display. `AVAILABLE_BACKENDS`
are the ones actually wired and usable right now. In this phase only `sql`
is available; `mongo` is a known-but-not-yet-available option (its provider
lands in a later phase). Selecting a known-but-unavailable backend is
rejected with a clear error so the contract never lies about what works.
"""

from __future__ import annotations

import json
from pathlib import Path

# Every storage backend the UI may surface as an option.
KNOWN_BACKENDS: tuple[str, ...] = ("sql", "mongo")

# Backends that are actually wired and selectable right now. Both the SQL
# and MongoDB repository providers are implemented and proven at parity by
# the dual-backend test suite. Selecting 'mongo' requires the deployment to
# have configured `MONGO_URL` (and a reachable mongod); the switch takes
# effect on the next reconnect / restart.
AVAILABLE_BACKENDS: tuple[str, ...] = ("sql", "mongo")

DEFAULT_BACKEND = "sql"


class SystemSettingsService:
    """
    Read/write accessor for the on-disk system-settings file.

    Constructed per request via the FastAPI dependency factory with the
    configured path. All reads are defensive: a missing or malformed file
    degrades to the safe default rather than raising, so a corrupted file
    can never block app startup or the settings screen.
    """

    def __init__(self, path: str) -> None:
        self._path = Path(path)

    # ------------------------------------------------------------------
    # Internal file IO
    # ------------------------------------------------------------------

    def _read_backend(self) -> str:
        """Return the persisted storage_backend, or the default."""
        if not self._path.exists():
            return DEFAULT_BACKEND
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, ValueError):
            return DEFAULT_BACKEND
        backend = data.get("storage_backend", DEFAULT_BACKEND) if isinstance(data, dict) else DEFAULT_BACKEND
        return backend if backend in KNOWN_BACKENDS else DEFAULT_BACKEND

    def _write_backend(self, backend: str) -> None:
        self._path.write_text(
            json.dumps({"storage_backend": backend}, indent=2),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self) -> dict:
        """
        Return the full settings view: the active backend plus the catalog
        of known backends with an `available` flag on each (so the UI can
        render unavailable options as disabled).
        """
        current = self._read_backend()
        return {
            "storage_backend": current,
            "backends": [
                {"id": b, "available": b in AVAILABLE_BACKENDS}
                for b in KNOWN_BACKENDS
            ],
            "applies_on_restart": True,
        }

    def set_storage_backend(self, backend: str) -> dict:
        """
        Persist a new storage backend selection.

        Raises:
            ValueError: the backend is unknown, or known but not yet
                available (no wired provider). The endpoint maps this to
                422 so the UI surfaces a clear message.
        """
        if backend not in KNOWN_BACKENDS:
            raise ValueError(
                f"Unknown storage backend '{backend}'. "
                f"Known backends: {', '.join(KNOWN_BACKENDS)}."
            )
        if backend not in AVAILABLE_BACKENDS:
            raise ValueError(
                f"Storage backend '{backend}' is not available yet."
            )
        self._write_backend(backend)
        return self.get()
