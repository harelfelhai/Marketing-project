"""
services/data_admin.py — UAT round-3: edit + soft-delete for Entity and PhoneNumber.

Single service that owns every admin-facing mutation on the two
"long-lived" rows in the system (the operational identity graph).
Kept separate from `entity_ingestion.py` because:

  - ingestion is the WRITER for new entities; admin is the EDITOR /
    DELETER of existing ones.
  - admin operations are role-gated (require_admin) at the endpoint
    layer; ingestion is open to authenticated regulars too.

The soft-delete contract is timestamp-based, not boolean:
  - `deleted_at IS NULL`     →  active row.
  - `deleted_at = <ts>`      →  soft-deleted at that UTC instant.

Why a timestamp:
  - "WHEN was it deleted" is part of the documentation requirement —
    the user explicitly called out reseeding the same number after a
    delete should be detectable as "re-surfaced", which means we need
    the time of the previous tombstone, not just a flag.
  - Restore is just `UPDATE ... SET deleted_at = NULL`. No second
    boolean to maintain.

Cascade rule (per UAT spec):
  - Soft-deleting an Entity also soft-deletes EVERY PhoneNumber whose
    `entity_id` matches. The caller surfaces a warning to the operator
    BEFORE invoking — this service does not prompt.
  - Restoring an Entity does NOT auto-restore phones; phones must be
    individually restored. Asymmetric on purpose: the original delete
    is a deliberate "drop everything for this person"; the restore is
    a curated step where the operator may have already cleaned up
    some of the dropped phones.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session, select

from models.entity import Entity
from models.phone_number import PhoneNumber


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class DataAdminService:
    """
    Edit + soft-delete + restore for Entity and PhoneNumber.

    All public methods take an integer id and either:
      - return the freshly-mutated row, OR
      - raise ValueError("Entity {id} not found") on a miss / mismatch.

    Mutations commit before returning. Cascades use the same Session
    so atomicity is preserved.
    """

    def __init__(self, session: Session) -> None:
        self.session = session

    # ----------------------------------------------------------------
    # Entity
    # ----------------------------------------------------------------

    def get_entity(self, entity_id: int, include_deleted: bool = False) -> Entity:
        ent = self.session.get(Entity, entity_id)
        if ent is None:
            raise ValueError(f"Entity {entity_id} not found")
        if ent.deleted_at is not None and not include_deleted:
            raise ValueError(f"Entity {entity_id} not found")
        return ent

    def list_entities(
        self,
        *,
        client_id: Optional[int] = None,
        client_ids: Optional[list[int]] = None,
        entity_type: Optional[str] = None,
        include_deleted: bool = False,
        q: Optional[str] = None,
    ) -> list[Entity]:
        """
        Read-side query for the new "Entities" view tab (PR-B).

        Filter shape mirrors GET /phones for consistency:
          - client_id  / client_ids  →  partition + personalization
          - entity_type              →  'target' (primary roots) or
                                          'associated' (members)
          - include_deleted=False    →  default, hides tombstones
          - q                        →  substring match on name fields
                                          inside extra_data
        """
        stmt = select(Entity)
        if not include_deleted:
            stmt = stmt.where(Entity.deleted_at.is_(None))
        if client_id is not None:
            stmt = stmt.where(Entity.client_id == client_id)
        if client_ids:
            stmt = stmt.where(Entity.client_id.in_(client_ids))
        if entity_type:
            stmt = stmt.where(Entity.entity_type == entity_type)

        rows = list(self.session.exec(stmt))

        if q:
            # Substring match on first_name + last_name inside
            # extra_data. Done in Python because SQLite/Postgres JSON
            # operators diverge; the entity volume in any one client
            # partition stays bounded.
            needle = q.strip().lower()
            def _hay(e: Entity) -> str:
                fn = (e.extra_data or {}).get("first_name") or ""
                ln = (e.extra_data or {}).get("last_name") or ""
                return f"{fn} {ln} {e.id}".lower()
            rows = [e for e in rows if needle in _hay(e)]

        # Stable: newest-first, then id-desc tiebreaker.
        rows.sort(key=lambda e: (e.created_at, e.id), reverse=True)
        return rows

    def patch_entity(
        self,
        entity_id: int,
        *,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        relation_type: Optional[str] = None,
        target_entity_id: Optional[int] = None,
        client_id: Optional[int] = None,
        strong_identifier: Optional[str] = None,
    ) -> Entity:
        """
        Edit an existing entity. Only non-None args are applied —
        callers send a partial body. Names + strong_identifier live in
        extra_data; the others are schema columns.

        Raises ValueError on missing entity or deleted entity (you
        must restore before editing).
        """
        ent = self.get_entity(entity_id, include_deleted=False)

        if relation_type is not None:
            ent.entity_type = relation_type
        if target_entity_id is not None:
            ent.target_entity_id = target_entity_id
        if client_id is not None:
            ent.client_id = client_id

        # extra_data mutations — make a fresh dict so SQLAlchemy sees
        # the JSON column as dirty (in-place updates on the same dict
        # reference don't always trip change detection).
        if any(v is not None for v in (first_name, last_name, strong_identifier)):
            extra = dict(ent.extra_data or {})
            if first_name is not None:
                extra["first_name"] = first_name.strip()
            if last_name is not None:
                extra["last_name"] = last_name.strip() or None
            if strong_identifier is not None:
                sid = strong_identifier.strip()
                if sid:
                    extra["strong_identifier"] = sid
                else:
                    extra.pop("strong_identifier", None)
            ent.extra_data = extra

        self.session.add(ent)
        self.session.commit()
        self.session.refresh(ent)
        return ent

    def soft_delete_entity(self, entity_id: int) -> dict:
        """
        Tombstone an entity AND cascade-tombstone every PhoneNumber
        whose entity_id matches. Returns a summary dict the endpoint
        echoes back to the operator:
            {entity_id, phones_deleted: int}
        """
        ent = self.get_entity(entity_id, include_deleted=False)
        now = _utc_now()
        ent.deleted_at = now

        # Cascade — every active phone of this entity.
        phones = list(self.session.exec(
            select(PhoneNumber)
            .where(PhoneNumber.entity_id == entity_id)
            .where(PhoneNumber.deleted_at.is_(None))
        ))
        for p in phones:
            p.deleted_at = now
            self.session.add(p)

        self.session.add(ent)
        self.session.commit()
        return {"entity_id": entity_id, "phones_deleted": len(phones)}

    def restore_entity(self, entity_id: int) -> Entity:
        """
        Clear an entity's tombstone. Does NOT cascade-restore its
        phones — operator decides per-phone.
        """
        ent = self.session.get(Entity, entity_id)
        if ent is None:
            raise ValueError(f"Entity {entity_id} not found")
        if ent.deleted_at is None:
            return ent  # already active — idempotent
        ent.deleted_at = None
        self.session.add(ent)
        self.session.commit()
        self.session.refresh(ent)
        return ent

    # ----------------------------------------------------------------
    # PhoneNumber
    # ----------------------------------------------------------------

    def get_phone(self, phone_id: int, include_deleted: bool = False) -> PhoneNumber:
        ph = self.session.get(PhoneNumber, phone_id)
        if ph is None:
            raise ValueError(f"Phone {phone_id} not found")
        if ph.deleted_at is not None and not include_deleted:
            raise ValueError(f"Phone {phone_id} not found")
        return ph

    def patch_phone(
        self,
        phone_id: int,
        *,
        phone_number: Optional[str] = None,
        entity_id: Optional[int] = None,
        classification_type: Optional[str] = None,
        ingestion_source: Optional[str] = None,
        ingestion_reason: Optional[str] = None,
        verification_status: Optional[str] = None,
        verification_source: Optional[str] = None,
        verification_reason: Optional[str] = None,
    ) -> PhoneNumber:
        """
        Edit an existing phone row. Like patch_entity, only non-None
        args take effect. Raises ValueError on missing/deleted row,
        or on a non-existent / soft-deleted entity_id when moving the
        phone to a different owner.
        """
        ph = self.get_phone(phone_id, include_deleted=False)

        if phone_number is not None:
            ph.phone_number = phone_number.strip()
        if entity_id is not None:
            # Validate the new owner exists and is active.
            owner = self.session.get(Entity, entity_id)
            if owner is None or owner.deleted_at is not None:
                raise ValueError(f"Entity {entity_id} not found")
            ph.entity_id = entity_id
        if classification_type is not None:
            ph.classification_type = classification_type
        if ingestion_source is not None:
            ph.ingestion_source = ingestion_source
        if ingestion_reason is not None:
            ph.ingestion_reason = ingestion_reason.strip() or None
        if verification_status is not None:
            ph.verification_status = verification_status
        if verification_source is not None:
            ph.verification_source = verification_source
        if verification_reason is not None:
            ph.verification_reason = verification_reason.strip() or None

        self.session.add(ph)
        self.session.commit()
        self.session.refresh(ph)
        return ph

    def soft_delete_phone(self, phone_id: int) -> PhoneNumber:
        ph = self.get_phone(phone_id, include_deleted=False)
        ph.deleted_at = _utc_now()
        self.session.add(ph)
        self.session.commit()
        self.session.refresh(ph)
        return ph

    def restore_phone(self, phone_id: int) -> PhoneNumber:
        ph = self.session.get(PhoneNumber, phone_id)
        if ph is None:
            raise ValueError(f"Phone {phone_id} not found")
        if ph.deleted_at is None:
            return ph
        ph.deleted_at = None
        self.session.add(ph)
        self.session.commit()
        self.session.refresh(ph)
        return ph
