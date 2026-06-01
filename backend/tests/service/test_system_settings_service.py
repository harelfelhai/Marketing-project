"""
test_system_settings_service.py — the on-disk system-settings store.

Pins the SystemSettingsService contract the System Settings tab depends on:
  - defaults to 'sql' when the file is missing or malformed
  - get() returns the backend catalog with availability flags
  - set_storage_backend persists and round-trips
  - unknown / not-yet-available backends raise ValueError (→ 422 at the edge)
"""

import json

import pytest

from services.system_settings import (
    AVAILABLE_BACKENDS,
    DEFAULT_BACKEND,
    KNOWN_BACKENDS,
    SystemSettingsService,
)


@pytest.fixture()
def svc(tmp_path):
    return SystemSettingsService(path=str(tmp_path / "system_settings.json"))


class TestRead:
    def test_missing_file_defaults_to_sql(self, svc):
        out = svc.get()
        assert out["storage_backend"] == DEFAULT_BACKEND == "sql"
        assert out["applies_on_restart"] is True

    def test_backend_catalog_flags_availability(self, svc):
        by_id = {b["id"]: b["available"] for b in svc.get()["backends"]}
        assert set(by_id) == set(KNOWN_BACKENDS)
        assert by_id["sql"] is True
        assert by_id["mongo"] is True   # provider wired (needs MONGO_URL at deploy)

    def test_malformed_file_degrades_to_default(self, tmp_path):
        p = tmp_path / "system_settings.json"
        p.write_text("{ not valid json", encoding="utf-8")
        svc = SystemSettingsService(path=str(p))
        assert svc.get()["storage_backend"] == "sql"

    def test_unknown_persisted_backend_degrades_to_default(self, tmp_path):
        p = tmp_path / "system_settings.json"
        p.write_text(json.dumps({"storage_backend": "redis"}), encoding="utf-8")
        svc = SystemSettingsService(path=str(p))
        assert svc.get()["storage_backend"] == "sql"


class TestWrite:
    def test_set_sql_persists_and_round_trips(self, svc, tmp_path):
        out = svc.set_storage_backend("sql")
        assert out["storage_backend"] == "sql"
        # A fresh service over the same path reads the persisted value.
        again = SystemSettingsService(path=str(tmp_path / "system_settings.json"))
        assert again.get()["storage_backend"] == "sql"

    def test_set_unknown_backend_raises(self, svc):
        with pytest.raises(ValueError, match="[Uu]nknown"):
            svc.set_storage_backend("redis")

    def test_set_mongo_backend_is_accepted(self, svc):
        # Both SQL and Mongo providers are wired now.
        assert "mongo" in KNOWN_BACKENDS
        assert "mongo" in AVAILABLE_BACKENDS
        out = svc.set_storage_backend("mongo")
        assert out["storage_backend"] == "mongo"

    def test_set_truly_unavailable_backend_raises(self, svc, monkeypatch):
        # A known-but-unavailable backend (simulated) is rejected with a
        # clear message so the contract never lies about what works.
        import services.system_settings as mod
        monkeypatch.setattr(mod, "KNOWN_BACKENDS", ("sql", "mongo", "redis"))
        monkeypatch.setattr(mod, "AVAILABLE_BACKENDS", ("sql", "mongo"))
        with pytest.raises(ValueError, match="not available"):
            svc.set_storage_backend("redis")
