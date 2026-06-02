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
    # Internal file IO — the whole settings document
    # ------------------------------------------------------------------

    def _read_all(self) -> dict:
        """Return the full settings doc, or {} on a missing/corrupt file."""
        if not self._path.exists():
            return {}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write_all(self, data: dict) -> None:
        self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _read_backend(self) -> str:
        """Return the persisted storage_backend, or the default."""
        backend = self._read_all().get("storage_backend", DEFAULT_BACKEND)
        return backend if backend in KNOWN_BACKENDS else DEFAULT_BACKEND

    def _read_display_fields(self) -> dict:
        """
        Return the persisted per-surface display-field selections.

        Shape: { "<surface>": ["<field_key>", ...], ... }. Opaque to the
        backend — the field catalog + labels live in the frontend config
        layer (Secrets-Free Mandate). An empty / missing entry means the
        surface falls back to its frontend-defined defaults.
        """
        raw = self._read_all().get("display_fields", {})
        if not isinstance(raw, dict):
            return {}
        # Keep only well-formed entries: surface -> list[str].
        out: dict = {}
        for surface, fields in raw.items():
            if isinstance(surface, str) and isinstance(fields, list):
                out[surface] = [f for f in fields if isinstance(f, str)]
        return out

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self) -> dict:
        """
        Return the full settings view: the active backend, the catalog of
        known backends (with an `available` flag), and the per-surface
        display-field selections.
        """
        return {
            "storage_backend": self._read_backend(),
            "backends": [
                {"id": b, "available": b in AVAILABLE_BACKENDS}
                for b in KNOWN_BACKENDS
            ],
            "display_fields": self._read_display_fields(),
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
        data = self._read_all()
        data["storage_backend"] = backend
        self._write_all(data)
        return self.get()

    def set_display_fields(self, surface: str, fields: list) -> dict:
        """
        Persist the visible-field selection (ordered) for one surface.

        The backend stores the selection opaquely — it does not know the
        field catalog (that lives in the frontend). It only validates the
        shape: a non-empty surface name and a list of string field keys.
        An empty list is allowed (means "show nothing custom"; the frontend
        decides whether to then fall back to defaults).

        Raises:
            ValueError: malformed surface name or fields list.
        """
        if not isinstance(surface, str) or not surface.strip():
            raise ValueError("surface must be a non-empty string.")
        if not isinstance(fields, list) or not all(isinstance(f, str) for f in fields):
            raise ValueError("fields must be a list of strings.")
        data = self._read_all()
        display = data.get("display_fields")
        if not isinstance(display, dict):
            display = {}
        display[surface.strip()] = list(fields)
        data["display_fields"] = display
        self._write_all(data)
        return self.get()
