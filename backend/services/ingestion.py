"""
services/ingestion.py — Simplified phone ingestion service.

Provides `quick_attach_phone` — creates a PhoneNumber attached to an
existing entity. The old circle-of-trust expansion path (ingest_circle_member)
has been removed; ingestion is now entity-centric.
"""

from typing import Optional

from sqlalchemy.exc import IntegrityError

from exceptions import TargetNotFoundError
from models.phone_number import PhoneNumber
from models.types import SOFT_DELETE_SENTINEL, not_deleted
from repositories.storage import Storage


class IngestionService:
    """
    Simplified phone ingestion. Creates PhoneNumber rows attached to existing entities.
    """

    def __init__(self, storage: Storage) -> None:
        self.entities = storage.entities
        self.phones = storage.phones

    def quick_attach_phone(
        self,
        *,
        phone_number: str,
        entity_id: str,
        ingestion_source: str = "manual",
        phone_type: Optional[str] = None,
        extra_data: Optional[dict] = None,
        uploaded_by_user_id: Optional[str] = None,
    ) -> PhoneNumber:
        """
        Create a PhoneNumber attached to an EXISTING entity.

        `phone_type` is an optional classification (operator-managed vocabulary).
        `extra_data` is an opaque pass-through blob written verbatim to
        PhoneNumber.extra_data (Secrets-Free Mandate) — used by the
        admin-defined dynamic ingestion fields.

        Raises:
            TargetNotFoundError: entity_id does not exist or is soft-deleted.
            IntegrityError: phone_number already exists (UNIQUE constraint).
        """
        ent = self.entities.get(entity_id)
        if ent is None or ent.deleted_at != SOFT_DELETE_SENTINEL:
            raise TargetNotFoundError(target_phone_number=f"entity_id={entity_id}")

        new_phone = PhoneNumber(
            entity_id=entity_id,
            phone_number=phone_number.strip(),
            ingestion_source=ingestion_source,
            phone_type=phone_type,
            score=0.0,
            deleted_at=not_deleted(),
            extra_data=extra_data or {},
        )
        return self.phones.add(new_phone)
