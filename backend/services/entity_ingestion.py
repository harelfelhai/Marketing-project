"""
services/entity_ingestion.py — Phase E2 entity-centric ingestion service.

Owns the single-entry channel in Phase E2-A. Bulk-text and bulk-upload
channels will land alongside this service in subsequent PRs (E2-B); the
class is intentionally structured to grow additional public methods
without churning the existing single-entry contract.

DISTINCTION FROM IngestionService
---------------------------------
`IngestionService.ingest_circle_member()` is PHONE-centric — it creates
an Entity + PhoneNumber atomically because the caller already holds a
phone number. `EntityIngestionService.create_single()` is PERSON-centric
— it creates an Entity standalone, with NO phone, so the system's
scraping and framing layers can start hunting for the person's numbers.

The two services intentionally do NOT share a base class: their
transaction shapes and downstream hooks differ enough that combining
them would introduce branches that obscure each path.

PRIVACY CONTRACT
----------------
Human-readable name fields (first_name, last_name) are merged into
`Entity.extra_data` rather than landing on schema-level columns. This
keeps the SQL schema speaking only in opaque integers and controlled
vocabulary, exactly as the Secrets-Free Mandate requires.
"""

from typing import Optional

from sqlmodel import Session

from exceptions import TargetNotFoundError
from models.entity import Entity


class EntityIngestionService:
    """
    Single-entry writer for the Phase E2 "+ Add Person" modal.

    Constructed per request via the FastAPI dependency factory in
    `dependencies.get_entity_ingestion_service`. Holds a session
    reference; the caller is responsible for the session's lifecycle.
    """

    def __init__(self, session: Session) -> None:
        """
        Args:
            session (Session): Active SQLModel DB session. Owned by the
                caller (typically the FastAPI per-request session). The
                service writes through this session and commits at the
                end of `create_single`; it does NOT close the session.
        """
        self.session = session

    def create_single(
        self,
        *,
        first_name: str,
        relation_type: str,
        target_entity_id: int,
        last_name: Optional[str] = None,
        extra_data: Optional[dict] = None,
    ) -> Entity:
        """
        Create one Entity row associated with an existing root target.

        Lifecycle:
            a) TARGET VALIDATION
               Resolve `target_entity_id` against `Entity` and verify it
               is a ROOT target (`target.target_entity_id IS NULL`).
               Either condition failing raises `TargetNotFoundError` for
               uniform 422 translation at the endpoint layer.

            b) CLIENT INHERITANCE
               The new entity's `client_id` is copied from the target,
               not accepted on the request. This prevents partition
               drift between a target and its associated entities.

            c) NAME MERGE
               `first_name` and `last_name` are merged into the supplied
               `extra_data` (or a fresh dict). The Secrets-Free Mandate
               keeps these names off schema-level columns.

            d) COMMIT
               One INSERT + one COMMIT. The service does not invoke any
               scoring or routing hooks — those are phone-centric and
               this method creates no phone.

        Args:
            first_name (str): Given name. Trimmed of surrounding
                whitespace before storage.
            relation_type (str): Operator-creatable relation token from
                `AssociatedRelationType`. Validation is upstream
                (Pydantic enum on the request body); the service
                receives a known-good value and writes it verbatim to
                `Entity.entity_type`.
            target_entity_id (int): FK to the root target. Validated.
            last_name (Optional[str]): Family name. Trimmed and stored
                only when non-empty after trim.
            extra_data (Optional[dict]): Optional caller-supplied
                metadata. Merged WITH the names; caller keys take
                precedence only when they don't collide with the
                reserved name keys (callers shouldn't supply
                first_name/last_name inside extra_data, but if they
                do, the request-level fields win).

        Returns:
            Entity: The newly inserted, committed Entity row. All
            auto-assigned fields (`id`, `created_at`, `updated_at`)
            are populated.

        Raises:
            TargetNotFoundError: `target_entity_id` is missing from the
                DB or points at a non-root entity. The endpoint maps
                this to 422 Unprocessable Entity.
        """
        # ----------------------------------------------------------------
        # a) TARGET VALIDATION
        # ----------------------------------------------------------------
        target = self.session.get(Entity, target_entity_id)
        if target is None:
            # Same exception class the bulk-text endpoint already maps to
            # 422 — keeps error translation consistent across E1/E2.
            raise TargetNotFoundError(
                target_phone_number=f"entity_id={target_entity_id}"
            )
        if target.target_entity_id is not None:
            # The target exists but is itself an associated entity. Allowing
            # this would create a 3-level chain (new → mid → root) and
            # violate the "two levels max" graph invariant that the scoring
            # service's single-hop root resolution relies on.
            raise TargetNotFoundError(
                target_phone_number=(
                    f"entity_id={target_entity_id} is not a root target "
                    "(its own target_entity_id is non-NULL)"
                )
            )

        # ----------------------------------------------------------------
        # b/c) BUILD ROW — client inheritance + name merge into extra_data.
        # ----------------------------------------------------------------
        # Start from the caller's extras (or empty dict) so any
        # operator-supplied keys survive. Then overlay the names — they
        # are the canonical write here and must not be shadowed by stale
        # values left in the caller payload.
        merged_extra: dict = dict(extra_data or {})
        merged_extra["first_name"] = first_name.strip()
        if last_name is not None:
            trimmed_last = last_name.strip()
            if trimmed_last:
                merged_extra["last_name"] = trimmed_last

        new_entity = Entity(
            client_id=target.client_id,
            relation_type="associated",
            entity_type=relation_type,
            target_entity_id=target.id,
            extra_data=merged_extra,
        )

        # ----------------------------------------------------------------
        # d) COMMIT — single-row insert, single transaction.
        # ----------------------------------------------------------------
        self.session.add(new_entity)
        self.session.commit()
        self.session.refresh(new_entity)
        return new_entity
