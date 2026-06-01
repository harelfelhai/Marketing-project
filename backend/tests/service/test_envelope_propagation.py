"""
DY-4-D propagation rules — envelope (Vector B) two-axis collapse.

For social_envelope entities, the phone-in-network and person-to-target
axes are tied together because the entity is just a placeholder for
"whoever owns this phone in the target's network". The service applies
these implications automatically; this suite pins the rules so the
matrix doesn't drift.
"""

import pytest

from models.entity import Entity
from models.phone_number import PhoneNumber
from modules.mock_scoring import ScoringStrategy
from services.scoring import ScoringService
from services.verification import VerificationService
from repositories.storage import SqlStorage


@pytest.fixture()
def verification(session):
    scoring = ScoringService(storage=SqlStorage(session), strategy=ScoringStrategy())
    return VerificationService(session=session, scoring_service=scoring)


def _seed_envelope(session, client_id=1, confidence=50.0, verification_status="pending"):
    """Seed a primary target + social_envelope entity + its phone."""
    root = Entity(
        entity_type="target", relation_type="primary",
        client_id=client_id, extra_data={"customer_tier": 1},
    )
    session.add(root); session.flush()
    envelope = Entity(
        entity_type="social_envelope", relation_type="associated",
        target_entity_id=root.id, client_id=client_id,
        extra_data={"envelope_id": f"EP-{client_id:03d}"},
    )
    session.add(envelope); session.flush()
    phone = PhoneNumber(
        entity_id=envelope.id,
        phone_number=f"+1555000{client_id:04d}",
        ingestion_source="automated",
        confidence_score=confidence,
        verification_status=verification_status,
    )
    session.add(phone); session.commit(); session.refresh(phone)
    return phone, envelope, root


# ===========================================================================
# Phone axis propagation on envelopes
# ===========================================================================


class TestPhoneAxisEnvelopePropagation:
    def test_confirm_on_envelope_writes_both_axes(self, session, verification):
        """phone_axis=confirm on social_envelope: confidence AND verification_status."""
        phone, envelope, _ = _seed_envelope(session)
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            phone_axis="confirm",
        )
        assert result.confidence_score == 100.0
        # DY-4-D propagation:
        assert result.verification_status == "verified_good"
        assert result.verification_source == "manual"
        assert result.verified_at is not None
        # target_entity_id still points at target (envelope verified, not refuted).
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.target_entity_id is not None
        assert e.entity_type == "social_envelope"  # identity not yet known

    def test_refute_on_envelope_writes_both_axes_and_severs(self, session, verification):
        phone, envelope, _ = _seed_envelope(session)
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            phone_axis="refute",
        )
        assert result.confidence_score == 0.0
        assert result.verification_status == "verified_bad"
        assert result.verified_at is not None
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.target_entity_id is None  # severed
        assert e.entity_type == "social_envelope"  # unchanged

    def test_confirm_on_named_entity_does_not_propagate(self, session, verification, seeded_target):
        """Vector A (non-envelope): axes stay independent."""
        result = verification.apply_two_axis_verdict(
            phone_id=seeded_target.id,
            phone_axis="confirm",
        )
        assert result.confidence_score == 100.0
        # Phase 3 status untouched — no propagation for Vector A.
        assert result.verification_status == "pending"


# ===========================================================================
# Identification propagation
# ===========================================================================


class TestIdentificationPropagation:
    def test_full_identification_writes_verified_good(self, session, verification):
        """relation='spouse' implies person-to-target is confirmed."""
        phone, envelope, _ = _seed_envelope(session)
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            identification={"first_name": "Mary", "relation": "spouse"},
        )
        assert result.verification_status == "verified_good"
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "spouse"
        assert e.target_entity_id is not None  # relation intact

    def test_identification_with_unrelated_writes_verified_bad_and_severs(
        self, session, verification
    ):
        """relation='unrelated' is the identify-path for Failure Type I."""
        phone, envelope, _ = _seed_envelope(session)
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            identification={"first_name": "John", "relation": "unrelated"},
        )
        assert result.verification_status == "verified_bad"
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "unrelated"
        assert e.target_entity_id is None

    def test_partial_identify_propagates_when_envelope_previously_confirmed(
        self, session, verification
    ):
        """The user's specific scenario:
            envelope confidence already 100 (operator confirmed earlier);
            partial identify (name only, no relation);
            verification_status SHOULD propagate to verified_good.
        """
        phone, envelope, _ = _seed_envelope(
            session, confidence=100.0, verification_status="verified_good",
        )
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            identification={"first_name": "Mary"},  # no relation
        )
        assert result.verification_status == "verified_good"
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "identified_envelope"
        assert e.extra_data["first_name"] == "Mary"

    def test_partial_identify_does_not_propagate_when_envelope_not_confirmed(
        self, session, verification
    ):
        """Conservative case: operator named someone without auditing the envelope.
        Relation-to-target stays pending — naming alone is not a verdict."""
        phone, envelope, _ = _seed_envelope(session, confidence=50.0)  # baseline
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            identification={"first_name": "John"},
        )
        # verification_status remains pending (not propagated).
        assert result.verification_status == "pending"
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "identified_envelope"

    def test_phone_confirm_and_partial_identify_in_one_submit(
        self, session, verification
    ):
        """Combined: operator confirms envelope AND names the owner partially.
        confidence_score check happens AFTER the same submit's phone_axis writes,
        so propagation applies."""
        phone, envelope, _ = _seed_envelope(session, confidence=50.0)
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            phone_axis="confirm",
            identification={"first_name": "Anna"},
        )
        assert result.confidence_score == 100.0
        assert result.verification_status == "verified_good"
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "identified_envelope"
        assert e.extra_data["first_name"] == "Anna"
