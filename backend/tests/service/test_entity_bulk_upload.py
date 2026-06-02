"""
Service-layer tests for EntityIngestionService create_single and ingest_bulk_text.

Note: The separate ingest_bulk_upload and generate_template_xlsx methods have
been removed from EntityIngestionService. Bulk upload for entities goes through
the BulkIngestionService (phones) or the bulk-text path (entities).

This file covers the bulk-text path using xlsx-based input via the grid
endpoint, which the service handles through ingest_bulk_text.
"""

import pytest

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.types import not_deleted
from services.entity_ingestion import EntityIngestionService
from repositories.storage import SqlStorage


@pytest.fixture()
def svc(session):
    return EntityIngestionService(storage=SqlStorage(session))


@pytest.fixture()
def root_target(session):
    e = Entity(
        relation_type="primary",
        target_entity_id=None,
        full_name="Root",
        deleted_at=not_deleted(),
    )
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


class TestBulkTextEdgeCases:
    """Additional edge cases for EntityIngestionService.ingest_bulk_text."""

    def test_duplicate_names_across_rows_do_not_dedup(self, svc, root_target):
        """Unlike phones, entities with same names are both valid."""
        summary = svc.ingest_bulk_text(
            rows=[
                {"row_token": "Jane Doe (1)", "full_name": "Jane Doe"},
                {"row_token": "Jane Doe (2)", "full_name": "Jane Doe"},
            ],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 2
        assert summary["failed_count"] == 0

    def test_identifier_fields_stored(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[{
                "row_token": "Jane",
                "full_name": "Jane",
                "identifier_1": "ID-001",
                "identifier_2": "ID-002",
            }],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 1
        ent = session.get(Entity, summary["entity_ids"][0])
        assert ent.identifier_1 == "ID-001"
        assert ent.identifier_2 == "ID-002"

    def test_audit_id_stamped(self, svc, root_target, session):
        summary = svc.ingest_bulk_text(
            rows=[{"row_token": "Jane", "full_name": "Jane"}],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        ent = session.get(Entity, summary["entity_ids"][0])
        assert ent.extra_data["bulk_submission_id"] == summary["bulk_submission_id"]

    def test_missing_default_target_raises_not_row_failure(self, svc):
        with pytest.raises(TargetNotFoundError):
            svc.ingest_bulk_text(
                rows=[{"row_token": "a"}],
                default_relation_type="family",
                default_target_entity_id="nonexistent",
            )

    def test_empty_rows_returns_clean_summary(self, svc, root_target):
        summary = svc.ingest_bulk_text(
            rows=[],
            default_relation_type="family",
            default_target_entity_id=root_target.id,
        )
        assert summary["success_count"] == 0
        assert summary["failed_count"] == 0
        assert summary["entity_ids"] == []
        assert summary["bulk_submission_id"]
