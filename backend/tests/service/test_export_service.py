"""Service-layer tests for ExportService."""

import io

import openpyxl
import pytest

from models.entity import Entity
from models.phone_number import PhoneNumber
from services.export import (
    ALLOWED_EXPORT_COLUMNS_PHONES,
    ALLOWED_EXPORT_COLUMNS_TASKS,
    MAX_EXPORT_ROWS,
    ExportService,
)
from services.tasks import PipelineTaskService
from repositories.storage import SqlStorage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _col(key, label=None, fmt="text"):
    """Build a column descriptor matching the TableExportRequest shape."""
    return {"key": key, "label": label or key, "format": fmt}


def _read_workbook(xlsx_bytes):
    return openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True)


def _data_rows(wb):
    ws = wb["data"]
    return [tuple(c.value for c in row) for row in ws.iter_rows()]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def svc(session):
    return ExportService(session=session)


@pytest.fixture()
def seeded_phones(session):
    """Three phones across two clients, mixed verification statuses."""
    e1 = Entity(entity_type="target", client_id=1, extra_data={"customer_tier": 1})
    e2 = Entity(entity_type="target", client_id=2, extra_data={"customer_tier": 2})
    session.add_all([e1, e2])
    session.flush()
    p1 = PhoneNumber(
        entity_id=e1.id, phone_number="+15550001111",
        ingestion_source="manual", verification_status="pending",
        extra_data={"first_name": "Jane"},
    )
    p2 = PhoneNumber(
        entity_id=e1.id, phone_number="+15550002222",
        ingestion_source="automated", verification_status="verified_good",
        extra_data={"first_name": "Sam"},
    )
    p3 = PhoneNumber(
        entity_id=e2.id, phone_number="+15550003333",
        ingestion_source="manual", verification_status="pending",
        extra_data={"first_name": "Alex"},
    )
    session.add_all([p1, p2, p3])
    session.commit()
    return [p1, p2, p3]


# ===========================================================================
# Phones export — happy path
# ===========================================================================


