"""
app/api/v1/endpoints/notifications.py — Phase NOTIF endpoints.

Six endpoints, four CRUD-shaped + one history + one operator smoke fire:

    POST   /api/v1/notifications/subscriptions          create
    GET    /api/v1/notifications/subscriptions          list (filterable)
    GET    /api/v1/notifications/subscriptions/{id}     detail
    PATCH  /api/v1/notifications/subscriptions/{id}     partial update
    DELETE /api/v1/notifications/subscriptions/{id}     hard delete

    GET    /api/v1/notifications/deliveries             audit listing
    POST   /api/v1/notifications/test-fire              smoke fire

The /test-fire endpoint is registered BEFORE the dynamic `/{id}` PATCH
matcher so the literal "/test-fire" never gets captured as an int id.

PRIVACY CONTRACT
----------------
Recipient tokens, channel ids, webhook URLs all flow through as opaque
strings. The router layer never decodes them; the configured channel
module is the only place that interprets.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import (
    get_event_dispatcher,
    get_notification_dispatcher,
    get_notification_subscription_service,
)
from exceptions import NotificationSubscriptionNotFoundError
from schemas.notifications import (
    NotificationDeliveryResponse,
    NotificationSubscriptionCreate,
    NotificationSubscriptionResponse,
    NotificationSubscriptionUpdate,
    TestFireRequest,
)
from services.notifications import (
    EVENT_MANUAL_TEST,
    EventDispatcher,
    NotificationDispatcher,
    NotificationSubscriptionService,
)


router = APIRouter()


# ===========================================================================
# Subscriptions — CRUD
# ===========================================================================


@router.post(
    "/subscriptions",
    response_model=NotificationSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a notification subscription",
    description=(
        "Persists a new alert rule. The service layer validates the "
        "(target_kind, target_id) invariant: target_id must be NULL "
        "when target_kind='global', and required otherwise."
        "\n\n"
        "**422 triggers:** mismatch on the above invariant; "
        "unsupported target_kind; empty recipients list."
    ),
)
def create_subscription(
    body: NotificationSubscriptionCreate,
    service: NotificationSubscriptionService = Depends(get_notification_subscription_service),
) -> NotificationSubscriptionResponse:
    """
    Translate the validated body to the service signature; map
    domain-level ValueError to HTTP 422.
    """
    try:
        sub = service.create(
            trigger_event_type=body.trigger_event_type,
            target_kind=body.target_kind,
            target_id=body.target_id,
            recipients=body.recipients,
            created_by=body.created_by,
            title_template=body.title_template,
            body_template=body.body_template,
            extra_data=body.extra_data,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return NotificationSubscriptionResponse.model_validate(sub)


@router.get(
    "/subscriptions",
    response_model=List[NotificationSubscriptionResponse],
    summary="List notification subscriptions with optional filters",
    description=(
        "Returns subscriptions matching the supplied filters. All "
        "filters are additive (AND). The Task Center / Phone Grid / "
        "Entity-Success panels call this with `target_kind` + "
        "`target_id` to render the live state of the OptIn panel."
    ),
)
def list_subscriptions(
    target_kind: Optional[str] = Query(
        default=None,
        description="Filter by scope. 'phone' | 'entity' | 'task' | 'global'.",
    ),
    target_id: Optional[int] = Query(
        default=None,
        description="Filter by record id (combine with target_kind).",
    ),
    trigger_event_type: Optional[str] = Query(
        default=None,
        description="Filter by event token.",
    ),
    active: Optional[bool] = Query(
        default=None,
        description="Filter by active flag. Omit to include both.",
    ),
    service: NotificationSubscriptionService = Depends(get_notification_subscription_service),
) -> List[NotificationSubscriptionResponse]:
    rows = service.list(
        target_kind=target_kind,
        target_id=target_id,
        trigger_event_type=trigger_event_type,
        active=active,
    )
    return [NotificationSubscriptionResponse.model_validate(r) for r in rows]


# ===========================================================================
# Deliveries (audit history) + Test-fire
#
# Registered BEFORE the dynamic /{id} PATCH so literal segments
# ("deliveries", "test-fire") aren't captured as an int param.
# ===========================================================================


@router.get(
    "/deliveries",
    response_model=List[NotificationDeliveryResponse],
    summary="List notification deliveries (audit history)",
    description=(
        "Returns up to 100 NotificationDelivery rows (newest first), "
        "optionally filtered by subscription or status. Used by "
        "operators to verify alerts actually fired and by managers "
        "diagnosing 'why didn't I get notified' incidents."
    ),
)
def list_deliveries(
    subscription_id: Optional[int] = Query(
        default=None,
        description="Filter to one subscription's history.",
    ),
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        description="Filter by delivery status: 'pending' | 'sent' | 'failed' | 'cancelled'.",
    ),
    service: NotificationSubscriptionService = Depends(get_notification_subscription_service),
) -> List[NotificationDeliveryResponse]:
    rows = service.list_deliveries(
        subscription_id=subscription_id,
        status=status_filter,
        limit=100,
    )
    return [NotificationDeliveryResponse.model_validate(r) for r in rows]


@router.post(
    "/test-fire",
    response_model=NotificationDeliveryResponse,
    summary="Fire a test notification through the configured chat channel",
    description=(
        "Operator-triggered smoke test. Lets a manager validate the "
        "configured chat pipe end-to-end WITHOUT setting up a real "
        "subscription. Lands as a NotificationDelivery row tagged "
        "`trigger_event_type='manual.test'` with `subscription_id=NULL`."
        "\n\n"
        "The response is the persisted delivery row — inspect its "
        "`status` ('sent' vs 'failed') and `last_error` to confirm "
        "the channel actually reached the provider."
    ),
)
def test_fire(
    body: TestFireRequest,
    dispatcher: NotificationDispatcher = Depends(get_notification_dispatcher),
) -> NotificationDeliveryResponse:
    delivery = dispatcher.dispatch(
        trigger_event_type=EVENT_MANUAL_TEST,
        title=body.title,
        body=body.body,
        recipients=body.recipients,
        subscription_id=None,
        metadata=body.metadata,
    )
    return NotificationDeliveryResponse.model_validate(delivery)


# ===========================================================================
# Subscriptions — single-row detail / update / delete
#
# Registered AFTER the literal-path endpoints above so the int converter
# never tries to swallow "deliveries" or "test-fire".
# ===========================================================================


@router.get(
    "/subscriptions/{subscription_id}",
    response_model=NotificationSubscriptionResponse,
    summary="Get one notification subscription by id",
)
def get_subscription(
    subscription_id: int,
    service: NotificationSubscriptionService = Depends(get_notification_subscription_service),
) -> NotificationSubscriptionResponse:
    try:
        sub = service.get(subscription_id)
    except NotificationSubscriptionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return NotificationSubscriptionResponse.model_validate(sub)


@router.patch(
    "/subscriptions/{subscription_id}",
    response_model=NotificationSubscriptionResponse,
    summary="Partially update a notification subscription",
    description=(
        "Applies a partial update. Only non-NULL fields in the body "
        "are written. Trigger / target fields are intentionally NOT "
        "updatable — they define the subscription's identity. To "
        "re-scope: delete + create."
    ),
)
def patch_subscription(
    subscription_id: int,
    body: NotificationSubscriptionUpdate,
    service: NotificationSubscriptionService = Depends(get_notification_subscription_service),
) -> NotificationSubscriptionResponse:
    try:
        sub = service.update(
            subscription_id,
            recipients=body.recipients,
            title_template=body.title_template,
            body_template=body.body_template,
            active=body.active,
            extra_data=body.extra_data,
        )
    except NotificationSubscriptionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return NotificationSubscriptionResponse.model_validate(sub)


@router.delete(
    "/subscriptions/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a notification subscription",
    description=(
        "Hard-delete. Historical NotificationDelivery rows are NOT "
        "cascaded — they remain for audit (subscription_id becomes a "
        "dangling FK that the audit reader tolerates)."
    ),
)
def delete_subscription(
    subscription_id: int,
    service: NotificationSubscriptionService = Depends(get_notification_subscription_service),
) -> None:
    try:
        service.delete(subscription_id)
    except NotificationSubscriptionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return None
