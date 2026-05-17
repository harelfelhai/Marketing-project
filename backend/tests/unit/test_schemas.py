"""Unit tests for Pydantic data contracts."""

import pytest
from pydantic import ValidationError

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
