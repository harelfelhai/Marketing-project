"""
services/data_admin.py — edit + soft-delete for Entity and PhoneNumber.

Single service that owns every admin-facing mutation on the two
"long-lived" rows in the system (the operational identity graph).
Kept separate from `entity_ingestion.py` because:

  - ingestion is the WRITER for new entities; admin is the EDITOR /
    DELETER of existing ones.
  - admin operations are role-gated (require_admin) at the endpoint
    layer; ingestion is open to authenticated regulars too.

The soft-delete contract uses SOFT_DELETE_SENTINEL:
  - `deleted_at == SOFT_DELETE_SENTINEL`  →  active row.
  - `deleted_at = <ts>`                   →  soft-deleted at that UTC instant.

Cascade rule:
  - Soft-deleting an Entity also soft-deletes EVERY PhoneNumber whose
    `entity_id` matches, plus every member entity pointing at it, plus
    every PipelineTask tied to those phones/entities.
  - Restore is symmetric: restoring an entity sets deleted_at back to
    SOFT_DELETE_SENTINEL for the entity, its phones, child entities,
    and their tasks.

Storage seam
------------
This service speaks to the storage layer only through repositories
(see `repositories/`), so it runs identically on SQL and MongoDB.
"""

from datetime import datetime, timezone
from typing import Optional

