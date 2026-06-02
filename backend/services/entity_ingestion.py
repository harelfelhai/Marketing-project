"""
services/entity_ingestion.py — Entity-centric ingestion service.

Creates Entity rows standalone (no phone), using the new simplified schema:
identifier_1, identifier_2, full_name, relation_type, target_entity_id, extra_data.
"""

import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError

from exceptions import TargetNotFoundError
from models.entity import Entity
from models.types import SOFT_DELETE_SENTINEL, not_deleted


BULK_ENTITY_REQUIRED_COLUMNS = (
    "relation_type",
    "target_entity_id",
)
BULK_ENTITY_OPTIONAL_COLUMNS = (
    "full_name",
    "identifier_1",
    "identifier_2",
)
BULK_ENTITY_ALL_COLUMNS = BULK_ENTITY_REQUIRED_COLUMNS + BULK_ENTITY_OPTIONAL_COLUMNS

BULK_ENTITY_MAX_ROWS = 5_000
_FAILURE_INPUT_CAP = 200


class EntityIngestionService:
    """Writer for the entity-centric ingestion path."""

    def __init__(self, storage) -> None:
        self.entities = storage.entities

    def create_single(
        self,
        *,
        relation_type: str,
        target_entity_id: Optional[str] = None,
        identifier_1: Optional[str] = None,
        identifier_2: Optional[str] = None,
        full_name: Optional[str] = None,
        extra_data: Optional[dict] = None,
        created_by_user_id: Optional[str] = None,
    ) -> Entity:
        """
        Create one Entity row.

        If target_entity_id is provided, validates the target exists and is a
        root entity (raises TargetNotFoundError otherwise).
        """
        if target_entity_id is not None:
            target = self.entities.get(target_entity_id)
            if target is None:
                raise TargetNotFoundError(
                    target_phone_number=f"entity_id={target_entity_id}"
                )
            if target.target_entity_id is not None:
                raise TargetNotFoundError(
                    target_phone_number=(
                        f"entity_id={target_entity_id} is not a root target "
                        "(its own target_entity_id is non-NULL)"
                    )
                )

        new_entity = Entity(
            relation_type=relation_type,
            target_entity_id=target_entity_id,
            identifier_1=identifier_1,
            identifier_2=identifier_2,
            full_name=full_name,
            deleted_at=not_deleted(),
            extra_data=extra_data or {},
        )
        return self.entities.add(new_entity)

    def ingest_bulk_text(
        self,
        *,
        rows: list[dict],
        default_relation_type: str,
        default_target_entity_id: str,
        created_by_user_id: Optional[str] = None,
    ) -> dict:
        """
        Insert one Entity row per item in rows with per-row resilience.
        Returns a BulkIngestSummary-shaped dict.
        Raises TargetNotFoundError if the default target is missing/non-root.
        """
        submission_id = str(uuid.uuid4())

        default_target = self.entities.get(default_target_entity_id)
        if default_target is None:
            raise TargetNotFoundError(
                target_phone_number=f"entity_id={default_target_entity_id}"
            )
        if default_target.target_entity_id is not None:
            raise TargetNotFoundError(
                target_phone_number=(
                    f"entity_id={default_target_entity_id} is not a root target"
                )
            )

        override_ids: set[str] = {
            r["target_entity_id"]
            for r in rows
            if r.get("target_entity_id") is not None
            and r["target_entity_id"] != default_target_entity_id
        }
        target_lookup: dict[str, Entity] = {default_target.id: default_target}
        if override_ids:
            for ent in self.entities.list({"id": {"in": list(override_ids)}}):
                target_lookup[ent.id] = ent

        failed_rows: list[dict] = []
        candidates: list[dict] = []

        for idx, row in enumerate(rows, start=1):
            token = (row.get("row_token") or "")[:_FAILURE_INPUT_CAP]

            relation = row.get("relation_type") or default_relation_type
            if not relation:
                failed_rows.append({"row": idx, "input": token, "error": "relation_type is required"})
                continue

            override_tgt = row.get("target_entity_id")
            tgt_id = override_tgt if override_tgt is not None else default_target_entity_id
            tgt = target_lookup.get(tgt_id)
            if tgt is None:
                failed_rows.append({"row": idx, "input": token, "error": f"target_entity_id={tgt_id} not found"})
                continue
            if tgt.target_entity_id is not None:
                failed_rows.append({"row": idx, "input": token, "error": f"target_entity_id={tgt_id} is not a root target"})
                continue

            candidates.append({
                "row": idx,
                "row_token": row.get("row_token") or "",
                "relation_type": relation,
                "target": tgt,
                "full_name": row.get("full_name"),
                "identifier_1": row.get("identifier_1"),
                "identifier_2": row.get("identifier_2"),
                "extra_data": row.get("extra_data") or {},
            })

        entity_ids: list[str] = []
        for c in candidates:
            try:
                extra: dict = {"bulk_submission_id": submission_id}
                if c.get("extra_data"):
                    extra.update(c["extra_data"])
                if c.get("row_token"):
                    extra["row_token"] = c["row_token"]

                ent = Entity(
                    relation_type=c["relation_type"],
                    target_entity_id=c["target"].id,
                    full_name=c.get("full_name"),
                    identifier_1=c.get("identifier_1"),
                    identifier_2=c.get("identifier_2"),
                    deleted_at=not_deleted(),
                    extra_data=extra,
                )
                self.entities.add(ent)
                entity_ids.append(ent.id)
            except IntegrityError as exc:
                detail = str(exc.orig) if exc.orig else "Database constraint violation"
                failed_rows.append({
                    "row": c["row"],
                    "input": c["row_token"][:_FAILURE_INPUT_CAP],
                    "error": f"DB error: {detail[:120]}",
                })

        failed_rows.sort(key=lambda r: r["row"])
        return {
            "success_count":      len(entity_ids),
            "failed_count":       len(failed_rows),
            "phone_ids":          [],
            "entity_ids":         entity_ids,
            "failed_rows":        failed_rows,
            "bulk_submission_id": submission_id,
        }
