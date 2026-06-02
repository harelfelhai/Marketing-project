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


class TestDisplayFields:
    def test_default_is_empty(self, svc):
        assert svc.get()["display_fields"] == {}

    def test_set_and_read_back(self, svc, tmp_path):
        out = svc.set_display_fields("entities", ["id", "name", "client"])
        assert out["display_fields"]["entities"] == ["id", "name", "client"]
        again = SystemSettingsService(path=str(tmp_path / "system_settings.json"))
        assert again.get()["display_fields"]["entities"] == ["id", "name", "client"]

    def test_set_preserves_storage_backend(self, svc):
        svc.set_storage_backend("sql")
        svc.set_display_fields("entities", ["id"])
        out = svc.get()
        assert out["storage_backend"] == "sql"
        assert out["display_fields"]["entities"] == ["id"]

    def test_multiple_surfaces_coexist(self, svc):
        svc.set_display_fields("entities", ["id", "name"])
        svc.set_display_fields("phones", ["phone_number"])
        df = svc.get()["display_fields"]
        assert df["entities"] == ["id", "name"]
        assert df["phones"] == ["phone_number"]

    def test_empty_list_allowed(self, svc):
        out = svc.set_display_fields("entities", [])
        assert out["display_fields"]["entities"] == []

    def test_bad_surface_raises(self, svc):
        with pytest.raises(ValueError):
            svc.set_display_fields("", ["id"])

    def test_bad_fields_raises(self, svc):
        with pytest.raises(ValueError):
            svc.set_display_fields("entities", "not-a-list")
        with pytest.raises(ValueError):
            svc.set_display_fields("entities", [1, 2, 3])


class TestFilterFields:
    def test_default_is_empty(self, svc):
        assert svc.get()["filter_fields"] == {}

    def test_set_and_read_back(self, svc, tmp_path):
        out = svc.set_filter_fields("phones", ["search", "phoneType"])
        assert out["filter_fields"]["phones"] == ["search", "phoneType"]
        again = SystemSettingsService(path=str(tmp_path / "system_settings.json"))
        assert again.get()["filter_fields"]["phones"] == ["search", "phoneType"]

    def test_empty_list_allowed(self, svc):
        out = svc.set_filter_fields("phones", [])
        assert out["filter_fields"]["phones"] == []

    def test_bad_inputs_raise(self, svc):
        with pytest.raises(ValueError):
            svc.set_filter_fields("", ["search"])
        with pytest.raises(ValueError):
            svc.set_filter_fields("phones", [1, 2])


class TestCustomFilters:
    def test_default_is_empty(self, svc):
        assert svc.get()["custom_filters"] == {}

    def test_set_and_read_back(self, svc, tmp_path):
        defs = [
            {"key": "region", "label": "אזור",
             "field": "extra_data.region", "widget": "text"},
        ]
        out = svc.set_custom_filters("phones", defs)
        assert out["custom_filters"]["phones"] == defs
        again = SystemSettingsService(path=str(tmp_path / "system_settings.json"))
        assert again.get()["custom_filters"]["phones"] == defs

    def test_empty_list_clears(self, svc):
        svc.set_custom_filters("phones", [{"key": "r", "field": "extra_data.r"}])
        out = svc.set_custom_filters("phones", [])
        assert out["custom_filters"].get("phones", []) == []

    def test_multiple_surfaces_coexist(self, svc):
        svc.set_custom_filters("phones", [{"key": "a", "field": "extra_data.a"}])
        svc.set_custom_filters("operations", [{"key": "b", "field": "extra_data.b"}])
        cf = svc.get()["custom_filters"]
        assert cf["phones"][0]["field"] == "extra_data.a"
        assert cf["operations"][0]["field"] == "extra_data.b"

    def test_entry_missing_key_or_field_raises(self, svc):
        with pytest.raises(ValueError):
            svc.set_custom_filters("phones", [{"label": "no key/field"}])
        with pytest.raises(ValueError):
            svc.set_custom_filters("phones", [{"key": "x"}])  # missing field
        with pytest.raises(ValueError):
            svc.set_custom_filters("phones", [{"field": "extra_data.x"}])  # missing key

    def test_bad_surface_or_type_raises(self, svc):
        with pytest.raises(ValueError):
            svc.set_custom_filters("", [])
        with pytest.raises(ValueError):
            svc.set_custom_filters("phones", "not-a-list")

    def test_malformed_persisted_entries_dropped_on_read(self, tmp_path):
        p = tmp_path / "system_settings.json"
        p.write_text(json.dumps({"custom_filters": {
            "phones": [
                {"key": "ok", "field": "extra_data.ok"},
                {"key": "missing-field"},
                "not-a-dict",
            ]
        }}), encoding="utf-8")
        svc = SystemSettingsService(path=str(p))
        out = svc.get()["custom_filters"]["phones"]
        assert out == [{"key": "ok", "field": "extra_data.ok"}]


class TestIngestionFields:
    def test_default_is_empty(self, svc):
        assert svc.get()["ingestion_fields"] == {}

    def test_set_and_read_back(self, svc, tmp_path):
        defs = [{"key": "region", "label": "אזור", "widget": "text"}]
        out = svc.set_ingestion_fields("entity", defs)
        assert out["ingestion_fields"]["entity"] == defs
        again = SystemSettingsService(path=str(tmp_path / "system_settings.json"))
        assert again.get()["ingestion_fields"]["entity"] == defs

    def test_entity_and_phone_surfaces_coexist(self, svc):
        svc.set_ingestion_fields("entity", [{"key": "role"}])
        svc.set_ingestion_fields("phone", [{"key": "carrier"}])
        fields = svc.get()["ingestion_fields"]
        assert fields["entity"][0]["key"] == "role"
        assert fields["phone"][0]["key"] == "carrier"

    def test_empty_list_clears(self, svc):
        svc.set_ingestion_fields("phone", [{"key": "carrier"}])
        out = svc.set_ingestion_fields("phone", [])
        assert out["ingestion_fields"].get("phone", []) == []

    def test_entry_missing_key_raises(self, svc):
        with pytest.raises(ValueError):
            svc.set_ingestion_fields("entity", [{"label": "no key"}])

    def test_bad_surface_or_type_raises(self, svc):
        with pytest.raises(ValueError):
            svc.set_ingestion_fields("", [])
        with pytest.raises(ValueError):
            svc.set_ingestion_fields("entity", "not-a-list")
