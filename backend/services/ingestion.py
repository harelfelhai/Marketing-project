"""
services/ingestion.py — Phase 1 database service: Ingestion Gateway.

Orchestrates the full lifecycle of a circle-of-trust member ingestion:
target lookup → entity creation → phone number creation → routing decision
→ optional immediate Phase 2 dispatch.

This module contains NO business logic and NO routing rules. Its job is
purely to coordinate DB operations and hand off to the injected engine and
dispatcher at the right moment.
"""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlmodel import Session, select

from exceptions import TargetNotFoundError
from interfaces.ingestion import BaseIngestionRoutingEngine
from models.entity import Entity
from models.phone_number import PhoneNumber
from models.types import utc_now
from schemas.ingestion import IngestionPayload

# TYPE_CHECKING guard avoids a circular import at runtime while still
# providing accurate type hints for IDE navigation and static analysis.
if TYPE_CHECKING:
    from services.dispatcher import ActionDispatcher
    from services.scoring   import ScoringService


class IngestionService:
    """
    Coordinates all database interactions for Phase 1 (Ingestion).

    Responsibilities:
        1. Resolve `target_phone_number` → internal `Entity.id` (target FK).
        2. Atomically create the new `Entity` + `PhoneNumber` in a single
           DB transaction.
        3. Invoke the injected `IngestionRoutingEngine` to decide whether an
           immediate Phase 2 action should be triggered.
        4. If an action token is returned, delegate to `ActionDispatcher`.

    This class is GENERIC. It knows nothing about which entity types warrant
    which actions, or what proprietary data lives in `extra_data`. All of
    that knowledge lives inside the injected `routing_engine` and `dispatcher`.

    Instantiation (via FastAPI Depends in routers):
        service = IngestionService(
            session=db_session,
            routing_engine=get_ingestion_routing_engine(),
            dispatcher=get_action_dispatcher(db_session),
        )
    """

    def __init__(
        self,
        session: Session,
        routing_engine: BaseIngestionRoutingEngine,
        dispatcher: "ActionDispatcher",
        scoring_service: Optional["ScoringService"] = None,
    ) -> None:
        """
        Initialise the service with its required dependencies.

        Args:
            session         (Session):                     Active SQLModel DB session.
                                                            Shared with the caller; do NOT
                                                            close it inside this class.
            routing_engine  (BaseIngestionRoutingEngine):  The injected routing engine.
                                                            Determines post-ingestion action.
            dispatcher      (ActionDispatcher):            The Phase 2 dispatcher, used only
                                                            if the routing engine returns an
                                                            action token.
            scoring_service (Optional[ScoringService]):    Phase DY scoring hook. When
                                                            provided, every newly-inserted
                                                            PhoneNumber gets an initial
                                                            priority_score computed BEFORE
                                                            the routing engine fires. When
                                                            None, scoring is skipped (used
                                                            by legacy tests).
        """
        self.session = session
        self.routing_engine = routing_engine
        self.dispatcher = dispatcher
        self.scoring_service = scoring_service

    def ingest_circle_member(
        self,
        payload: IngestionPayload,
        *,
        uploaded_by_user_id: Optional[int] = None,
    ) -> PhoneNumber:
        """
        Ingest a new circle-of-trust phone number into the system.

        Full lifecycle orchestration (steps a → c):

            a) TARGET LOOKUP
               Query `PhoneNumber` for a row matching `payload.target_phone_number`.
               Read its `.entity_id` to get the primary target's `Entity.id`.
               Raise `TargetNotFoundError` if no match — ingestion must abort.

            b) ATOMIC CREATE
               Under the SAME DB transaction:
                 - INSERT a new `Entity` row (entity_type from payload, extra_data
                   from payload.entity_extra, target_entity_id = resolved target id).
                 - INSERT a new `PhoneNumber` row (all Phase 1 block fields from
                   payload, entity_id = new Entity.id).

            c) ROUTING DECISION + OPTIONAL DISPATCH
               Call `routing_engine.determine_immediate_action(phone_record)`.
               If a non-None action token is returned, immediately call
               `dispatcher.dispatch(phone_id=phone_record.id, action_type=token)`.
               This may create an `ActionLog` row as a side-effect.

        INTERNAL HOOK POINTS:
            - The routing decision (step c) is entirely delegated to the injected
              `BaseIngestionRoutingEngine`. Proprietary rules live there.
            - `extra_data` contents flow through as opaque blobs — this method
              reads `payload.entity_extra` and `payload.phone_extra` but does
              NOT inspect or validate their contents.

        Args:
            payload (IngestionPayload): The validated ingestion request. See
                                         `schemas/ingestion.py` for field docs.

        Returns:
            PhoneNumber: The newly created, committed `PhoneNumber` ORM object.
                         All fields (including auto-assigned `id`, `ingested_at`,
                         `verification_status="pending"`) are populated.

        Raises:
            TargetNotFoundError: If `payload.target_phone_number` does not match
                                  any existing `PhoneNumber` row in the DB.
            sqlalchemy.exc.IntegrityError: If `payload.phone_number` already exists
                                            (UNIQUE constraint on `phone_number` column).
                                            Let this propagate — the router should
                                            catch it and return HTTP 409 Conflict.
        """
        # ----------------------------------------------------------------
        # a) TARGET LOOKUP
        # Resolve the raw `target_phone_number` string to an internal
        # Entity.id. External callers are blind to DB IDs; this is the
        # single translation point.
        # ----------------------------------------------------------------
        target_phone_row = self.session.exec(
            select(PhoneNumber).where(
                PhoneNumber.phone_number == payload.target_phone_number
            )
        ).first()

        if target_phone_row is None:
            # Abort with a domain exception — the router translates this to 404.
            raise TargetNotFoundError(
                target_phone_number=payload.target_phone_number
            )

        # The target's Entity.id is the FK we need for the new circle member.
        target_entity_id: int = target_phone_row.entity_id

        # ----------------------------------------------------------------
        # b) ATOMIC CREATE — Entity + PhoneNumber under one transaction.
        # If either INSERT fails (e.g. UNIQUE violation), SQLModel rolls
        # back both, leaving the DB in a consistent state.
        # ----------------------------------------------------------------
        new_entity = Entity(
            entity_type=payload.entity_type,
            target_entity_id=target_entity_id,
            # Pass through the opaque proprietary blob — do not inspect.
            extra_data=payload.entity_extra,
            # Phase AUTH-B audit attribution.
            created_by_user_id=uploaded_by_user_id,
        )
        self.session.add(new_entity)
        self.session.flush()  # assigns new_entity.id without committing

        new_phone = PhoneNumber(
            entity_id=new_entity.id,
            phone_number=payload.phone_number,
            ingestion_source=payload.ingestion_source,
            ingestion_reason=payload.ingestion_reason,
            ingested_at=utc_now(),
            # Pass through the opaque proprietary blob — do not inspect.
            extra_data=payload.phone_extra,
            # Phase AUTH-B audit attribution.
            uploaded_by_user_id=uploaded_by_user_id,
        )
        self.session.add(new_phone)
        self.session.flush()  # assign new_phone.id without committing

        # Phase DY — compute initial priority for the new phone INSIDE
        # the same transaction so the row is inserted with a meaningful
        # priority_score rather than the column default of 0.0.
        # confidence_score is already its configured baseline (column
        # default in models/phone_number.py).
        if self.scoring_service is not None:
            self.scoring_service.recalculate_for_phone(new_phone.id, commit=False)

        self.session.commit()
        self.session.refresh(new_phone)

        # ----------------------------------------------------------------
        # c) ROUTING DECISION + OPTIONAL IMMEDIATE DISPATCH
        #
        # Transaction boundary semantics (deliberate, documented contract):
        #
        #   - The Entity + PhoneNumber inserts above are AUTHORITATIVE and
        #     already committed. If the dispatch step below fails, the
        #     ingestion is still considered successful — the caller receives
        #     the new PhoneNumber and the action can be recovered later via
        #     ActionDataTriggerService or a manual operator re-trigger.
        #
        #   - This is a deliberate "at-least-once" model: ingestion is
        #     authoritative; dispatch is best-effort. We choose this over
        #     full atomicity because Phase 1 must never lose a circle-of-trust
        #     record due to a transient Phase 2 provider failure.
        #
        #   - Hard dispatcher errors (PhoneNumberNotFoundError, ValueError for
        #     missing handler) still propagate so the caller can surface them.
        #     The PhoneNumber row remains in the DB — clean, queryable, ready
        #     for re-trigger.
        # ----------------------------------------------------------------
        action_token = self.routing_engine.determine_immediate_action(new_phone)

        if action_token is not None:
            self.dispatcher.dispatch(
                phone_id=new_phone.id,
                action_type=action_token,
            )

        return new_phone


    # ----------------------------------------------------------------
    # UAT round-3 — simplified phone ingestion
    # ----------------------------------------------------------------

    def quick_attach_phone(
        self,
        *,
        phone_number: str,
        entity_id: int,
        ingestion_reason: Optional[str] = None,
        uploaded_by_user_id: Optional[int] = None,
    ) -> PhoneNumber:
        """
        Create a PhoneNumber attached to an EXISTING entity.

        Skip the circle-of-trust expansion path (`ingest_circle_member`)
        when the operator already knows the target entity id — for
        example the new simplified "add phone" form, where the operator
        picks an existing entity, creates a new one inline, or attaches
        to a fresh social-envelope entity. All three paths converge
        here at the actual phone-write step.

        No scoring / routing side-effects — keep this minimal. Scoring
        is recomputed by the regular boot path / `refetchPhones`.
        """
        from models.entity import Entity
        ent = self.session.get(Entity, entity_id)
        if ent is None or ent.deleted_at is not None:
            raise TargetNotFoundError(target_phone_number=f"entity_id={entity_id}")

        new_phone = PhoneNumber(
            entity_id=entity_id,
            phone_number=phone_number.strip(),
            ingestion_source="manual",
            ingestion_reason=(ingestion_reason or "").strip() or None,
            ingested_at=utc_now(),
            extra_data={},
            uploaded_by_user_id=uploaded_by_user_id,
        )
        self.session.add(new_phone)
        self.session.commit()
        self.session.refresh(new_phone)
        return new_phone