from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import SOFT_DELETE_SENTINEL, not_deleted
from repositories.storage import Storage


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class DataAdminService:
    """
    Edit + soft-delete + restore for Entity and PhoneNumber.

    All public methods take a string id and either return the freshly-
    mutated row or raise ValueError("Entity {id} not found") on a miss
    / mismatch.
    """

    def __init__(self, storage: Storage) -> None:
        self.entities = storage.entities
        self.phones = storage.phones
        self.tasks = storage.tasks

    # ----------------------------------------------------------------
    # Entity
    # ----------------------------------------------------------------

    def get_entity(self, entity_id: str, include_deleted: bool = False) -> Entity:
        ent = self.entities.get(entity_id)
        if ent is None:
            raise ValueError(f"Entity {entity_id} not found")
        if ent.deleted_at != SOFT_DELETE_SENTINEL and not include_deleted:
            raise ValueError(f"Entity {entity_id} not found")
        return ent

    def list_entities(
        self,
        *,
        target_entity_id: Optional[str] = None,
        include_deleted: bool = False,
        q: Optional[str] = None,
        custom_where: Optional[dict] = None,
    ) -> list[Entity]:
        """
        Read-side query for the Entities view tab.

        Filter shape:
          - target_entity_id  →  filter by parent entity
          - include_deleted   →  default False, hides tombstones
          - q                 →  substring match on full_name, identifier_1,
                                   identifier_2
          - custom_where      →  already-validated admin-defined filter clauses
                                   (see services/generic_filters.py), merged
                                   straight into the DSL query
        """
        where: dict = dict(custom_where or {})
        if not include_deleted:
            where["deleted_at"] = SOFT_DELETE_SENTINEL
        if target_entity_id is not None:
            where["target_entity_id"] = target_entity_id

        rows = self.entities.list(where)

        if q:
            needle = q.strip().lower()
            def _hay(e: Entity) -> str:
                return " ".join(filter(None, [
                    e.full_name or "",
                    e.identifier_1 or "",
                    e.identifier_2 or "",
                    e.id,
                ])).lower()
            rows = [e for e in rows if needle in _hay(e)]

        # Stable: by id descending.
        rows.sort(key=lambda e: e.id, reverse=True)
        return rows

    def patch_entity(
        self,
        entity_id: str,
        *,
        full_name: Optional[str] = None,
        identifier_1: Optional[str] = None,
        identifier_2: Optional[str] = None,
        relation_type: Optional[str] = None,
        target_entity_id: Optional[str] = None,
    ) -> Entity:
        """
        Edit an existing entity. Only non-None args are applied —
        callers send a partial body.

        Raises ValueError on missing entity or deleted entity (you
        must restore before editing).
        """
        ent = self.get_entity(entity_id, include_deleted=False)

        if full_name is not None:
            ent.full_name = full_name.strip() or None
        if identifier_1 is not None:
            ent.identifier_1 = identifier_1.strip() or None
        if identifier_2 is not None:
            ent.identifier_2 = identifier_2.strip() or None
        if relation_type is not None:
            ent.relation_type = relation_type
        if target_entity_id is not None:
            ent.target_entity_id = target_entity_id

        return self.entities.update(ent)

    def soft_delete_entity(self, entity_id: str) -> dict:
        """
        Tombstone an entity AND cascade through the full sub-graph.

        Sets deleted_at = utc_now() (a real timestamp, NOT the sentinel)
        on the entity, its child entities, their phones, and related tasks.

        Returns the operator-facing summary:
            {entity_id, phones_deleted, entities_deleted, tasks_deleted}
        """
        ent = self.get_entity(entity_id, include_deleted=False)
        now = _utc_now()

        # Children (member entities targeting this entity).
        child_entities = self.entities.list({
            "target_entity_id": entity_id,
            "deleted_at": SOFT_DELETE_SENTINEL,
        })
        entity_ids_to_kill = [entity_id, *(c.id for c in child_entities)]

        # Phones across the whole sub-graph.
        phones = self.phones.list({
            "entity_id": {"in": entity_ids_to_kill},
            "deleted_at": SOFT_DELETE_SENTINEL,
        })
        phone_ids_to_kill = [p.id for p in phones]

        # Tasks tied to those phones.
        tasks_deleted = 0
        if phone_ids_to_kill:
            tasks = self.tasks.list({
                "phone_id": {"in": phone_ids_to_kill},
                "deleted_at": SOFT_DELETE_SENTINEL,
            })
            for t in tasks:
                t.deleted_at = now
                self.tasks.update(t)
            tasks_deleted = len(tasks)
        # Also tasks tied to the entity directly.
        entity_tasks = self.tasks.list({
            "entity_id": {"in": entity_ids_to_kill},
            "deleted_at": SOFT_DELETE_SENTINEL,
        })
        for t in entity_tasks:
            if t.deleted_at == SOFT_DELETE_SENTINEL:
                t.deleted_at = now
                self.tasks.update(t)
                tasks_deleted += 1

        for p in phones:
            p.deleted_at = now
            self.phones.update(p)

        for child in child_entities:
            child.deleted_at = now
            self.entities.update(child)

        ent.deleted_at = now
        self.entities.update(ent)

        return {
            "entity_id":        entity_id,
            "phones_deleted":   len(phones),
            "entities_deleted": len(child_entities) + 1,
            "tasks_deleted":    tasks_deleted,
        }

    def restore_entity(self, entity_id: str) -> dict:
        """
        Restore a soft-deleted entity and its cascade.

        Sets deleted_at back to SOFT_DELETE_SENTINEL for the entity,
        its child entities, their phones, and related tasks — but only
        rows that were soft-deleted after the entity was deleted
        (approximate heuristic: rows whose deleted_at >= entity.deleted_at).

        Returns:
            {entity_id, phones_restored, entities_restored, tasks_restored}
        """
        ent = self.entities.get(entity_id)
        if ent is None:
            raise ValueError(f"Entity {entity_id} not found")
        if ent.deleted_at == SOFT_DELETE_SENTINEL:
            # Already active — idempotent.
            return {
                "entity_id":        entity_id,
                "phones_restored":  0,
                "entities_restored": 0,
                "tasks_restored":   0,
            }

        deleted_ts = ent.deleted_at

        # Restore entity itself first.
        ent.deleted_at = not_deleted()
        self.entities.update(ent)
        entities_restored = 1

        # Child entities deleted at approximately the same time.
        child_entities = [
            e for e in self.entities.list({"target_entity_id": entity_id})
            if e.deleted_at != SOFT_DELETE_SENTINEL
            and e.deleted_at is not None
            and e.deleted_at >= deleted_ts
        ]
        for child in child_entities:
            child.deleted_at = not_deleted()
            self.entities.update(child)
        entities_restored += len(child_entities)

        entity_ids_to_restore = [entity_id, *(c.id for c in child_entities)]

        # Phones deleted at approximately the same time.
        all_phones = self.phones.list({"entity_id": {"in": entity_ids_to_restore}})
        phones_to_restore = [
            p for p in all_phones
            if p.deleted_at != SOFT_DELETE_SENTINEL
            and p.deleted_at is not None
            and p.deleted_at >= deleted_ts
        ]
        phone_ids_to_restore = [p.id for p in phones_to_restore]
        for p in phones_to_restore:
            p.deleted_at = not_deleted()
            self.phones.update(p)
        phones_restored = len(phones_to_restore)

        # Tasks tied to those phones / entities.
        tasks_restored = 0
        if phone_ids_to_restore:
            phone_tasks = self.tasks.list({"phone_id": {"in": phone_ids_to_restore}})
            for t in phone_tasks:
                if t.deleted_at != SOFT_DELETE_SENTINEL and t.deleted_at is not None:
                    t.deleted_at = not_deleted()
                    self.tasks.update(t)
                    tasks_restored += 1
        entity_tasks = self.tasks.list({"entity_id": {"in": entity_ids_to_restore}})
        for t in entity_tasks:
            if t.deleted_at != SOFT_DELETE_SENTINEL and t.deleted_at is not None:
                t.deleted_at = not_deleted()
                self.tasks.update(t)
                tasks_restored += 1

        return {
            "entity_id":        entity_id,
            "phones_restored":  phones_restored,
            "entities_restored": entities_restored,
            "tasks_restored":   tasks_restored,
        }

    # ----------------------------------------------------------------
    # PhoneNumber
    # ----------------------------------------------------------------

    def get_phone(self, phone_id: str, include_deleted: bool = False) -> PhoneNumber:
        ph = self.phones.get(phone_id)
        if ph is None:
            raise ValueError(f"Phone {phone_id} not found")
        if ph.deleted_at != SOFT_DELETE_SENTINEL and not include_deleted:
            raise ValueError(f"Phone {phone_id} not found")
        return ph

    def patch_phone(
        self,
        phone_id: str,
        *,
        phone_number: Optional[str] = None,
        entity_id: Optional[str] = None,
        phone_type: Optional[str] = None,
        ingestion_source: Optional[str] = None,
        verification_status: Optional[str] = None,
        score: Optional[float] = None,
    ) -> PhoneNumber:
        """
        Edit an existing phone row. Only non-None args take effect.
        Raises ValueError on missing/deleted row, or on a non-existent /
        soft-deleted entity_id when moving the phone to a different owner.
        """
        ph = self.get_phone(phone_id, include_deleted=False)

        if phone_number is not None:
            ph.phone_number = phone_number.strip()
        if entity_id is not None:
            owner = self.entities.get(entity_id)
            if owner is None or owner.deleted_at != SOFT_DELETE_SENTINEL:
                raise ValueError(f"Entity {entity_id} not found")
            ph.entity_id = entity_id
        if phone_type is not None:
            ph.phone_type = phone_type
        if ingestion_source is not None:
            ph.ingestion_source = ingestion_source
        if verification_status is not None:
            ph.verification_status = verification_status
        if score is not None:
            ph.score = score

        return self.phones.update(ph)

    def soft_delete_phone(self, phone_id: str) -> PhoneNumber:
        ph = self.get_phone(phone_id, include_deleted=False)
        ph.deleted_at = _utc_now()
        return self.phones.update(ph)

    def restore_phone(self, phone_id: str) -> PhoneNumber:
        """Restore a soft-deleted phone."""
        ph = self.phones.get(phone_id)
        if ph is None:
            raise ValueError(f"Phone {phone_id} not found")
        if ph.deleted_at == SOFT_DELETE_SENTINEL:
            return ph

        ph.deleted_at = not_deleted()
        return self.phones.update(ph)
