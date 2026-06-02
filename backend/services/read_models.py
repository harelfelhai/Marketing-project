"""
services/read_models.py — unified read projections ("root entity + their phones").

Assembles a single unified view per root entity (target_entity_id IS NULL):
the root entity, its member entities, every phone across the whole group,
and computed metrics.

Design
------
- READ-ONLY. Returns plain dicts.
- Backend-agnostic: built on Storage repositories.
- Root entity = entity where target_entity_id IS NULL AND deleted_at == SOFT_DELETE_SENTINEL.
- No client_id concept: use target_entity_id IS NULL to find roots.
"""

from __future__ import annotations

from typing import Optional

from config import settings
from models.types import SOFT_DELETE_SENTINEL
from repositories import cache
from repositories.storage import Storage


def _phone_row(phone, entity) -> dict:
    """Flatten one phone with entity context."""
    return {
        "id": phone.id,
        "entity_id": phone.entity_id,
        "phone_number": phone.phone_number,
        "phone_type": phone.phone_type,
        "verification_status": phone.verification_status,
        "score": phone.score,
        "ingestion_source": phone.ingestion_source,
        "extra_data": phone.extra_data,
        # Entity context
        "relation_type": entity.relation_type if entity else None,
        "full_name": entity.full_name if entity else None,
        "identifier_1": entity.identifier_1 if entity else None,
        "identifier_2": entity.identifier_2 if entity else None,
        "target_entity_id": entity.target_entity_id if entity else None,
    }


def _metrics(phone_rows: list[dict]) -> dict:
    """Per-root entity roll-up the hub card renders."""
    total = len(phone_rows)
    pending  = sum(1 for p in phone_rows if p["verification_status"] == "pending")
    verified = sum(1 for p in phone_rows if p["verification_status"] == "verified")
    rejected = sum(1 for p in phone_rows if p["verification_status"] == "rejected")
    return {"total": total, "pending": pending, "verified": verified, "rejected": rejected}


class ClientReadModelService:
    """
    Assembles the unified per-root-entity projection from the storage seam.

    The name is kept as ClientReadModelService for backward compatibility;
    "client" here means "root entity" (target_entity_id IS NULL).
    """

    def __init__(self, storage: Storage) -> None:
        self.entities = storage.entities
        self.phones = storage.phones

    def list_clients(
        self,
        *,
        client_ids: Optional[list[str]] = None,
        include_deleted: bool = False,
    ) -> list[dict]:
        """
        Return one unified aggregate per root entity.
        Two repository reads total (all entities + all phones), grouped in memory.
        """
        if settings.read_cache_enabled:
            ids_key = ",".join(sorted(client_ids)) if client_ids else "*"
            key = f"clients:{ids_key}:{include_deleted}"
            return cache.cached(
                key,
                lambda: self._compute_clients(client_ids, include_deleted),
            )
        return self._compute_clients(client_ids, include_deleted)

    def _compute_clients(
        self,
        client_ids: Optional[list[str]],
        include_deleted: bool,
    ) -> list[dict]:
        sentinel = SOFT_DELETE_SENTINEL
        ent_where: dict = {} if include_deleted else {"deleted_at": sentinel}
        entities = self.entities.list(ent_where)

        phone_where: dict = {} if include_deleted else {"deleted_at": sentinel}
        phones = self.phones.list(phone_where)

        by_id = {e.id: e for e in entities}

        # Group entities by root (target_entity_id or self for roots).
        by_root: dict[str, list] = {}
        for e in entities:
            root_id = e.target_entity_id if e.target_entity_id else e.id
            by_root.setdefault(root_id, []).append(e)

        # Group phones by their entity's root.
        phones_by_root: dict[str, list] = {}
        for ph in phones:
            owner = by_id.get(ph.entity_id)
            if owner is None:
                continue
            root_id = owner.target_entity_id if owner.target_entity_id else owner.id
            phones_by_root.setdefault(root_id, []).append((ph, owner))

        # Only include root entities (target_entity_id IS NULL).
        root_entities = [e for e in entities if e.target_entity_id is None]

        wanted = set(client_ids) if client_ids else None
        out: list[dict] = []
        for root in root_entities:
            if wanted is not None and root.id not in wanted:
                continue
            members = [e for e in by_root.get(root.id, []) if e.id != root.id]
            phone_rows = [
                _phone_row(ph, owner)
                for (ph, owner) in phones_by_root.get(root.id, [])
            ]
            out.append({
                "client_id": root.id,  # kept for backward compat
                "root": _entity_dict(root),
                "members": [_entity_dict(e) for e in members],
                "phones": phone_rows,
                "metrics": _metrics(phone_rows),
            })
        out.sort(key=lambda c: str(c["client_id"]))
        return out

    def get_client(
        self,
        client_id: str,
        *,
        include_deleted: bool = False,
    ) -> Optional[dict]:
        """Single root entity aggregate, or None when unknown."""
        rows = self.list_clients(client_ids=[client_id], include_deleted=include_deleted)
        return rows[0] if rows else None


def _entity_dict(entity) -> dict:
    """Read-only projection of an entity row."""
    return {
        "id": entity.id,
        "target_entity_id": entity.target_entity_id,
        "relation_type": entity.relation_type,
        "identifier_1": entity.identifier_1,
        "identifier_2": entity.identifier_2,
        "full_name": entity.full_name,
        "extra_data": entity.extra_data,
    }
