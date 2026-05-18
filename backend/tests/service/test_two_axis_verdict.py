"""
Service-layer tests for VerificationService.apply_two_axis_verdict (DY-4-C).

Covers every documented submission shape from the spec:
    - phone_axis only      (Failure Type II: dead line, relation intact)
    - relation_axis only   (Failure Type I: valid line, no relation)
    - identification only  (envelope → identified, no axis feedback)
    - combined             (axis + axis, axis + identification)
    - empty submission     (raises ValueError)

Plus the atomicity guarantee: scoring runs in the same transaction as
the axis writes, and any failure rolls back ALL writes.
"""

import math
from datetime import timezone

import pytest

from exceptions import PhoneNumberNotFoundError
from models.entity import Entity
from models.phone_number import PhoneNumber
from modules.mock_scoring import ScoringStrategy
from services.scoring import ScoringService
from services.verification import VerificationService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def scoring(session):
    return ScoringService(session=session, strategy=ScoringStrategy())


@pytest.fixture()
def verification(session, scoring):
    return VerificationService(session=session, scoring_service=scoring)


@pytest.fixture()
def named_phone(session):
    """A Vector A phone: named entity with target_entity_id intact."""
    root = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=1,
        extra_data={"customer_tier": 1},
    )
    session.add(root); session.flush()
    associated = Entity(
        entity_type="family",
        relation_type="associated",
        target_entity_id=root.id,
        client_id=1,
    )
    session.add(associated); session.flush()
    phone = PhoneNumber(
        entity_id=associated.id,
        phone_number="+15550000800",
        ingestion_source="manual",
        confidence_score=60.0,
    )
    session.add(phone); session.commit(); session.refresh(phone)
    return phone


@pytest.fixture()
def envelope_phone(session):
    """A Vector B phone: social_envelope entity pointing at a primary."""
    root = Entity(
        entity_type="target",
        relation_type="primary",
        client_id=2,
        extra_data={"customer_tier": 2},
    )
    session.add(root); session.flush()
    envelope = Entity(
        entity_type="social_envelope",
        relation_type="associated",
        target_entity_id=root.id,
        client_id=2,
        extra_data={"envelope_id": "EP-T001"},
    )
    session.add(envelope); session.flush()
    phone = PhoneNumber(
        entity_id=envelope.id,
        phone_number="+15550000801",
        ingestion_source="automated",
        confidence_score=50.0,
    )
    session.add(phone); session.commit(); session.refresh(phone)
    return phone, envelope, root


# ===========================================================================
# Empty submission
# ===========================================================================


class TestEmptySubmission:
    def test_empty_raises_value_error(self, verification, named_phone):
        with pytest.raises(ValueError, match="at least one"):
            verification.apply_two_axis_verdict(phone_id=named_phone.id)


# ===========================================================================
# Phone axis only — Failure Type II
# ===========================================================================


class TestPhoneAxisOnly:
    def test_confirm_sets_confidence_to_100(self, session, verification, named_phone):
        result = verification.apply_two_axis_verdict(
            phone_id=named_phone.id,
            phone_axis="confirm",
        )
        assert result.confidence_score == 100.0
        assert result.confidence_updated_at is not None
        # Relation untouched.
        assert result.verification_status == "pending"
        # Owning entity's target_entity_id unchanged.
        entity = session.get(Entity, named_phone.entity_id)
        assert entity.target_entity_id is not None

    def test_refute_sets_confidence_to_0(self, verification, named_phone):
        result = verification.apply_two_axis_verdict(
            phone_id=named_phone.id,
            phone_axis="refute",
        )
        assert result.confidence_score == 0.0
        # Priority should drop (low confidence × any weight = low).
        assert result.priority_score == 0.0


# ===========================================================================
# Relation axis only — Failure Type I
# ===========================================================================


class TestRelationAxisOnly:
    def test_confirm_writes_verified_good(self, verification, named_phone):
        result = verification.apply_two_axis_verdict(
            phone_id=named_phone.id,
            relation_axis="confirm",
            resolution_note="Operator confirmed family relation",
        )
        assert result.verification_status == "verified_good"
        assert result.verification_source == "manual"
        assert "Operator confirmed family relation" in result.verification_reason
        # Confidence untouched (no phone axis given).
        assert result.confidence_score == 60.0

    def test_refute_severs_target_entity_id(self, session, verification, named_phone):
        result = verification.apply_two_axis_verdict(
            phone_id=named_phone.id,
            relation_axis="refute",
            resolution_note="Wrong person — no connection",
        )
        assert result.verification_status == "verified_bad"
        # Owning entity's target_entity_id severed.
        entity = session.get(Entity, named_phone.entity_id)
        assert entity.target_entity_id is None

    def test_default_reason_when_no_note(self, verification, named_phone):
        result = verification.apply_two_axis_verdict(
            phone_id=named_phone.id,
            relation_axis="confirm",
        )
        assert result.verification_reason  # not empty


