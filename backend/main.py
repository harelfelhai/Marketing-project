"""
main.py — FastAPI application factory and entry point.

This module creates the FastAPI app instance, registers middleware,
mounts all API routers, and wires up startup/shutdown lifecycle hooks.

Running the server:
    cd backend/
    uvicorn main:app --reload --port 8000

The `--reload` flag enables hot-reloading for development. Remove it
in production and use a process manager (e.g. gunicorn + uvicorn workers).
"""

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from database import create_db_and_tables
from repositories.api_repository import ApiBackendError

# ------------------------------------------------------------------
# App Instance
# ------------------------------------------------------------------

app = FastAPI(
    title="Marketing Automation Pipeline",
    version="0.1.0",
    description=(
        "A generic, secrets-free marketing automation backend. "
        "All business logic is injected at runtime via environment variables. "
        "See `dependencies.py` and `config.py` for the injection points."
    ),
)

# ------------------------------------------------------------------
# Middleware
# ------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    # Allow requests from the Vite dev server during development.
    # In production, replace this with the actual frontend origin(s).
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------
# Exception handlers
# ------------------------------------------------------------------

@app.exception_handler(ApiBackendError)
def _api_backend_error_handler(_request: Request, exc: ApiBackendError) -> JSONResponse:
    """
    Map a remote-API failure (unreachable / non-2xx / not configured) to 503.

    Only reachable when the storage backend is 'api'. The SQL/Mongo paths never
    raise this, so this handler is a no-op for the default deployment.
    """
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": f"Storage backend (api) unavailable: {exc}"},
    )


# ------------------------------------------------------------------
# Lifecycle Hooks
# ------------------------------------------------------------------

@app.on_event("startup")
def on_startup() -> None:
    """
    Runs once when the application process starts.

    Responsibilities:
        1. Create all database tables (idempotent — safe to run on existing DB).

    IMPORTANT FOR INTERNAL ENGINEERS:
        If you add new SQLModel table models, import them here (or in a
        dedicated models/__init__.py) BEFORE `create_db_and_tables()` is
        called, so SQLModel's metadata registry picks them up.

    Returns:
        None
    """
    # Model imports must happen before create_db_and_tables() so that
    # SQLModel.metadata is populated with all table definitions.
    # The `models` package re-exports every table class from its
    # __init__.py, so a single import is enough.
    import models  # noqa: F401  (side-effect import — registers tables)

    create_db_and_tables()

    # Phase AUTH — reconcile static admins.json into the user table.
    # Runs once per boot. Failure modes (file missing, malformed) are
    # logged but do not crash the app — see services/admin_sync.py for
    # the documented behavior.
    from database import get_session
    from services.admin_sync import sync_admins
    db = next(get_session())
    try:
        sync_admins(session=db)

        # Warm the read cache once at boot so the first Client Hub load is
        # already served from memory (the "load the DB at startup" request).
        # Best-effort: a warm failure must never block startup.
        from config import settings as _settings
        if _settings.read_cache_enabled:
            try:
                from dependencies import get_storage
                from services.read_models import ClientReadModelService
                ClientReadModelService(storage=get_storage(session=db)).list_clients()
            except Exception:  # noqa: BLE001 — warming is optional
                pass
    finally:
        db.close()

    # Phase RM — start the in-memory ReadModelStore.
    # Three table scans execute synchronously so the first request is already
    # served from memory.  Background polling (every 120 s) keeps the store
    # fresh for external changes.  Best-effort: a failure here never blocks
    # startup.
    try:
        from services.read_model.manager import read_model_manager
        read_model_manager.start()
    except Exception:  # noqa: BLE001
        pass

# ------------------------------------------------------------------
# Routers — Milestone 4: v1 API
# ------------------------------------------------------------------

from app.api.v1.router import router as v1_router

app.include_router(v1_router, prefix="/api/v1")

# ------------------------------------------------------------------
# Health Check
# ------------------------------------------------------------------

@app.get("/health", tags=["Health"])
def health() -> dict:
    """
    Liveness probe endpoint.

    Returns a simple JSON object indicating the service is running.
    Used by load balancers, container orchestrators, and monitoring tools.

    Returns:
        dict: `{"status": "ok"}`
    """
    return {"status": "ok"}
