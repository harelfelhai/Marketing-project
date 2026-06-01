"""Service-layer tests for VerificationService."""

import pytest

from exceptions import PhoneNumberNotFoundError
from services.verification import VerificationService
from repositories.storage import SqlStorage


class TestUpdateVerdict:
    def test_writes_all_phase3_fields(self, session, seeded_target):
        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.update_verification_verdict(
            phone_id=seeded_target.id,
            status="verified_good",
            source="automated",
            reason="passed checks",
        )
        assert updated.verification_status == "verified_good"
        assert updated.verification_source == "automated"
        assert updated.verification_reason == "passed checks"
        assert updated.verified_at is not None

    def test_metadata_merge_preserves_existing_extra_data(self, session, seeded_target):
        # Pre-seed Phase 1 metadata in extra_data.
        seeded_target.extra_data = {"phase1": "preserved"}
        session.add(seeded_target)
        session.commit()

        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.update_verification_verdict(
            phone_id=seeded_target.id,
            status="verified_good",
            source="automated",
            reason="ok",
            extra_metadata={"verification": {"score": 0.9}},
        )
        # Both keys should coexist — merge, not overwrite.
        assert updated.extra_data["phase1"] == "preserved"
        assert updated.extra_data["verification"] == {"score": 0.9}

    def test_none_metadata_does_not_mutate_extra_data(self, session, seeded_target):
        seeded_target.extra_data = {"untouched": True}
        session.add(seeded_target)
        session.commit()

        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.update_verification_verdict(
            phone_id=seeded_target.id,
            status="verified_good",
            source="manual",
            reason="ok",
            extra_metadata=None,
        )
        assert updated.extra_data == {"untouched": True}

    def test_missing_phone_raises(self, session):
        svc = VerificationService(storage=SqlStorage(session))
        with pytest.raises(PhoneNumberNotFoundError):
            svc.update_verification_verdict(
                phone_id=99999,
                status="verified_good",
                source="automated",
                reason="x",
            )
