"""Unit tests for Pydantic data contracts."""

import pytest
from pydantic import ValidationError

from app.schemas.api_contracts import OpenTaskRequest, ResolveTaskRequest
from schemas.ingestion import IngestionPayload
from schemas.verification import VerificationVerdict


class TestIngestionPayload:
    def test_minimal_valid_payload(self):
        p = IngestionPayload(
            phone_number="+15551234567",
            entity_type="family",
            target_phone_number="+15550000001",
            ingestion_source="manual",
        )
        assert p.phone_number == "+15551234567"
        assert p.ingestion_reason is None
        assert p.entity_extra is None
        assert p.phone_extra is None

    def test_full_payload_with_extras(self):
        p = IngestionPayload(
            phone_number="+15551234567",
            entity_type="friend",
            target_phone_number="+15550000001",
            ingestion_source="automated",
            ingestion_reason="strong tie",
            entity_extra={"opaque": "personal"},
            phone_extra={"opaque": "metadata"},
        )
        assert p.entity_extra == {"opaque": "personal"}
        assert p.phone_extra == {"opaque": "metadata"}

    @pytest.mark.parametrize("missing_field", [
        "phone_number", "entity_type", "target_phone_number", "ingestion_source"
    ])
    def test_required_field_missing_raises(self, missing_field):
        kwargs = {
            "phone_number": "+15551234567",
            "entity_type": "family",
            "target_phone_number": "+15550000001",
            "ingestion_source": "manual",
        }
        kwargs.pop(missing_field)
        with pytest.raises(ValidationError):
            IngestionPayload(**kwargs)


class TestVerificationVerdict:
    def test_minimal_verdict(self):
        v = VerificationVerdict(status="verified_good", reason="ok")
        assert v.status == "verified_good"
        assert v.metadata == {}

    def test_full_verdict(self):
        v = VerificationVerdict(
            status="verified_bad",
            reason="multiple failures",
            metadata={"score": 0.1},
        )
        assert v.metadata == {"score": 0.1}

    def test_missing_required_raises(self):
        with pytest.raises(ValidationError):
            VerificationVerdict(status="verified_good")  # missing reason


# ===========================================================================
# Phase DX — OperationsQueue request bodies
# ===========================================================================


class TestOpenTaskRequest:
    def test_minimal_valid(self):
        r = OpenTaskRequest(
            phone_id=1,
            task_type="remediation_failure",
            requested_by="automation:retry_engine",
        )
        assert r.source_action_log_id is None
        assert r.extra_data is None

    def test_full_payload(self):
        r = OpenTaskRequest(
            phone_id=1,
            task_type="approval_required",
            requested_by="mock_operator_02",
            source_action_log_id=42,
            extra_data={"requested_action_type": "action_type_a"},
        )
        assert r.source_action_log_id == 42
        assert r.extra_data == {"requested_action_type": "action_type_a"}

    # Phase AUTH-B: requested_by is now OPTIONAL on this schema.
    # Logged-in operators get `current_user.username` stamped server-
    # side; automation (no session) still passes requested_by in the
    # body. So the required-field set on the SCHEMA shrinks to two.
    @pytest.mark.parametrize("missing", ["phone_id", "task_type"])
    def test_required_field_missing_raises(self, missing):
        kwargs = dict(phone_id=1, task_type="x", requested_by="op")
        kwargs.pop(missing)
        with pytest.raises(ValidationError):
            OpenTaskRequest(**kwargs)

    def test_requested_by_now_optional_phase_authb(self):
        # No longer raises — the endpoint reads from current_user when
        # the caller is logged in. The schema still accepts a body
        # value (used by anonymous automation callers).
        r = OpenTaskRequest(phone_id=1, task_type="x")
        assert r.requested_by is None

    @pytest.mark.parametrize("field", ["task_type"])
    def test_empty_string_rejected(self, field):
        kwargs = dict(phone_id=1, task_type="x", requested_by="op")
        kwargs[field] = ""
        with pytest.raises(ValidationError):
            OpenTaskRequest(**kwargs)


class TestResolveTaskRequest:
    # Phase AUTH-B: operator_id removed from the body. The endpoint
    # reads from `require_admin`. Schema only carries outcome +
    # resolution_note now.
    def test_resolved_outcome(self):
        r = ResolveTaskRequest(outcome="resolved")
        assert r.resolution_note is None

    def test_rejected_outcome_with_note(self):
        r = ResolveTaskRequest(
            outcome="rejected",
            resolution_note="Carrier intercept is permanent.",
        )
        assert r.outcome == "rejected"
        assert r.resolution_note == "Carrier intercept is permanent."

    @pytest.mark.parametrize("bad_outcome", ["pending", "assigned", "RESOLVED", "", "approved"])
    def test_invalid_outcome_rejected(self, bad_outcome):
        with pytest.raises(ValidationError):
            ResolveTaskRequest(outcome=bad_outcome)
