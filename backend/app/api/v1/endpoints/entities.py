"""
app/api/v1/endpoints/entities.py — Phase E2: Entity Ingestion Channels.

Endpoints:
    POST /api/v1/entities — Single-entry creation of one Entity row (the
                            "+ Add Person" modal's Tab 1).

    (Bulk-text and bulk-upload channels for Phase E2-B / E2-C will be
    appended to this router in subsequent PRs.)

PURPOSE
-------
The entity-centric ingestion path complements the phone-centric path:
operators discover an individual (family member, colleague, etc.) who
matters to a Target Client BEFORE finding their phone number, and need
a way to persist that person so the system's scraping and framing
layers can hunt for their numbers asynchronously.

This router only handles HTTP concerns: request validation, dependency
injection, exception translation, and response serialization. All
business logic lives in `EntityIngestionService`.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_entity_ingestion_service
from exceptions import TargetNotFoundError
from schemas.entity_ingestion import EntitySingleCreateIn, EntitySingleCreateOut
from services.entity_ingestion import EntityIngestionService

router = APIRouter()


@router.post(
    "",
    response_model=EntitySingleCreateOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a single named Entity associated with a root target",
    description=(
        "Creates one Entity row representing a named individual (family "
        "member, friend, colleague, or spouse of a root target). The "
        "row's `client_id` is INHERITED from the target — it is not "
        "accepted on the request — which prevents partition drift "
        "between a target and its associated entities."
        "\n\n"
        "Names (`first_name`, `last_name`) are stored inside the opaque "
        "`Entity.extra_data` JSON blob per the Secrets-Free Mandate; "
        "they never land on schema-level columns. The response echoes "
        "the names back so the operator-facing success panel can "
        "render the confirmation chip and seed the follow-on phone "
        "ingestion modal without a second round-trip."
        "\n\n"
        "**Validation errors → 422:**\n"
        "- `target_entity_id` does not exist.\n"
        "- `target_entity_id` points at a non-root entity (its own "
        "`target_entity_id` is non-NULL).\n"
        "- `relation_type` is outside the operator-creatable subset "
        "(`family`, `friend`, `colleague`, `spouse`).\n"
        "- `first_name` is empty or longer than 80 characters."
    ),
)
def create_single_entity(
    payload: EntitySingleCreateIn,
    service: EntityIngestionService = Depends(get_entity_ingestion_service),
) -> EntitySingleCreateOut:
    """
    Translate the request payload, delegate to the service, and shape
    the response for the friction-free UX chain.

    The response carries everything the frontend needs to immediately
    open the phone-ingestion modal pre-filled with the new person's
    target and relation context: `id`, `client_id`, `target_entity_id`,
    and `relation_type`. Names are echoed for the success chip.

    Args:
        payload (EntitySingleCreateIn): Validated request body.
        service (EntityIngestionService): Injected via FastAPI Depends.

    Returns:
        EntitySingleCreateOut: The newly created entity, shaped for the
        friction-free UX chain.

    Raises:
        HTTPException 422: target validation failed (see endpoint
        description for the exact triggers).
    """
    try:
        new_entity = service.create_single(
            first_name=payload.first_name,
            last_name=payload.last_name,
            # `relation_type` is the AssociatedRelationType enum on the
            # Pydantic model. Pass `.value` so the service receives a
            # plain string (the same shape `Entity.entity_type` stores).
            relation_type=payload.relation_type.value,
            target_entity_id=payload.target_entity_id,
            extra_data=payload.extra_data,
        )
    except TargetNotFoundError as exc:
        # Target missing OR target is not a root — both map to 422 per
        # the Phase E1 / E2 contract that request-shape errors return
        # 422, not 404 (the legacy /ingest endpoint returns 404 here,
        # but that contract predates the bulk family).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # The service merged the names into extra_data; pull them back out
    # for the response so the frontend doesn't have to dig into the
    # opaque blob. `extra_data` is guaranteed to be a dict here because
    # the service always merges at least the first_name key in.
    extra = new_entity.extra_data or {}
    return EntitySingleCreateOut(
        id=new_entity.id,
        client_id=new_entity.client_id,
        relation_type=new_entity.entity_type,
        target_entity_id=new_entity.target_entity_id,
        first_name=extra.get("first_name", payload.first_name),
        last_name=extra.get("last_name"),
        created_at=new_entity.created_at,
    )
