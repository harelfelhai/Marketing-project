"""
app/api/v1/router.py — Aggregates all v1 endpoint routers under /api/v1.

This module is the single registration point for the entire v1 API surface.
`main.py` mounts this router once; the individual domain routers are composed
here. Adding a new domain in the future requires only a new include_router
call in this file.

DOMAIN LAYOUT (15 endpoints total):
    Domain A  — /schema/lead-form, /ingest
    Domain B  — /actions/trigger, /phones/{id} PATCH, /actions/retry-now/{id}
    Domain C  — /verification/verdict
    Domain D  — /phones, /phones/{id} GET, /actions/logs, /system/workers/run,
                /dashboard/metrics
    Domain E  — /tasks, /tasks/{id} GET, /tasks POST, /tasks/{id}/resolve (Phase DX)
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    actions,
    auth,
    dashboard,
    entities,
    ingestion,
    notifications,
    phones,
    schema,
    system,
    tasks,
    verification,
)

router = APIRouter()

# Domain A — UI Schema & Ingestion Gateway (Phase 1)
router.include_router(schema.router, prefix="/schema", tags=["Schema"])
router.include_router(ingestion.router, prefix="", tags=["Ingestion"])

# Domain B — Execution & Recovery (Phase 2)
router.include_router(actions.router, prefix="/actions", tags=["Actions"])
router.include_router(phones.router, prefix="/phones", tags=["Phones"])

# Domain C — Quality Audit (Phase 3)
router.include_router(verification.router, prefix="/verification", tags=["Verification"])

# Domain D — Queries, Monitoring & System Controls
router.include_router(system.router, prefix="/system", tags=["System"])
router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])

# Domain E — Operations Task Queue (Phase DX)
router.include_router(tasks.router, prefix="/tasks", tags=["Tasks"])

# Domain G — Entity Ingestion (Phase E2)
router.include_router(entities.router, prefix="/entities", tags=["Entities"])

# Domain H — Chat Notifications (Phase NOTIF)
router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])

# Domain I — Auth (Phase AUTH)
router.include_router(auth.router, prefix="/auth", tags=["Auth"])
