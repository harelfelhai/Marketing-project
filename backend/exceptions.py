"""
exceptions.py — Domain-specific exceptions for the marketing automation pipeline.

All custom exception classes are defined here to keep error semantics
centralised and importable from a single known location.

USAGE PATTERN
-------------
Raise these exceptions inside service and engine classes. Catch them
in FastAPI router handlers and translate them into appropriate HTTP
responses (e.g. TargetNotFoundError → 404, ActionExecutionError → 502).

Example router handler:
    from exceptions import TargetNotFoundError, ActionExecutionError
    from fastapi import HTTPException

    try:
        result = ingestion_service.ingest_circle_member(payload)
    except TargetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ActionExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
"""


class TargetNotFoundError(Exception):
    """
    Raised when an `IngestionPayload` references a `target_phone_number`
    that does not exist in the `PhoneNumber` table.

    Context: The system treats all primary targets as pre-existing records.
    Phase 1 ingestion ONLY appends circle-of-trust members (family, friends)
    to an already-present target. If the lookup fails, ingestion must abort
    cleanly rather than silently creating orphaned entities.

    Attributes:
        target_phone_number (str): The phone number string that was not found.
        message (str): Human-readable error description.

    Example:
        raise TargetNotFoundError(target_phone_number="+14155550001")
    """

    def __init__(self, target_phone_number: str) -> None:
        """
        Initialise the exception with the missing target's phone number.

        Args:
            target_phone_number (str): The raw phone number string that was
                                       looked up but not found in the DB.
        """
        self.target_phone_number = target_phone_number
        message = (
            f"Target phone number '{target_phone_number}' was not found in the "
            "system. All primary targets must be pre-loaded before circle-of-trust "
            "ingestion can proceed."
        )
        super().__init__(message)


class ActionExecutionError(Exception):
    """
    Raised by a `BaseActionHandler.execute()` implementation when an outbound
    action fails in a way that should be recorded on the `ActionLog` row.

    This exception acts as the standardised signal between the concrete handler
    (which knows the vendor-specific failure details) and the `ActionDispatcher`
    (which manages status transitions and retry scheduling).

    Attributes:
        action_type (str): The action type token that failed.
        phone_number (str): The phone number that was the target of the action.
        retryable (bool): Whether the dispatcher should schedule a retry
                          (True → transition to "scheduled_retry") or mark
                          the row as a hard failure (False → transition to "failed").
        detail (str): Machine-readable or vendor-specific error description
                      for logging into `extra_data`.
        message (str): Human-readable error description.

    Example:
        raise ActionExecutionError(
            action_type="advertisement_type_a",
            phone_number="+14155550001",
            retryable=True,
            detail="provider_timeout",
        )
    """

    def __init__(
        self,
        action_type: str,
        phone_number: str,
        retryable: bool = False,
        detail: str = "",
    ) -> None:
        """
        Initialise the exception.

        Args:
            action_type  (str):  The action type token that failed.
            phone_number (str):  The phone number that was the dispatch target.
            retryable    (bool): True if the ActionDispatcher should schedule
                                 a retry. False for hard, unrecoverable failures.
                                 Default: False.
            detail       (str):  Vendor/provider error code or description.
                                 Stored verbatim in ActionLog.extra_data.
                                 Default: "".
        """
        self.action_type = action_type
        self.phone_number = phone_number
        self.retryable = retryable
        self.detail = detail
        retry_hint = "retryable" if retryable else "non-retryable"
        message = (
            f"Action '{action_type}' for phone '{phone_number}' failed "
            f"({retry_hint}): {detail or 'no detail provided'}"
        )
        super().__init__(message)


class PhoneNumberNotFoundError(Exception):
    """
    Raised when a service method receives a `phone_id` or `phone_number`
    that does not exist in the `PhoneNumber` table.

    Distinct from `TargetNotFoundError` — this applies to any DB lookup
    within the dispatcher, verification, or action services, not just the
    target-lookup step of ingestion.

    Attributes:
        identifier (str | int): The phone_id (int) or phone_number (str)
                                 that was not found.

    Example:
        raise PhoneNumberNotFoundError(identifier=42)
    """

    def __init__(self, identifier) -> None:
        """
        Args:
            identifier (int | str): The phone_id or phone_number string that
                                    could not be resolved.
        """
        self.identifier = identifier
        super().__init__(
            f"PhoneNumber with identifier '{identifier}' was not found in the system."
        )


class PipelineTaskNotFoundError(Exception):
    """
    Raised when a service method receives a `task_id` that does not exist in
    the `pipeline_task` table.

    Used by `PipelineTaskService.resolve_task()` and `get_task_with_join()`
    to surface a clean 404 from the API layer instead of leaking an internal
    `None` dereference.

    Attributes:
        task_id (int): The pipeline_task PK that could not be resolved.
    """

    def __init__(self, task_id: int) -> None:
        self.task_id = task_id
        super().__init__(
            f"PipelineTask with id={task_id} was not found in the system."
        )


class UserAlreadyExistsError(Exception):
    """
    Raised when registration is attempted with a username that already
    exists in the `user` table.

    The /auth/register endpoint catches this and returns 409 Conflict.
    The error message intentionally does NOT distinguish "exists" from
    "valid format" — but since this is a guardrail not a security wall,
    we lean toward the friendlier "this username is taken" wording.
    """

    def __init__(self, username: str) -> None:
        self.username = username
        super().__init__(
            f"Username '{username}' is already taken. Choose a different one."
        )


class InvalidCredentialsError(Exception):
    """
    Raised by `AuthService.login()` when either the username doesn't
    exist OR the password verification fails.

    Deliberately non-distinguishing: the endpoint returns the same
    error message for both cases. This isn't a security hardening
    measure (the system is internal-trust); it's just operator
    courtesy — they don't need to know whether they mistyped the
    username or the password.
    """

    def __init__(self) -> None:
        super().__init__("Invalid username or password.")


class NotificationSubscriptionNotFoundError(Exception):
    """
    Raised when a NotificationSubscription lookup by id misses.

    Mirrors PipelineTaskNotFoundError — the API layer catches it and
    translates to 404. The subscription_id is stored on the exception
    so the error message can include it without re-querying.
    """

    def __init__(self, subscription_id: int) -> None:
        self.subscription_id = subscription_id
        super().__init__(
            f"NotificationSubscription with id={subscription_id} was not found "
            "in the system."
        )


class TaskStateTransitionError(Exception):
    """
    Raised when `PipelineTaskService.resolve_task()` is called on a task that
    is already in a terminal state ('resolved' or 'rejected').

    Phase DX deliberately keeps the state machine minimal — once a task is
    settled, it cannot be re-opened or re-settled. Callers must open a new
    task instead.

    Attributes:
        task_id        (int): The pipeline_task PK that was being resolved.
        current_status (str): The terminal status blocking the transition.
    """

    def __init__(self, task_id: int, current_status: str) -> None:
        self.task_id = task_id
        self.current_status = current_status
        super().__init__(
            f"PipelineTask id={task_id} is already in terminal status "
            f"'{current_status}'. Open a new task instead of re-settling this one."
        )
