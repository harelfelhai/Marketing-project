"""
app/api/v1/router.py — Aggregates all v1 endpoint routers under /api/v1.

This module is the single registration point for the entire v1 API surface.
`main.py` mounts this router once; the individual domain routers are composed
here.

DOMAIN LAYOUT:
    Domain A  — /phones (bulk-text, bulk-upload, quick-attach)
    Domain D  — /phones GET list/detail, /system/*, /dashboard/metrics,
                /clients
    Domain E  — /tasks (Phase DX)
    Domain G  — /entities (Phase E2)
    Domain H  — /notifications (Phase NOTIF)
    Domain I  — /auth (Phase AUTH)
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth,
    clients,
    dashboard,
    entities,
    notifications,
    phones,
    system,
    tasks,
)

router = APIRouter()

# Phones — ingestion + listing + export
router.include_router(phones.router, prefix="/phones", tags=["Phones"])

# System controls & settings
router.include_router(system.router, prefix="/system", tags=["System"])

# Dashboard metrics
router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])

# Unified client read-model
router.include_router(clients.router, prefix="/clients", tags=["Clients"])

# Operations Task Queue (Phase DX)
router.include_router(tasks.router, prefix="/tasks", tags=["Tasks"])

# Entity Ingestion (Phase E2)
router.include_router(entities.router, prefix="/entities", tags=["Entities"])

# Chat Notifications (Phase NOTIF)
router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])

# Auth (Phase AUTH)
router.include_router(auth.router, prefix="/auth", tags=["Auth"])
