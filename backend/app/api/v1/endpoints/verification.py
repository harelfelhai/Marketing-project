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
    Apply a manual operator verdict to a PhoneNumber row.

    Phase DY-4 — dual-path dispatch.
    --------------------------------
    The endpoint accepts two payload shapes in the SAME contract:

      Legacy single-axis (pre-DY-4 callers):
        { phone_id, status, reason, extra_metadata? }
        → routed to VerificationService.update_verification_verdict()
          which writes verification_status / source / reason / verified_at
          and triggers scoring recalc.

      Two-axis (DY-4 callers):
        { phone_id, phone_axis?, relation_axis?, identification?, ... }
        → routed to VerificationService.apply_two_axis_verdict()
          which writes confidence_score and/or relation severing and/or
          envelope identification atomically.

    The legacy path is triggered when `status` is provided AND no DY-4
    fields are present. Any DY-4 field (phone_axis, relation_axis,
    identification) routes to the new path. Mixed payloads (legacy
    + DY-4 fields) prefer the DY-4 path — internally the legacy axis
    is reconstructed from the two-axis fields.

    Empty submissions (no status, no axes, no identification) raise 422.

    Args:
        body    (VerificationVerdictRequest): Validated verdict payload.
        service (VerificationService):        Injected via FastAPI Depends.

    Returns:
        IngestionResponse: The updated PhoneNumber row.

    Raises:
        HTTPException 404: phone_id not found.
        HTTPException 422: empty submission.
    """
    is_two_axis = (
        body.phone_axis is not None
        or body.relation_axis is not None
        or body.identification is not None
    )

    try:
        if is_two_axis:
            updated_phone = service.apply_two_axis_verdict(
                phone_id=body.phone_id,
                phone_axis=body.phone_axis,
                relation_axis=body.relation_axis,
                identification=body.identification.model_dump() if body.identification else None,
                resolution_note=body.reason,
                extra_metadata=body.extra_metadata,
            )
        elif body.status is not None:
            # Legacy path. `reason` is required when status is supplied.
            updated_phone = service.update_verification_verdict(
                phone_id=body.phone_id,
                status=body.status,
                source="manual",
                reason=body.reason or "",
                extra_metadata=body.extra_metadata,
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Empty verdict submission. Provide at least one of: "
                    "status, phone_axis, relation_axis, identification."
                ),
            )
    except PhoneNumberNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return IngestionResponse.model_validate(updated_phone)
