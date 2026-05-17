"""
app/api/v1/endpoints/verification.py — Domain C: Quality Audit (Phase 3).

Endpoint:
    POST /api/v1/verification/verdict

Purpose:
    Allows a human operator to submit a manual quality verdict on a specific
    phone number. The verdict is written to the Phase 3 block of the
    PhoneNumber via VerificationService, which guarantees the write is atomic
    and uses the same code path as the automated VerificationEngine.

PHASE INVARIANT:
    Human quality judgment happens ONLY in Phase 3 — after Phase 2 actions
    have been executed and their outcomes have had time to accumulate. This
    endpoint is the correct boundary for operator review decisions.
    The ingestion gateway (Phase 1) has no human approval step.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_verification_service
from app.schemas.api_contracts import IngestionResponse, VerificationVerdictRequest
from exceptions import PhoneNumberNotFoundError
from services.verification import VerificationService

router = APIRouter()


@router.post(
    "/verdict",
    response_model=IngestionResponse,
    summary="Submit a manual verification verdict",
    description=(
        "Records a human operator's quality judgment (good/bad + reason) on a "
        "specific phone number. Writes directly to the Phase 3 block of the "
        "PhoneNumber row via VerificationService — the same atomic writer used "
        "by the automated VerificationEngine, ensuring both paths produce "
        "consistent state. "
        "\n\n"
        "Returns 404 if `phone_id` does not exist."
    ),
)
def submit_verification_verdict(
    body: VerificationVerdictRequest,
    service: VerificationService = Depends(get_verification_service),
) -> IngestionResponse:
    """
    Write a manual Phase 3 quality verdict to a PhoneNumber row.

    Delegates entirely to `VerificationService.update_verification_verdict()`,
    which atomically updates:
        - `verification_status`  → body.status
        - `verification_source`  → "manual" (hardcoded for this endpoint)
        - `verification_reason`  → body.reason
        - `verified_at`          → utcnow()
        - `extra_data`           → merged with body.extra_metadata (if provided)

    The `verification_source` is always "manual" for verdicts submitted through
    this endpoint, distinguishing them from automated verdicts written by the
    VerificationEngine background job.

    Args:
        body    (VerificationVerdictRequest): Validated verdict payload.
        service (VerificationService):        Injected via FastAPI Depends.

    Returns:
        IngestionResponse: The updated PhoneNumber row with Phase 3 block populated.

    Raises:
        HTTPException 404: phone_id not found.
    """
    try:
        updated_phone = service.update_verification_verdict(
            phone_id=body.phone_id,
            status=body.status,
            source="manual",
            reason=body.reason,
            extra_metadata=body.extra_metadata,
        )
    except PhoneNumberNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return IngestionResponse.model_validate(updated_phone)
