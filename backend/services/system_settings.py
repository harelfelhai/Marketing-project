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

# ---------------------------------------------------------------------------
# Vocabulary management
# ---------------------------------------------------------------------------

KNOWN_VOCABULARY_NAMES: frozenset[str] = frozenset({
    "relation_types",
    "phone_types",
    "task_types",
    # Phase VOCAB — every closed list in the product is operator-managed,
    # not just the three "type" lists. Statuses and ingestion sources are
    # editable from the System Settings tab like any other vocabulary.
    "verification_statuses",
    "task_statuses",
    "ingestion_sources",
})

# Defaults aligned to the values actually present in the seed data
# (scripts/seed_large.py) so a fresh deploy's lists match the rows it ships.
DEFAULT_VOCABULARIES: dict[str, list[str]] = {
    "relation_types":        ["primary", "family", "friend", "colleague", "spouse", "associated"],
    "phone_types":           ["mobile", "work", "home", "type_a", "type_b"],
    "ingestion_sources":     ["api", "manual", "import", "partner_feed"],
    "verification_statuses": ["pending", "verified", "rejected"],
    "task_types":            ["remediation_failure", "approval_required", "manual_recommendation"],
    "task_statuses":         ["pending", "done", "rejected"],
}


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

    def _read_vocabularies(self) -> dict[str, list[str]]:
        """Return the persisted vocabulary lists, falling back to defaults."""
        raw = self._read_all().get("vocabularies", {})
        if not isinstance(raw, dict):
            raw = {}
        result: dict[str, list[str]] = {}
        for name, default in DEFAULT_VOCABULARIES.items():
            stored = raw.get(name)
            if isinstance(stored, list) and all(isinstance(v, str) for v in stored):
                result[name] = stored
            else:
                result[name] = list(default)
        return result

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

    def _read_display_labels(self) -> dict:
        """
        Return the persisted per-surface column-label overrides.

        Shape: { "<surface>": { "<field_key>": "<label>", ... }, ... }.
        Opaque to the backend — it stores whatever the frontend sends and
        never interprets the labels. A missing surface / key means the
        frontend uses its default label for that column.
        """
        raw = self._read_all().get("display_labels", {})
        if not isinstance(raw, dict):
            return {}
        out: dict = {}
        for surface, labels in raw.items():
            if isinstance(surface, str) and isinstance(labels, dict):
                clean = {
                    k: v for k, v in labels.items()
                    if isinstance(k, str) and isinstance(v, str)
                }
                if clean:
                    out[surface] = clean
        return out

    def _read_filter_fields(self) -> dict:
        """
        Return the persisted per-surface active-filter selections.

        Shape: { "<surface>": ["<filter_key>", ...], ... }. Opaque to the
        backend — the filter catalog + labels live in the frontend config
        layer (Secrets-Free Mandate). An empty / missing entry means the
        surface falls back to its frontend-defined defaults.

        Mirrors _read_display_fields exactly; the only reason this is a
        separate setting is the surfaces / keys come from a different
        frontend catalog (filterFields.js vs displayFields.js).
        """
        raw = self._read_all().get("filter_fields", {})
        if not isinstance(raw, dict):
            return {}
        out: dict = {}
        for surface, fields in raw.items():
            if isinstance(surface, str) and isinstance(fields, list):
                out[surface] = [f for f in fields if isinstance(f, str)]
        return out

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _read_mongo_url(self) -> str | None:
        """Return the admin-configured MongoDB URL, or None if not yet set."""
        return self._read_all().get("mongo_url") or None

    def get(self) -> dict:
        """
        Return the full settings view: the active backend, the catalog of
        known backends (with an `available` flag), the per-surface
        display-field selections, and whether a MongoDB URL has been
        configured (never the URL itself — secrets stay server-side).
        """
        return {
            "storage_backend": self._read_backend(),
            "backends": [
                {"id": b, "available": b in AVAILABLE_BACKENDS}
                for b in KNOWN_BACKENDS
            ],
            "display_fields": self._read_display_fields(),
            "display_labels": self._read_display_labels(),
            "filter_fields":  self._read_filter_fields(),
            "vocabularies": self._read_vocabularies(),
            "mongo_configured": self._read_mongo_url() is not None,
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

    def set_filter_fields(self, surface: str, fields: list) -> dict:
        """
        Persist the active-filter selection (ordered) for one surface.

        Mirrors set_display_fields: opaque storage, identical validation.
        An empty list is allowed (means "no active custom filters"; the
        frontend decides whether to then fall back to defaults).

        Raises:
            ValueError: malformed surface name or fields list.
        """
        if not isinstance(surface, str) or not surface.strip():
            raise ValueError("surface must be a non-empty string.")
        if not isinstance(fields, list) or not all(isinstance(f, str) for f in fields):
            raise ValueError("fields must be a list of strings.")
        data = self._read_all()
        store = data.get("filter_fields")
        if not isinstance(store, dict):
            store = {}
        store[surface.strip()] = list(fields)
        data["filter_fields"] = store
        self._write_all(data)
        return self.get()

    def set_display_labels(self, surface: str, labels: dict) -> dict:
        """
        Persist column-label overrides for one surface.

        Like display_fields, the backend stays opaque: it validates only the
        shape (non-empty surface, a dict of str->str) and stores it verbatim.
        An empty dict clears the surface's overrides entirely so columns
        revert to their frontend default labels.

        Raises:
            ValueError: malformed surface name or labels map.
        """
        if not isinstance(surface, str) or not surface.strip():
            raise ValueError("surface must be a non-empty string.")
        if not isinstance(labels, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in labels.items()
        ):
            raise ValueError("labels must be a map of string keys to string values.")
        data = self._read_all()
        store = data.get("display_labels")
        if not isinstance(store, dict):
            store = {}
        cleaned = {k: v for k, v in labels.items() if v.strip()}
        if cleaned:
            store[surface.strip()] = cleaned
        else:
            # Empty / all-blank overrides → drop the surface entry entirely.
            store.pop(surface.strip(), None)
        data["display_labels"] = store
        self._write_all(data)
        return self.get()

    def get_vocabulary(self, name: str) -> list[str]:
        """
        Return the vocabulary list for `name`.

        Raises:
            ValueError: name is not one of the known vocabulary names.
        """
        if name not in KNOWN_VOCABULARY_NAMES:
            raise ValueError(
                f"Unknown vocabulary '{name}'. "
                f"Known vocabularies: {', '.join(sorted(KNOWN_VOCABULARY_NAMES))}."
            )
        return self._read_vocabularies()[name]

    def set_vocabulary(self, name: str, items: list[str]) -> dict:
        """
        Persist a new vocabulary list.

        Raises:
            ValueError: name is unknown, or items is not a list of strings.
        """
        if name not in KNOWN_VOCABULARY_NAMES:
            raise ValueError(
                f"Unknown vocabulary '{name}'. "
                f"Known vocabularies: {', '.join(sorted(KNOWN_VOCABULARY_NAMES))}."
            )
        if not isinstance(items, list) or not all(isinstance(v, str) for v in items):
            raise ValueError("items must be a list of strings.")
        data = self._read_all()
        vocabs = data.get("vocabularies")
        if not isinstance(vocabs, dict):
            vocabs = {}
        vocabs[name] = list(items)
        data["vocabularies"] = vocabs
        self._write_all(data)
        return self.get()

    def set_mongo_url(self, url: str) -> dict:
        """
        Validate connectivity to a MongoDB URL and persist it server-side.

        The URL is stored in system_settings.json and NEVER returned to the
        frontend — callers only see the boolean `mongo_configured` flag in
        the settings response (Secrets-Free Mandate).

        Raises:
            ValueError: URL is empty or the connection test fails.
        """
        if not isinstance(url, str) or not url.strip():
            raise ValueError("MongoDB URL must be a non-empty string.")
        url = url.strip()

        from repositories.mongo_connection import test_mongo_url, reset_mongo_connection
        ok, err = test_mongo_url(url)
        if not ok:
            raise ValueError(f"Cannot connect to MongoDB: {err}")

        data = self._read_all()
        data["mongo_url"] = url
        self._write_all(data)

        # Reset the process-wide singleton so the next request uses the
        # new URL rather than the stale one from the previous build.
        reset_mongo_connection()

        return self.get()
