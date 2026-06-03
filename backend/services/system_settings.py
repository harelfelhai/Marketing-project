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
KNOWN_BACKENDS: tuple[str, ...] = ("sql", "mongo", "api")

# Backends that are actually wired and selectable right now. The SQL, MongoDB,
# and HTTP/REST ("api") repository providers are all implemented. Selecting
# 'mongo' requires a configured `MONGO_URL` (and a reachable mongod); selecting
# 'api' requires a configured `api_backend` block (base_url + per-table
# descriptors). The switch takes effect on the next reconnect / restart.
AVAILABLE_BACKENDS: tuple[str, ...] = ("sql", "mongo", "api")

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

    def _read_custom_filters(self) -> dict:
        """
        Return the persisted per-surface admin-defined ("custom") filters.

        Shape: { "<surface>": [ {"key","label","field","widget", ...}, ... ] }.
        These are the filters an admin adds beyond the built-in catalog —
        including filters on opaque extra_data keys (the descriptor's `field`
        is a dotted path like "extra_data.region"). Stored opaquely: the
        backend keeps only well-formed descriptor dicts and never interprets
        the labels/options (Secrets-Free Mandate — the human-readable parts
        live client-side, exactly like display_labels).
        """
        raw = self._read_all().get("custom_filters", {})
        if not isinstance(raw, dict):
            return {}
        out: dict = {}
        for surface, defs in raw.items():
            if not (isinstance(surface, str) and isinstance(defs, list)):
                continue
            clean = [
                d for d in defs
                if isinstance(d, dict)
                and isinstance(d.get("key"), str)
                and isinstance(d.get("field"), str)
            ]
            if clean:
                out[surface] = clean
        return out

    def _read_ingestion_fields(self) -> dict:
        """
        Return the persisted per-surface admin-defined ingestion fields.

        Shape: { "<surface>": [ {"key","label","widget","options"}, ... ] },
        surface ∈ {"entity","phone"}. These are extra input fields an admin
        adds to the add-person / add-number forms; each `key` is the
        extra_data key the captured value is stored under. Stored opaquely —
        the backend keeps only well-formed descriptor dicts (requiring a
        string `key`) and never interprets labels/options (Secrets-Free
        Mandate), exactly like custom_filters.
        """
        raw = self._read_all().get("ingestion_fields", {})
        if not isinstance(raw, dict):
            return {}
        out: dict = {}
        for surface, defs in raw.items():
            if not (isinstance(surface, str) and isinstance(defs, list)):
                continue
            clean = [
                d for d in defs
                if isinstance(d, dict) and isinstance(d.get("key"), str)
            ]
            if clean:
                out[surface] = clean
        return out

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _read_mongo_url(self) -> str | None:
        """Return the admin-configured MongoDB URL, or None if not yet set."""
        return self._read_all().get("mongo_url") or None

    def _read_api_config(self) -> dict | None:
        """
        Return the stored `api_backend` config, or None when not configured.

        "Configured" means a non-empty base_url and at least one table — the
        same bar the storage factory enforces before serving requests.
        """
        raw = self._read_all().get("api_backend")
        if not isinstance(raw, dict):
            return None
        if not (raw.get("base_url") and isinstance(raw.get("tables"), dict) and raw["tables"]):
            return None
        return raw

    @staticmethod
    def _redact_api_config(config: dict) -> dict:
        """
        Return a copy of the api_backend config safe to return to the frontend:
        the auth secrets (token + basic-auth password) are stripped, replaced by
        booleans (`has_token` / `has_password`) so the UI can show "configured"
        without the values.

        base_url / per-table paths / field maps / methods / pagination etc. ARE
        returned — they are infrastructure configuration (not real-world
        identity), so surfacing them lets an admin edit the multi-field config
        without re-typing it. This is the one deliberate departure from the
        write-only `mongo_url` pattern; the secrets never leave the server.
        """
        import copy

        redacted = copy.deepcopy(config)
        auth = redacted.get("auth")
        if isinstance(auth, dict):
            auth["has_token"] = bool(auth.pop("token", None))
            auth["has_password"] = bool(auth.pop("password", None))
        return redacted

    def _validate_api_config(self, config) -> dict:
        """
        Validate + normalise an incoming api_backend config. Returns the clean
        config to persist. Raises ValueError (→ 422) on a malformed shape.

        The schema is intentionally GENERIC so almost any REST API can be wired
        without code changes — see ApiRepository's module docstring for the full
        per-table descriptor (envelopes, method/path overrides, pagination,
        extra headers/query params, body wrapper).
        """
        if not isinstance(config, dict):
            raise ValueError("api config must be an object.")
        base_url = config.get("base_url")
        if not isinstance(base_url, str) or not base_url.strip():
            raise ValueError("base_url must be a non-empty string.")
        tables = config.get("tables")
        if not isinstance(tables, dict) or not tables:
            raise ValueError("at least one table must be configured under 'tables'.")

        def _str_map(value, label) -> dict:
            if value is None:
                return {}
            if not isinstance(value, dict) or not all(
                isinstance(k, str) for k in value
            ):
                raise ValueError(f"{label} must be a map with string keys.")
            return {str(k): ("" if v is None else (v if isinstance(v, (int, float, bool)) else str(v)))
                    for k, v in value.items()}

        def _opt_str(value, label) -> str:
            if value is None:
                return ""
            if not isinstance(value, str):
                raise ValueError(f"{label} must be a string.")
            return value

        clean_tables: dict = {}
        for key, desc in tables.items():
            if not isinstance(key, str) or not key.strip():
                raise ValueError("each table key must be a non-empty string.")
            if not isinstance(desc, dict):
                raise ValueError(f"table '{key}' must be an object.")
            entry: dict = {}
            if desc.get("path") is not None:
                if not isinstance(desc["path"], str):
                    raise ValueError(f"table '{key}': path must be a string.")
                entry["path"] = desc["path"].strip()
            entry["rows_path"] = _opt_str(desc.get("rows_path"), f"table '{key}': rows_path")
            item_path = _opt_str(desc.get("item_path"), f"table '{key}': item_path")
            if item_path:
                entry["item_path"] = item_path

            field_map = desc.get("field_map") or {}
            if not isinstance(field_map, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in field_map.items()
            ):
                raise ValueError(f"table '{key}': field_map must be a map of string->string.")
            entry["field_map"] = {k: v for k, v in field_map.items() if v.strip()}

            methods = _str_map(desc.get("methods"), f"table '{key}': methods")
            if methods:
                entry["methods"] = {k: str(v).upper() for k, v in methods.items()}
            path_templates = _str_map(desc.get("path_templates"), f"table '{key}': path_templates")
            if path_templates:
                entry["path_templates"] = path_templates
            qp = _str_map(desc.get("query_params"), f"table '{key}': query_params")
            if qp:
                entry["query_params"] = qp
            hdrs = _str_map(desc.get("headers"), f"table '{key}': headers")
            if hdrs:
                entry["headers"] = hdrs
            body_wrapper = _opt_str(desc.get("body_wrapper"), f"table '{key}': body_wrapper")
            if body_wrapper:
                entry["body_wrapper"] = body_wrapper

            pagination = desc.get("pagination")
            if pagination:
                if not isinstance(pagination, dict):
                    raise ValueError(f"table '{key}': pagination must be an object.")
                style = pagination.get("style", "none")
                if style not in ("none", "page", "offset", "cursor"):
                    raise ValueError(
                        f"table '{key}': pagination.style must be one of "
                        f"none|page|offset|cursor."
                    )
                if style != "none":
                    entry["pagination"] = pagination

            clean_tables[key.strip()] = entry

        clean: dict = {"base_url": base_url.strip(), "tables": clean_tables}

        gh = _str_map(config.get("headers"), "headers")
        if gh:
            clean["headers"] = gh
        gqp = _str_map(config.get("query_params"), "query_params")
        if gqp:
            clean["query_params"] = gqp

        auth = config.get("auth")
        if auth is not None:
            if not isinstance(auth, dict):
                raise ValueError("auth must be an object.")
            clean_auth: dict = {}
            header = auth.get("header")
            if header is not None:
                if not isinstance(header, str):
                    raise ValueError("auth.header must be a string.")
                clean_auth["header"] = header
            if auth.get("username") is not None:
                if not isinstance(auth["username"], str):
                    raise ValueError("auth.username must be a string.")
                clean_auth["username"] = auth["username"]
            # Accept new secrets; otherwise preserve the previously stored ones
            # (the frontend never sends existing secrets back — it only sees
            # has_token / has_password). A blank value means "leave unchanged".
            prev = self._read_all().get("api_backend")
            prev_auth = (prev or {}).get("auth", {}) if isinstance(prev, dict) else {}
            for secret in ("token", "password"):
                val = auth.get(secret)
                if isinstance(val, str) and val.strip():
                    clean_auth[secret] = val
                elif prev_auth.get(secret):
                    clean_auth[secret] = prev_auth[secret]
            clean["auth"] = clean_auth

        timeout = config.get("timeout_s")
        if timeout is not None:
            if not isinstance(timeout, (int, float)) or timeout <= 0:
                raise ValueError("timeout_s must be a positive number.")
            clean["timeout_s"] = timeout
        return clean

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
            "custom_filters": self._read_custom_filters(),
            "ingestion_fields": self._read_ingestion_fields(),
            "vocabularies": self._read_vocabularies(),
            "mongo_configured": self._read_mongo_url() is not None,
            "api_configured": self._read_api_config() is not None,
            "api_config": (
                self._redact_api_config(self._read_api_config())
                if self._read_api_config() is not None
                else None
            ),
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
        # The contract never lies: an unconfigured backend can't be activated.
        if backend == "api" and self._read_api_config() is None:
            raise ValueError(
                "Storage backend 'api' requires an API configuration first "
                "(set base_url and at least one table)."
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

    def set_custom_filters(self, surface: str, filters: list) -> dict:
        """
        Persist the admin-defined custom filters for one surface.

        Each entry must be a dict carrying at least a string `key` and a
        string `field` (the backend filter path, e.g. "extra_data.region").
        Other keys (label, widget, options) are stored opaquely. An empty
        list clears the surface's custom filters.

        Raises:
            ValueError: malformed surface name, or an entry missing key/field.
        """
        if not isinstance(surface, str) or not surface.strip():
            raise ValueError("surface must be a non-empty string.")
        if not isinstance(filters, list):
            raise ValueError("filters must be a list.")
        for d in filters:
            if not (isinstance(d, dict)
                    and isinstance(d.get("key"), str) and d["key"].strip()
                    and isinstance(d.get("field"), str) and d["field"].strip()):
                raise ValueError(
                    "each custom filter must have a non-empty 'key' and 'field'."
                )
        data = self._read_all()
        store = data.get("custom_filters")
        if not isinstance(store, dict):
            store = {}
        store[surface.strip()] = list(filters)
        data["custom_filters"] = store
        self._write_all(data)
        return self.get()

    def set_ingestion_fields(self, surface: str, fields: list) -> dict:
        """
        Persist the admin-defined dynamic ingestion fields for one surface
        ("entity" or "phone").

        Each entry must be a dict carrying at least a non-empty string `key`
        (the extra_data key the captured value is stored under). label /
        widget / options are stored opaquely. An empty list clears the
        surface's ingestion fields.

        Raises:
            ValueError: malformed surface name, or an entry missing `key`.
        """
        if not isinstance(surface, str) or not surface.strip():
            raise ValueError("surface must be a non-empty string.")
        if not isinstance(fields, list):
            raise ValueError("fields must be a list.")
        for d in fields:
            if not (isinstance(d, dict)
                    and isinstance(d.get("key"), str) and d["key"].strip()):
                raise ValueError("each ingestion field must have a non-empty 'key'.")
        data = self._read_all()
        store = data.get("ingestion_fields")
        if not isinstance(store, dict):
            store = {}
        store[surface.strip()] = list(fields)
        data["ingestion_fields"] = store
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

    def set_api_config(self, config: dict) -> dict:
        """
        Validate + connection-test an `api_backend` config and persist it.

        The auth token is stored server-side and NEVER returned to the
        frontend (only the redacted `api_config` + `api_configured` flag are
        surfaced — see `_redact_api_config`). When the incoming config omits a
        token, the previously stored one is preserved.

        Raises:
            ValueError: the config is malformed or the remote API is
                unreachable / auth-rejected. The endpoint maps this to 422.
        """
        clean = self._validate_api_config(config)

        from repositories.api_connection import test_api_config, reset_api_connection
        ok, err = test_api_config(clean)
        if not ok:
            raise ValueError(f"Cannot reach the configured API: {err}")

        data = self._read_all()
        data["api_backend"] = clean
        self._write_all(data)

        # Reset the process-wide client so the next request uses the new
        # auth/timeout rather than the stale one from the previous build.
        reset_api_connection()

        return self.get()
