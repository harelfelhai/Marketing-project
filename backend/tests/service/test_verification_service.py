"""Service-layer tests for VerificationService."""

import pytest

from exceptions import PhoneNumberNotFoundError
from models.types import not_deleted
from services.verification import VerificationService
from repositories.storage import SqlStorage


class TestApplyVerdict:
    def test_writes_verification_status(self, session, seeded_target):
        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.apply_verdict(
            phone_id=seeded_target.id,
            status="verified",
            extra_data={},
        )
        assert updated.verification_status == "verified"

    def test_rejected_status(self, session, seeded_target):
        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.apply_verdict(
            phone_id=seeded_target.id,
            status="rejected",
            extra_data={},
        )
        assert updated.verification_status == "rejected"

    def test_metadata_merge_preserves_existing_extra_data(self, session, seeded_target):
        # Pre-seed metadata in extra_data.
        seeded_target.extra_data = {"phase1": "preserved"}
        session.add(seeded_target)
        session.commit()

        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.apply_verdict(
            phone_id=seeded_target.id,
            status="verified",
            extra_data={"verification": {"score": 0.9}},
        )
        # Both keys should coexist — merge, not overwrite.
        assert updated.extra_data["phase1"] == "preserved"
        assert updated.extra_data["verification"] == {"score": 0.9}

    def test_none_extra_data_does_not_mutate_existing(self, session, seeded_target):
        seeded_target.extra_data = {"untouched": True}
        session.add(seeded_target)
        session.commit()

        svc = VerificationService(storage=SqlStorage(session))
        updated = svc.apply_verdict(
            phone_id=seeded_target.id,
            status="verified",
            extra_data=None,
        )
        assert updated.extra_data == {"untouched": True}

    def test_invalid_status_raises(self, session, seeded_target):
        svc = VerificationService(storage=SqlStorage(session))
        with pytest.raises(ValueError):
            svc.apply_verdict(
                phone_id=seeded_target.id,
                status="invalid_status",
                extra_data={},
            )

    def test_missing_phone_raises(self, session):
        svc = VerificationService(storage=SqlStorage(session))
        with pytest.raises(PhoneNumberNotFoundError):
            svc.apply_verdict(
                phone_id="ph-nonexistent",
                status="verified",
                extra_data={},
            )
