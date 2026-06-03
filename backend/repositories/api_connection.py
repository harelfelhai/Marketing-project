"""
repositories/api_connection.py — HTTP client lifecycle + config for the
'api' storage backend.

Only exercised when the System Settings storage backend is set to 'api'.
Mirrors repositories/mongo_connection.py:

  - The per-table config lives in system_settings.json under `api_backend`
    (read file-direct so this module has no import dependency on
    services.system_settings).
  - A single `httpx.Client` is built once and reused across requests
    (connection pooling lives inside the client). Auth header + timeout are
    baked into the client; per-table base_url/path are applied by ApiRepository.

Test seam
---------
`set_api_config_for_tests(config=..., client=...)` injects an in-memory config
and/or an httpx.Client backed by an `httpx.MockTransport`, so the factory and
repository paths can be exercised without any real network. The injected
values win over the file/real client (same precedence as
mongo_connection.set_mongo_database).
"""

from __future__ import annotations

from typing import Optional

import httpx

from config import settings
from repositories.api_repository import ApiBackendError

# Process-wide singleton client. Built once from the active config.
_client: Optional[httpx.Client] = None

# Test seams.
_injected_config: Optional[dict] = None
_injected_client: Optional[httpx.Client] = None

_DEFAULT_TIMEOUT_S = 10


def set_api_config_for_tests(config: Optional[dict] = None, client: Optional[httpx.Client] = None) -> None:
    """Inject an api_backend config and/or httpx.Client for tests. Pass None to reset."""
    global _injected_config, _injected_client
    _injected_config = config
    _injected_client = client


def _read_api_config() -> dict:
    """
    Return the `api_backend` config dict from system_settings.json, or {} when
    absent / unreadable. Reads the file directly (no import of
    services.system_settings) so this module stays dependency-light.
    """
    import json
    from pathlib import Path

    try:
        path = Path(settings.system_settings_path)
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("api_backend"), dict):
                return data["api_backend"]
    except Exception:
        pass
    return {}


def get_api_config() -> dict:
    """Return the active api_backend config (injected test config wins)."""
    if _injected_config is not None:
        return _injected_config
    return _read_api_config()


def _build_client(config: dict) -> httpx.Client:
    """
    Build an httpx.Client carrying the global connection concerns so every
    per-table request inherits them:
      - auth header (header + token), e.g. Authorization: Bearer ...
      - optional HTTP Basic auth (auth.username / auth.password)
      - extra global headers (config.headers)
      - extra global query params appended to every request (config.query_params),
        which covers api-key-in-query style APIs
      - request timeout
    """
    auth = config.get("auth") or {}
    headers: dict[str, str] = {}
    header = auth.get("header") or "Authorization"
    token = auth.get("token")
    if token:
        headers[header] = token
    for k, v in (config.get("headers") or {}).items():
        headers[str(k)] = str(v)

    params = {str(k): str(v) for k, v in (config.get("query_params") or {}).items()}
    timeout = config.get("timeout_s", _DEFAULT_TIMEOUT_S)

    basic = None
    if auth.get("username"):
        basic = (auth["username"], auth.get("password", ""))

    return httpx.Client(headers=headers, params=params, timeout=timeout, auth=basic)


def get_api_client() -> httpx.Client:
    """
    Return the active httpx.Client — the injected test double when present,
    otherwise the lazily-built singleton from the configured auth/timeout.
    """
    if _injected_client is not None:
        return _injected_client
    global _client
    if _client is None:
        _client = _build_client(get_api_config())
    return _client


def reset_api_connection() -> None:
    """
    Close + clear the singleton client so the next get_api_client() rebuilds
    with whatever config is current in system_settings.json. Called after an
    admin updates the api_backend config via System Settings.
    """
    global _client
    if _client is not None:
        try:
            _client.close()
        except Exception:
            pass
    _client = None


def test_api_config(config: dict, timeout_ms: int = 5000) -> tuple[bool, str]:
    """
    Probe an api_backend config without touching the process-wide singleton.

    Builds a throwaway client and issues a GET against the first configured
    table's collection endpoint. Reachability — not data correctness — is the
    bar: any HTTP response below 500 (and not an auth rejection) counts as
    reachable. Transport errors, 5xx, and 401/403 fail with a clear message.

    Returns (True, '') on success, (False, error_message) on failure.
    """
    base_url = (config.get("base_url") or "").rstrip("/")
    if not base_url:
        return False, "base_url is required."
    tables = config.get("tables")
    if not isinstance(tables, dict) or not tables:
        return False, "at least one table must be configured."

    # Pick a deterministic table to probe (first by sorted key).
    table_key = sorted(tables.keys())[0]
    desc = tables.get(table_key) or {}
    path = str(desc.get("path") or table_key).strip("/")
    url = f"{base_url}/{path}"

    try:
        client = _build_client(config)
        try:
            resp = client.get(url, timeout=timeout_ms / 1000)
        finally:
            client.close()
    except httpx.HTTPError as exc:
        return False, f"cannot reach {url}: {exc}"

    if resp.status_code in (401, 403):
        return False, f"auth rejected by {url} (HTTP {resp.status_code}) — check the token."
    if resp.status_code >= 500:
        return False, f"{url} returned HTTP {resp.status_code}."
    return True, ""


def require_api_config() -> dict:
    """
    Return the active config, raising ApiBackendError when the backend is
    selected but not configured (base_url missing). Used by the storage factory
    so a misconfigured 'api' selection fails loudly (mapped to 503) instead of
    silently producing empty results.
    """
    config = get_api_config()
    if not (config.get("base_url") and isinstance(config.get("tables"), dict)):
        raise ApiBackendError(
            "Storage backend 'api' is selected but not configured "
            "(missing base_url / tables in system_settings.json)."
        )
    return config