# ===========================================================================
# Combined — Failure Type I shape (phone valid, no relation)
# ===========================================================================


class TestCombinedAxes:
    def test_failure_type_I_full_shape(self, session, verification, envelope_phone):
        """
        The classic Vector B failure: phone is real and reaches a real
        person, but that person has no connection to the target.
            phone_axis='confirm'   → confidence_score = 100
            relation_axis='refute' → target_entity_id severed,
                                       verification_status='verified_bad'
        """
        phone, envelope, _root = envelope_phone
        result = verification.apply_two_axis_verdict(
            phone_id=phone.id,
            phone_axis="confirm",
            relation_axis="refute",
            resolution_note="Phone valid; owner unrelated to target",
        )
        assert result.confidence_score == 100.0
        assert result.verification_status == "verified_bad"
        # priority drops to 0 because relation severed AND we picked
        # 'unknown' relation_weight for severed envelope. With the mock
        # strategy: confidence 100 × (0.6 * 0.5 + 0.4 * 0.7) → ~58.0.
        # Confirm priority isn't 0 — the phone-asset value is preserved
        # per spec ("validated phone-to-entity match is preserved as
        # clean asset data").
        assert result.priority_score > 0
        # Entity FK severed.
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.target_entity_id is None


# ===========================================================================
# Identification — envelope → named / identified_envelope
# ===========================================================================


class TestIdentification:
    def test_full_identification_promotes_to_relation(
        self, session, verification, envelope_phone
    ):
        phone, envelope, _ = envelope_phone
        verification.apply_two_axis_verdict(
            phone_id=phone.id,
            identification={
                "first_name": "Mary",
                "last_name":  "Smith",
                "relation":   "spouse",
            },
        )
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "spouse"
        assert e.extra_data.get("first_name") == "Mary"
        assert e.extra_data.get("last_name")  == "Smith"
        # envelope_id from the original extra_data is preserved (merge).
        assert e.extra_data.get("envelope_id") == "EP-T001"

    def test_partial_identification_holds_at_identified_envelope(
        self, session, verification, envelope_phone
    ):
        """The user's "name without relation" partial-identify state."""
        phone, envelope, _ = envelope_phone
        verification.apply_two_axis_verdict(
            phone_id=phone.id,
            identification={
                "first_name": "John",
                "last_name":  "Doe",
                # relation omitted
            },
        )
        session.expire_all()
        e = session.get(Entity, envelope.id)
        assert e.entity_type == "identified_envelope"
        assert e.extra_data.get("first_name") == "John"

    def test_identification_on_named_entity_is_no_op(
        self, session, verification, named_phone
    ):
        """Identification block applies only to social_envelope entities."""
        original_entity = session.get(Entity, named_phone.entity_id)
        original_type   = original_entity.entity_type   # 'family'

        verification.apply_two_axis_verdict(
            phone_id=named_phone.id,
            identification={"first_name": "X", "last_name": "Y", "relation": "friend"},
        )
        session.expire_all()
        e = session.get(Entity, named_phone.entity_id)
        # entity_type unchanged — identification block only mutates
        # entities currently sitting at 'social_envelope'.
        assert e.entity_type == original_type


# ===========================================================================
# Error paths + atomicity
# ===========================================================================


class TestErrorPaths:
    def test_unknown_phone_id_raises(self, verification):
        with pytest.raises(PhoneNumberNotFoundError):
            verification.apply_two_axis_verdict(
                phone_id=99999,
                phone_axis="confirm",
            )

    def test_scoring_failure_rolls_back_all_writes(self, session, named_phone):
        """
        If the scoring strategy raises mid-verdict, the entire transaction
        rolls back — confidence, status, target_entity_id all untouched.
        """
        from interfaces.scoring import BaseScoringStrategy

        class ExplodingStrategy(BaseScoringStrategy):
            def compute_priority(self, confidence_score, relation_type, customer_tier):
                raise RuntimeError("simulated scoring failure")

        scoring = ScoringService(session=session, strategy=ExplodingStrategy())
        vs = VerificationService(session=session, scoring_service=scoring)

        original_confidence = named_phone.confidence_score
        with pytest.raises(RuntimeError):
            vs.apply_two_axis_verdict(
                phone_id=named_phone.id,
                phone_axis="confirm",
                relation_axis="refute",
            )
        session.rollback()
        session.expire_all()
        refreshed = session.get(PhoneNumber, named_phone.id)
        assert refreshed.confidence_score == original_confidence
        assert refreshed.verification_status == "pending"
        entity = session.get(Entity, named_phone.entity_id)
        assert entity.target_entity_id is not None
