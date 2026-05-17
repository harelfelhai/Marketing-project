"""
app/api/v1/endpoints/system.py — Domain D: System Worker Controls.

Endpoint:
    POST /api/v1/system/workers/run?worker_name=retry|verification

Purpose:
    Allows a technical administrator to immediately trigger one synchronous
    execution cycle of a background worker loop — outside of the APScheduler
    tick. Designed for two operational scenarios:

        - `worker_name=retry`:
            After an external vendor outage is resolved, flush the entire
            scheduled-retry queue without waiting for the next scheduler tick.

        - `worker_name=verification`:
            On-demand batch evaluation of all currently eligible phone numbers.
            Useful for testing, maintenance, and ad-hoc audit runs.

SYNCHRONOUS CONTRACT:
    The endpoint blocks until the worker batch completes. This is intentional —
    the current engine implementations are synchronous and the response carries
    the processed_count for observability. If queue depth grows to a point
    where HTTP timeout becomes a concern, migrate to an async job-queue pattern
    and expose a status-polling endpoint. That is a future problem, not now.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_retry_engine, get_verification_engine
from app.schemas.api_contracts import WorkerRunResponse
from services.dispatcher import RetryEngine
from services.verification import VerificationEngine

router = APIRouter()

_VALID_WORKER_NAMES = ("retry", "verification")


@router.post(
    "/workers/run",
    response_model=WorkerRunResponse,
    summary="Trigger a background worker loop synchronously",
    description=(
        "Runs one execution cycle of the named background worker and returns "
        "a summary of what was processed. Blocks until the batch completes. "
        "\n\n"
        "**`?worker_name=retry`**: Invokes `RetryEngine.process_scheduled_retries()`. "
        "Scans all ActionLog rows in 'scheduled_retry' status with `retry_after <= now`, "
        "claims each atomically, and re-dispatches via the registered handler. "
        "Returns the count of rows successfully re-dispatched. "
        "\n\n"
        "**`?worker_name=verification`**: Invokes `VerificationEngine.process_eligible_numbers()`. "
        "Evaluates all PhoneNumbers that are pending verification and have accumulated "
        "enough Phase 2 history (last sent action older than `verification_window_days`). "
        "Returns the count of numbers successfully evaluated and updated."
    ),
)
def run_worker(
    worker_name: str = Query(
        ...,
        description=(
            "Name of the background worker to run. "
            "Must be 'retry' (RetryEngine) or 'verification' (VerificationEngine)."
        ),
    ),
    retry_engine: RetryEngine = Depends(get_retry_engine),
    verification_engine: VerificationEngine = Depends(get_verification_engine),
) -> WorkerRunResponse:
    """
    Synchronously execute one tick of the specified background worker.

    The `worker_name` parameter selects which engine to invoke:
        - "retry":        `RetryEngine.process_scheduled_retries()`
        - "verification": `VerificationEngine.process_eligible_numbers()`

    Both methods are synchronous and return an integer processed count.
    The endpoint records timestamps immediately before and after execution
    so the caller can observe wall-clock duration.

    Args:
        worker_name        (str):               Must be 'retry' or 'verification'.
        retry_engine       (RetryEngine):       Injected via FastAPI Depends.
        verification_engine (VerificationEngine): Injected via FastAPI Depends.

    Returns:
        WorkerRunResponse: Worker name, processed count, and start/end timestamps.

    Raises:
        HTTPException 422: worker_name is not one of the accepted values.
    """
    if worker_name not in _VALID_WORKER_NAMES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid worker_name '{worker_name}'. "
                f"Accepted values: {_VALID_WORKER_NAMES}."
            ),
        )

    started_at = datetime.utcnow()

    if worker_name == "retry":
        processed_count = retry_engine.process_scheduled_retries()
    else:
        # worker_name == "verification" (already validated above)
        processed_count = verification_engine.process_eligible_numbers()

    completed_at = datetime.utcnow()

    return WorkerRunResponse(
        worker_name=worker_name,
        processed_count=processed_count,
        started_at=started_at,
        completed_at=completed_at,
    )