class TestExportPhonesHappyPath:
    def test_returns_bytes_and_filename(self, svc, seeded_phones):
        xlsx_bytes, filename = svc.export_phones(
            filters={},
            columns=[_col("phone_number"), _col("entity_type")],
        )
        assert isinstance(xlsx_bytes, bytes)
        assert xlsx_bytes[:2] == b"PK"   # zip header for .xlsx
        assert filename.startswith("phones_")
        assert filename.endswith(".xlsx")

    def test_tz_aware_datetime_columns_serialise(self, svc, seeded_phones):
        # UAT round-3 regression: PhoneNumber.ingested_at lands as a
        # tz-aware UTC datetime via the UTCDateTime TypeDecorator, but
        # openpyxl raises TypeError on tz-aware cells. The formatter
        # must strip tzinfo before the cell is written. Passing here
        # means a full workbook builds without that crash.
        xlsx_bytes, _ = svc.export_phones(
            filters={},
            columns=[
                _col("phone_number"),
                _col("ingested_at", fmt="datetime"),
                _col("created_at",  fmt="datetime"),
            ],
        )
        assert xlsx_bytes[:2] == b"PK"   # workbook actually written
        assert len(xlsx_bytes) > 100     # not just the header bytes

    def test_header_row_uses_caller_supplied_labels(self, svc, seeded_phones):
        xlsx_bytes, _ = svc.export_phones(
            filters={},
            columns=[
                _col("phone_number", label="מספר טלפון"),
                _col("entity_type",  label="סוג ישות"),
            ],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        # Header row is the Hebrew labels verbatim.
        assert rows[0] == ("מספר טלפון", "סוג ישות")

    def test_data_rows_resolve_each_column(self, svc, seeded_phones):
        xlsx_bytes, _ = svc.export_phones(
            filters={},
            columns=[_col("phone_number"), _col("verification_status")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        # 1 header + 3 phones.
        assert len(rows) == 4
        phone_numbers = {r[0] for r in rows[1:]}
        assert phone_numbers == {"+15550001111", "+15550002222", "+15550003333"}

    def test_dotted_key_pulls_from_extra_data(self, svc, seeded_phones):
        xlsx_bytes, _ = svc.export_phones(
            filters={},
            columns=[
                _col("phone_number"),
                _col("extra_data.first_name", label="שם פרטי"),
            ],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        names = {r[1] for r in rows[1:]}
        assert names == {"Jane", "Sam", "Alex"}

    def test_entity_level_extra_data_first_name_lands_in_export(self, svc, session):
        """
        UAT round-3 regression: the export catalog promises
        `extra_data.first_name` will resolve, but in the real app the
        name lives on the OWNING ENTITY's extra_data, not on the phone.
        Previously the flatten step copied phone.extra_data verbatim and
        the column came back empty. Now the entity blob is merged into
        the flat row so entity-level dotted keys resolve cleanly.

        Round-2 of the same fix: the merged blob must come from the
        IMMEDIATE owning entity, not the root target — otherwise
        associated entities (Jane family of David) export the root's
        name instead of their own.
        """
        from datetime import datetime, timezone
        # Root target with its own name.
        root = Entity(
            entity_type="target",
            client_id=7,
            extra_data={"first_name": "David", "last_name": "Levi"},
        )
        session.add(root)
        session.commit()
        session.refresh(root)
        # Associated entity (Jane, family of David).
        jane = Entity(
            entity_type="family",
            client_id=7,
            target_entity_id=root.id,
            extra_data={"first_name": "Jane", "last_name": "Cohen"},
        )
        session.add(jane)
        session.commit()
        session.refresh(jane)
        # Phone attached to Jane (not to the root).
        ph = PhoneNumber(
            entity_id=jane.id,
            phone_number="+972500000777",
            classification_type="type_a",
            ingestion_source="manual",
            verification_status="pending",
            ingested_at=datetime.now(timezone.utc),
            extra_data={},
        )
        session.add(ph)
        session.commit()

        xlsx_bytes, _ = svc.export_phones(
            # Two-level model: client_id == the root entity's id.
            filters={"client_id": root.id},
            columns=[
                _col("phone_number"),
                _col("extra_data.first_name", label="שם"),
                _col("extra_data.last_name",  label="משפחה"),
                _col("root_first_name",       label="שם-שורש"),
                _col("root_last_name",        label="משפחה-שורש"),
            ],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        # extra_data.* → Jane Cohen (immediate); root_* → David Levi.
        assert rows[1] == (
            "+972500000777", "Jane", "Cohen", "David", "Levi",
        )

    def test_customer_tier_resolved_from_root_target(self, svc, seeded_phones):
        """customer_tier is a computed flat column — Phase DY pulled it
        out of the root target's extra_data on the JOIN path."""
        xlsx_bytes, _ = svc.export_phones(
            filters={},
            columns=[_col("phone_number"), _col("customer_tier", fmt="number")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        # Both phones on client 1 carry tier=1; the one on client 2 carries tier=2.
        rows_dict = {r[0]: r[1] for r in rows[1:]}
        assert rows_dict["+15550001111"] == 1
        assert rows_dict["+15550002222"] == 1
        assert rows_dict["+15550003333"] == 2


# ===========================================================================
# Filters
# ===========================================================================


class TestExportPhonesFilters:
    def test_verification_status_filter_narrows_rows(self, svc, seeded_phones):
        xlsx_bytes, _ = svc.export_phones(
            filters={"verification_status": "pending"},
            columns=[_col("phone_number")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 2   # 2 pending

    def test_client_id_filter(self, svc, seeded_phones):
        # client_id is the root entity's string id now; p3 hangs off the
        # second root, so filter by that root's id (p3.entity_id == e2.id).
        e2_id = seeded_phones[2].entity_id
        xlsx_bytes, _ = svc.export_phones(
            filters={"client_id": e2_id},
            columns=[_col("phone_number")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 1
        assert rows[1][0] == "+15550003333"

    def test_q_substring_search_against_phone_number(self, svc, seeded_phones):
        xlsx_bytes, _ = svc.export_phones(
            filters={"q": "2222"},
            columns=[_col("phone_number")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 1
        assert rows[1][0] == "+15550002222"

    def test_unknown_filter_keys_are_silently_ignored(self, svc, seeded_phones):
        # Forward-compatibility — adding a new filter on the client
        # shouldn't blow up older backends.
        xlsx_bytes, _ = svc.export_phones(
            filters={"future_filter_key": "anything"},
            columns=[_col("phone_number")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 3   # all rows returned


# ===========================================================================
# Empty result + row cap
# ===========================================================================


class TestEmptyAndCap:
    def test_zero_matching_rows_still_returns_workbook_with_header_and_metadata(
        self, svc, seeded_phones,
    ):
        """Empty filter result still produces a valid xlsx — operators
        sometimes want proof "I looked, nothing matched"."""
        xlsx_bytes, _ = svc.export_phones(
            filters={"verification_status": "no_such_status"},
            columns=[_col("phone_number", label="מספר טלפון")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        # Just the header.
        assert rows == [("מספר טלפון",)]
        # Metadata sheet records total=0.
        assert "export_metadata" in wb.sheetnames

    def test_row_cap_exceeded_raises_value_error(self, svc, session):
        """Bulk-seed past the cap and confirm we 422 before touching openpyxl."""
        from datetime import datetime, timezone
        from sqlalchemy import insert

        e = Entity(entity_type="target", client_id=1)
        session.add(e)
        session.flush()
        # Bulk insert — cheaper than ORM round-trips at this scale.
        # SQLAlchemy bulk-INSERT skips Python `default_factory`, so we
        # have to supply `ingested_at` (NOT NULL) explicitly.
        now = datetime.now(timezone.utc)
        session.execute(
            insert(PhoneNumber),
            [
                {
                    "entity_id":        e.id,
                    "phone_number":     f"+155500{i:05d}",
                    "ingestion_source": "manual",
                    "ingested_at":      now,
                    "created_at":       now,
                    "updated_at":       now,
                }
                for i in range(MAX_EXPORT_ROWS + 1)
            ],
        )
        session.commit()

        with pytest.raises(ValueError, match="Too many rows"):
            svc.export_phones(
                filters={},
                columns=[_col("phone_number")],
            )


# ===========================================================================
# Allowlist guard (the privacy gate)
# ===========================================================================


class TestAllowlistGuard:
    def test_disallowed_key_rejects_whole_request(self, svc, seeded_phones):
        with pytest.raises(ValueError, match="not allowed for export"):
            svc.export_phones(
                filters={},
                columns=[
                    _col("phone_number"),
                    _col("extra_data.api_key"),   # not on the allowlist
                ],
            )

    def test_unknown_flat_key_rejects(self, svc, seeded_phones):
        with pytest.raises(ValueError, match="not allowed for export"):
            svc.export_phones(
                filters={},
                columns=[_col("password")],
            )

    def test_every_default_allowlist_key_is_accepted(self, svc, seeded_phones):
        """Smoke test — building a request that uses every allowlisted
        key never raises. Cheap defense against typos in the allowlist
        constant."""
        cols = [_col(k) for k in ALLOWED_EXPORT_COLUMNS_PHONES]
        # Should not raise.
        xlsx_bytes, _ = svc.export_phones(filters={}, columns=cols)
        assert xlsx_bytes[:2] == b"PK"


# ===========================================================================
# Tasks export
# ===========================================================================


class TestExportTasks:
    def test_happy_path_via_task_service_seed(self, svc, session, seeded_target):
        task_svc = PipelineTaskService(storage=SqlStorage(session))
        task_svc.open_task(phone_id=seeded_target.id, task_type="a", requested_by="op")
        task_svc.open_task(phone_id=seeded_target.id, task_type="b", requested_by="op")

        xlsx_bytes, filename = svc.export_tasks(
            filters={},
            columns=[_col("task_type"), _col("status")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 2
        assert filename.startswith("tasks_")

    def test_q_search_matches_requested_by(self, svc, session, seeded_target):
        task_svc = PipelineTaskService(storage=SqlStorage(session))
        task_svc.open_task(phone_id=seeded_target.id, task_type="a", requested_by="alice")
        task_svc.open_task(phone_id=seeded_target.id, task_type="b", requested_by="bob")

        xlsx_bytes, _ = svc.export_tasks(
            filters={"q": "alice"},
            columns=[_col("task_type")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 1   # only alice's task

    def test_exclude_terminal_hides_resolved(self, svc, session, seeded_target):
        task_svc = PipelineTaskService(storage=SqlStorage(session))
        t1 = task_svc.open_task(phone_id=seeded_target.id, task_type="a", requested_by="op")
        task_svc.open_task(phone_id=seeded_target.id, task_type="b", requested_by="op")
        task_svc.resolve_task(task_id=t1.id, operator_id="adm", outcome="resolved")

        xlsx_bytes, _ = svc.export_tasks(
            filters={"exclude_terminal": True},
            columns=[_col("task_type")],
        )
        wb = _read_workbook(xlsx_bytes)
        rows = _data_rows(wb)
        assert len(rows) == 1 + 1   # only the still-pending row

    def test_task_allowlist_smoke(self, svc, session, seeded_target):
        task_svc = PipelineTaskService(storage=SqlStorage(session))
        task_svc.open_task(phone_id=seeded_target.id, task_type="a", requested_by="op")

        cols = [_col(k) for k in ALLOWED_EXPORT_COLUMNS_TASKS]
        xlsx_bytes, _ = svc.export_tasks(filters={}, columns=cols)
        assert xlsx_bytes[:2] == b"PK"


# ===========================================================================
# Filename hint sanitization
# ===========================================================================


class TestFilenameHint:
    def test_safe_chars_pass_through(self, svc, seeded_phones):
        _, filename = svc.export_phones(
            filters={}, columns=[_col("phone_number")],
            filename_hint="pending_audit",
        )
        assert "pending_audit" in filename

    def test_unsafe_chars_replaced_with_underscores(self, svc, seeded_phones):
        # Hebrew + spaces + slashes — typical operator paste. Header
        # injection (\r\n, etc.) would be deadly without sanitization.
        _, filename = svc.export_phones(
            filters={}, columns=[_col("phone_number")],
            filename_hint="לקוח/אלפא test",
        )
        # Hebrew + space + slash all become underscores. Leading/
        # trailing underscores stripped.
        assert "test" in filename
        assert "/" not in filename
        assert " " not in filename


# ===========================================================================
# Metadata sheet — audit fields land in the workbook
# ===========================================================================


class TestMetadataSheet:
    def test_metadata_sheet_records_applied_filters_and_uuid(self, svc, seeded_phones):
        xlsx_bytes, _ = svc.export_phones(
            filters={"client_id": 1, "verification_status": "pending"},
            columns=[_col("phone_number")],
        )
        wb = _read_workbook(xlsx_bytes)
        meta = wb["export_metadata"]
        rows_flat = [tuple(c.value for c in row) for row in meta.iter_rows()]
        # bulk_export_id row is present.
        keys = {r[0] for r in rows_flat}
        assert "bulk_export_id" in keys
        assert "total_rows" in keys
        assert "exported_at_utc" in keys
        # Applied filters listed (with the 2-space-indent convention).
        assert any("client_id" in str(r[0]) for r in rows_flat)
        assert any("verification_status" in str(r[0]) for r in rows_flat)
