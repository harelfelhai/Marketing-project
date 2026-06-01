"""
services/read_models.py — unified read projections ("person + their phones").

The operational data is normalised across `entity` and `phone_number`, so the
display surfaces (Client Hub, "all phones for these clients", per-client
metrics) historically needed bespoke JOINs. This module assembles a single
UNIFIED view per client — the root entity (the person/campaign target), the
member entities in their circle, and every phone across the whole circle —
from the storage seam, so callers query one easy shape instead of stitching
joins themselves.

Design
------
- READ-ONLY. Returns plain dicts, never write-bindable model instances, so
  the projection is safe to cache (no session-detachment, no accidental
  write-back). Mutations continue to flow through the normal repositories.
- Backend-agnostic. Built entirely on the `Storage` repositories, so it runs
  identically on SQL and MongoDB (proven by the dual-backend test).
- Efficient. The whole Client Hub is assembled from TWO repository reads
  (all entities + all phones), grouped in memory — the shape the planned
  read-cache memoises so repeated hub loads cost zero DB round-trips.

`client_id` is the derived value (`target_entity_id ?? id`): a root entity is
its own client; a member's client is the root it points at. Human-readable
client names are NOT produced here — they live in the frontend config layer
(Secrets-Free Mandate); the projection exposes the root's `extra_data` so the
caller can resolve a display name if it has one.
"""

from __future__ import annotations

from typing import Optional

from repositories.storage import Storage


def _customer_tier(root_extra: Optional[dict]) -> Optional[int]:
    """Extract customer_tier from a root entity's extra_data (int or None)."""
    if not root_extra:
        return None
    raw = root_extra.get("customer_tier")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _phone_row(phone, entity, root) -> dict:
    """Flatten one phone with the joined entity/root context the UI needs."""
    return {
        "id": phone.id,
        "entity_id": phone.entity_id,
        "phone_number": phone.phone_number,
        "client_id": entity.client_id,
        "entity_type": entity.entity_type,
        "customer_tier": _customer_tier((root or entity).extra_data),
        "verification_status": phone.verification_status,
        "classification_type": phone.classification_type,
        "confidence_score": phone.confidence_score,
        "priority_score": phone.priority_score,
        "ingested_at": phone.ingested_at,
        "extra_data": phone.extra_data,
    }


def _metrics(phone_rows: list[dict]) -> dict:
    """Per-client roll-up the Client Hub card renders."""
    total = len(phone_rows)
    pending = sum(1 for p in phone_rows if p["verification_status"] == "pending")
    good = sum(1 for p in phone_rows if p["verification_status"] == "verified_good")
    bad = sum(1 for p in phone_rows if p["verification_status"] == "verified_bad")
    return {"total": total, "pending": pending, "good": good, "bad": bad}


class ClientReadModelService:
    """
    Assembles the unified per-client projection from the storage seam.

    Construction:
        ClientReadModelService(storage=storage)
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
        Return one unified aggregate per client (root entity), each with its
        members, all phones across the circle, and the metric roll-up.

        Two repository reads total (all entities + all phones), grouped in
        memory — the whole hub in O(entities + phones), no per-client query.
        """
        ent_where: dict = {} if include_deleted else {"deleted_at": None}
        entities = self.entities.list(ent_where)

        phone_where: dict = {} if include_deleted else {"deleted_at": None}
        phones = self.phones.list(phone_where)

        # Index entities by id and by derived client_id.
        by_id = {e.id: e for e in entities}
        by_client: dict[str, list] = {}
        for e in entities:
            by_client.setdefault(e.client_id, []).append(e)

        # Group phones under their owning entity's client.
        phones_by_client: dict[str, list] = {}
        for ph in phones:
            owner = by_id.get(ph.entity_id)
            if owner is None:
                continue  # orphan phone (owner filtered out / deleted)
            phones_by_client.setdefault(owner.client_id, []).append((ph, owner))

        wanted = set(client_ids) if client_ids else None
        out: list[dict] = []
        for client_id, members in by_client.items():
            if wanted is not None and client_id not in wanted:
                continue
            root = by_id.get(client_id)  # the root entity (== this client)
            phone_rows = [
                _phone_row(ph, owner, by_id.get(owner.target_entity_id) if owner.target_entity_id else owner)
                for (ph, owner) in phones_by_client.get(client_id, [])
            ]
            out.append({
                "client_id": client_id,
                "root": _entity_dict(root) if root is not None else None,
                "members": [_entity_dict(e) for e in members if e.id != client_id],
                "phones": phone_rows,
                "metrics": _metrics(phone_rows),
            })
        # Stable order: by client_id for determinism.
        out.sort(key=lambda c: str(c["client_id"]))
        return out

    def get_client(
        self,
        client_id: str,
        *,
        include_deleted: bool = False,
    ) -> Optional[dict]:
        """Single client aggregate, or None when the client id is unknown."""
        rows = self.list_clients(client_ids=[client_id], include_deleted=include_deleted)
        return rows[0] if rows else None


def _entity_dict(entity) -> dict:
    """Read-only projection of an entity row."""
    return {
        "id": entity.id,
        "client_id": entity.client_id,
        "entity_type": entity.entity_type,
        "target_entity_id": entity.target_entity_id,
        "strong_identifier": entity.strong_identifier,
        "extra_data": entity.extra_data,
    }
