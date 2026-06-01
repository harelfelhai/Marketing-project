"""Service-layer tests for IngestionService."""

import pytest
from sqlmodel import Session, select

from exceptions import TargetNotFoundError
from models.action_log import ActionLog
from models.entity import Entity
from models.phone_number import PhoneNumber
from schemas.ingestion import IngestionPayload
from services.dispatcher import ActionDispatcher
from services.ingestion import IngestionService

from tests.conftest import RecordingHandler
from repositories.storage import SqlStorage


def _build_service(session, routing_engine, handler=None):
    dispatcher = ActionDispatcher(
        storage=SqlStorage(session),
        handlers={},
        default_handler=handler or RecordingHandler(),
        max_retry_count=3,
        retry_backoff_seconds=60,
    )
    return IngestionService(
        storage=SqlStorage(session), routing_engine=routing_engine, dispatcher=dispatcher,
    )


class TestHappyPath:
    def test_creates_entity_and_phone(self, session, seeded_target, routing_engine_none):
        svc = _build_service(session, routing_engine_none)
        payload = IngestionPayload(
            phone_number="+15552222222",
            entity_type="family",
            target_phone_number=seeded_target.phone_number,
            ingestion_source="automated",
            ingestion_reason="strong tie",
        )
        result = svc.ingest_circle_member(payload)
        assert result.id is not None
        assert result.phone_number == "+15552222222"
        assert result.ingestion_source == "automated"
        assert result.verification_status == "pending"

        # New Entity row exists with target_entity_id pointing at the target.
        new_entity = session.get(Entity, result.entity_id)
        assert new_entity.entity_type == "family"
        assert new_entity.target_entity_id == seeded_target.entity_id

    def test_no_action_log_when_routing_returns_none(
        self, session, seeded_target, routing_engine_none
    ):
        svc = _build_service(session, routing_engine_none)
        result = svc.ingest_circle_member(IngestionPayload(
            phone_number="+15552222222",
            entity_type="family",
            target_phone_number=seeded_target.phone_number,
            ingestion_source="manual",
        ))
        logs = session.exec(select(ActionLog).where(ActionLog.phone_id == result.id)).all()
        assert len(logs) == 0

    def test_action_log_created_when_routing_returns_token(
        self, session, seeded_target, routing_engine_with_token, recording_handler
    ):
        svc = _build_service(session, routing_engine_with_token, handler=recording_handler)
        result = svc.ingest_circle_member(IngestionPayload(
            phone_number="+15552222222",
            entity_type="family",
            target_phone_number=seeded_target.phone_number,
            ingestion_source="manual",
        ))
        logs = session.exec(select(ActionLog).where(ActionLog.phone_id == result.id)).all()
        assert len(logs) == 1
        assert logs[0].action_type == "test_action"
        assert logs[0].status == "sent"
        # The handler was invoked.
        assert len(recording_handler.calls) == 1
        assert recording_handler.calls[0][0] == "+15552222222"

    def test_extras_passed_through_opaquely(
        self, session, seeded_target, routing_engine_none
    ):
        svc = _build_service(session, routing_engine_none)
        result = svc.ingest_circle_member(IngestionPayload(
            phone_number="+15552222222",
            entity_type="family",
            target_phone_number=seeded_target.phone_number,
            ingestion_source="manual",
            entity_extra={"secret": "personal"},
            phone_extra={"secret": "phone-meta"},
        ))
        new_entity = session.get(Entity, result.entity_id)
        assert new_entity.extra_data == {"secret": "personal"}
        assert result.extra_data == {"secret": "phone-meta"}


class TestFailureCases:
    def test_target_not_found_raises(self, session, routing_engine_none):
        svc = _build_service(session, routing_engine_none)
        with pytest.raises(TargetNotFoundError) as exc_info:
            svc.ingest_circle_member(IngestionPayload(
                phone_number="+15552222222",
                entity_type="family",
                target_phone_number="+19990000000",  # not seeded
                ingestion_source="manual",
            ))
        assert exc_info.value.target_phone_number == "+19990000000"

    def test_target_not_found_does_not_create_entity(
        self, session, routing_engine_none
    ):
        svc = _build_service(session, routing_engine_none)
        before = session.exec(select(Entity)).all()
        with pytest.raises(TargetNotFoundError):
            svc.ingest_circle_member(IngestionPayload(
                phone_number="+15552222222",
                entity_type="family",
                target_phone_number="+19990000000",
                ingestion_source="manual",
            ))
        after = session.exec(select(Entity)).all()
        assert len(before) == len(after)
