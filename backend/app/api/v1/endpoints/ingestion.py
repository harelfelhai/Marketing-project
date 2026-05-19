"""
app/api/v1/endpoints/ingestion.py — Domain A: Authoritative Ingestion Gateway.

Endpoint:
    POST /api/v1/ingest

Purpose:
    The single synchronous entry point for ALL circle-of-trust member
    ingestion — manual (operator form) and automated (external software).
    Delegates entirely to IngestionService, which handles:
        a) Target resolution (target_phone_number → internal Entity.id)
        b) Atomic Entity + PhoneNumber insert
        c) IngestionRoutingEngine decision (optional immediate Phase 2 dispatch)

    This router layer only handles HTTP concerns: request validation,
    dependency injection, error translation, and response serialisation.

PHASE INVARIANT:
    Phase 1 is a non-interactive, synchronous gateway. There is no human
    approval queue here. By the time a request reaches this endpoint, the
    upstream caller (human operator or external software) has already decided
    the number is worth ingesting. The system processes and persists it
    immediately.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_current_user, get_ingestion_service
from app.schemas.api_contracts import IngestionResponse
from exceptions import TargetNotFoundError
from models.user import User
from schemas.ingestion import IngestionPayload
from services.ingestion import IngestionService

router = APIRouter()


@router.post(
    "/ingest",
    response_model=IngestionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest a new circle-of-trust member",
    description=(
        "Atomically persists a new Entity and PhoneNumber for an incoming "
        "circle-of-trust member. Resolves the `target_phone_number` to an "
        "internal Entity FK, then optionally dispatches an immediate Phase 2 "
        "action based on the IngestionRoutingEngine decision. "
        "Returns 404 if the target phone is not found. "
        "Returns 409 if the phone number already exists in the system."
    ),
)
def ingest_circle_member(
    payload: IngestionPayload,
    current_user: Optional[User] = Depends(get_current_user),
    service: IngestionService = Depends(get_ingestion_service),
) -> IngestionResponse:
    """
    Ingest a new circle-of-trust phone number into the pipeline.

    The payload is the canonical `IngestionPayload` defined in
    `schemas/ingestion.py`. The router passes it directly to
    `IngestionService.ingest_circle_member()` without transformation.

    Error translations:
        - `TargetNotFoundError` → HTTP 404: the `target_phone_number` does not
          match any existing PhoneNumber row.
        - `IntegrityError` (UNIQUE violation) → HTTP 409: the `phone_number`
          already exists in the system.

    Args:
        payload (IngestionPayload): Validated ingestion request body.
        service (IngestionService): Injected via FastAPI Depends.

    Returns:
        IngestionResponse: The newly created, committed PhoneNumber row.

    Raises:
        HTTPException 404: Target phone not found.
        HTTPException 409: Duplicate phone number.
    """
    try:
        new_phone = service.ingest_circle_member(
            payload,
            uploaded_by_user_id=current_user.id if current_user else None,
        )
    except TargetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Phone number '{payload.phone_number}' already exists in the system. "
                "Duplicate ingestion is not permitted."
            ),
        )

    return IngestionResponse.model_validate(new_phone)
