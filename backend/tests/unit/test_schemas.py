"""Unit tests for Pydantic data contracts."""

import pytest
from pydantic import ValidationError

from app.schemas.api_contracts import (
    OpenTaskRequest,
    ResolveTaskRequest,
    BulkResolveTaskRequest,
    VerificationVerdictRequest,
    BulkTextIngestRequest,
)


# ===========================================================================
# OpenTaskRequest
# ===========================================================================


class TestOpenTaskRequest:
    def test_minimal_valid(self):
        r = OpenTaskRequest(
            phone_id="ph-1",
            task_type="review",
        )
        assert r.phone_id == "ph-1"
        assert r.task_type == "review"
        assert r.extra_data is None

    def test_full_payload(self):
        r = OpenTaskRequest(
            phone_id="ph-1",
            task_type="approval_required",
            extra_data={"requested_action_type": "action_type_a"},
        )
        assert r.extra_data == {"requested_action_type": "action_type_a"}

    @pytest.mark.parametrize("missing", ["phone_id", "task_type"])
    def test_required_field_missing_raises(self, missing):
        kwargs = dict(phone_id="ph-1", task_type="x")
        kwargs.pop(missing)
        with pytest.raises(ValidationError):
            OpenTaskRequest(**kwargs)

    @pytest.mark.parametrize("field", ["task_type"])
    def test_empty_string_rejected(self, field):
        kwargs = dict(phone_id="ph-1", task_type="x")
        kwargs[field] = ""
        with pytest.raises(ValidationError):
            OpenTaskRequest(**kwargs)


# ===========================================================================
# ResolveTaskRequest
# ===========================================================================


class TestResolveTaskRequest:
    def test_done_outcome(self):
        r = ResolveTaskRequest(outcome="done")
        assert r.outcome == "done"
        assert r.resolution_note is None

    def test_rejected_outcome_with_note(self):
        r = ResolveTaskRequest(
            outcome="rejected",
            resolution_note="Carrier intercept is permanent.",
        )
        assert r.outcome == "rejected"
        assert r.resolution_note == "Carrier intercept is permanent."

    @pytest.mark.parametrize("bad_outcome", ["pending", "resolved", "DONE", "", "approved"])
    def test_invalid_outcome_rejected(self, bad_outcome):
        with pytest.raises(ValidationError):
            ResolveTaskRequest(outcome=bad_outcome)


# ===========================================================================
# BulkResolveTaskRequest
# ===========================================================================


class TestBulkResolveTaskRequest:
    def test_minimal_valid(self):
        r = BulkResolveTaskRequest(task_ids=["t-1", "t-2"], outcome="done")
        assert len(r.task_ids) == 2
        assert r.resolution_note is None

    def test_empty_task_ids_rejected(self):
        with pytest.raises(ValidationError):
            BulkResolveTaskRequest(task_ids=[], outcome="done")

    def test_invalid_outcome_rejected(self):
        with pytest.raises(ValidationError):
            BulkResolveTaskRequest(task_ids=["t-1"], outcome="pending")


# ===========================================================================
# VerificationVerdictRequest
# ===========================================================================


class TestVerificationVerdictRequest:
    def test_minimal_valid(self):
        v = VerificationVerdictRequest(phone_id="ph-1", status="verified")
        assert v.phone_id == "ph-1"
        assert v.status == "verified"
        assert v.extra_data is None

    def test_full_payload(self):
        v = VerificationVerdictRequest(
            phone_id="ph-1",
            status="rejected",
            extra_data={"carrier": "unknown"},
        )
        assert v.extra_data == {"carrier": "unknown"}

    def test_missing_phone_id_raises(self):
        with pytest.raises(ValidationError):
            VerificationVerdictRequest(status="verified")

    def test_missing_status_raises(self):
        with pytest.raises(ValidationError):
            VerificationVerdictRequest(phone_id="ph-1")


# ===========================================================================
# BulkTextIngestRequest
# ===========================================================================


class TestBulkTextIngestRequest:
    def test_minimal_valid(self):
        r = BulkTextIngestRequest(
            phone_numbers_raw="+14155551111\n+14155551112",
            entity_id="ent-001",
            ingestion_source="manual",
        )
        assert r.entity_id == "ent-001"
        assert r.phone_type is None
        assert r.extra_shared is None

    def test_empty_phone_numbers_raises(self):
        with pytest.raises(ValidationError):
            BulkTextIngestRequest(
                phone_numbers_raw="",
                entity_id="ent-001",
                ingestion_source="manual",
            )

    @pytest.mark.parametrize("missing", ["phone_numbers_raw", "entity_id", "ingestion_source"])
    def test_required_field_missing_raises(self, missing):
        kwargs = dict(
            phone_numbers_raw="+14155551111",
            entity_id="ent-001",
            ingestion_source="manual",
        )
        kwargs.pop(missing)
        with pytest.raises(ValidationError):
            BulkTextIngestRequest(**kwargs)
