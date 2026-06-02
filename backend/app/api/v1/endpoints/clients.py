"""
app/api/v1/endpoints/clients.py — the unified client read-model endpoint.

GET /api/v1/clients
    Returns one unified aggregate per client (root entity) — the root, its
    member entities, every phone across the circle, and the metric roll-up.
    This is the "person + their phones" shape the Client Hub consumes in a
    single request, replacing the per-card JOIN / N+1 derivation.

Read-only; authenticated operators (the Hub is part of normal use). The
optional `root_entity_ids` query param narrows to a personalization subset.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_client_read_model_service, require_authenticated_user
from app.schemas.api_contracts import ClientAggregateResponse
from models.user import User
from services.read_models import ClientReadModelService

router = APIRouter()


@router.get(
    "",
    response_model=List[ClientAggregateResponse],
    summary="List unified client aggregates (person + their phones)",
    description=(
        "Returns one aggregate per client: the root entity, its members, all "
        "phones across the circle, and a metric roll-up. Assembled server-side "
        "from two storage reads so the Client Hub fetches one easy shape."
    ),
)
def list_clients(
    root_entity_ids: Optional[list[str]] = Query(default=None),
    include_deleted: bool = Query(default=False),
    _user: User = Depends(require_authenticated_user),
    svc: ClientReadModelService = Depends(get_client_read_model_service),
) -> List[ClientAggregateResponse]:
    return svc.list_clients(root_entity_ids=root_entity_ids, include_deleted=include_deleted)


@router.get(
    "/{root_entity_id}",
    response_model=ClientAggregateResponse,
    summary="One unified client aggregate",
)
def get_client(
    root_entity_id: str,
    include_deleted: bool = Query(default=False),
    _user: User = Depends(require_authenticated_user),
    svc: ClientReadModelService = Depends(get_client_read_model_service),
) -> ClientAggregateResponse:
    view = svc.get_client(root_entity_id, include_deleted=include_deleted)
    if view is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Client {root_entity_id} not found.",
        )
    return view
