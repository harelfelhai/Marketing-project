"""
dependencies.py — Runtime dependency injection via dynamic module loading.

This is the central wiring point of the entire pipeline's pluggability.
Each `get_*` function is a FastAPI dependency (used via `Depends(...)`) that
resolves and instantiates the correct implementation class at request time.

HOW IT WORKS
------------
1. `config.py` holds a dotted Python module path for each pipeline stage
   (e.g. `INGESTION_MODULE=modules.mock_ingestion`).
2. `_load_class()` calls `importlib.import_module()` with that path and
   retrieves the class by name from the loaded module.
3. The FastAPI router receives a fully instantiated object that is guaranteed
   (by the abstract interface contract) to have the expected method signatures.

HOW TO INJECT AN INTERNAL MODULE
---------------------------------
1. Create a new Python package accessible on the PYTHONPATH of your deployment.
2. Inside it, create a class that subclasses the matching abstract interface
   (e.g. `interfaces.ingestion.BaseIngestionEngine`).
3. Set the corresponding env var to the dotted path of your new module
   (e.g. `INGESTION_MODULE=company.proprietary.lead_engine`).
4. Restart the application — no other changes needed.

IMPORTANT: The class name inside the target module MUST match the `class_name`
argument passed to `_load_class()` in each `get_*` function below.
"""

import importlib

from config import settings

# Interface imports are intentionally deferred to each function body below.
# This avoids a circular/missing-module error before M3 interfaces are written.
# Once interfaces/ is populated, you may hoist these to module-level if preferred.


def _load_class(module_path: str, class_name: str):
    """
    Dynamically import a module and retrieve a class from it by name.

    This is the single location where all runtime module swapping happens.
    If the module path or class name is wrong, this will raise a clear
    ImportError or AttributeError at startup/request time.

    Args:
        module_path (str): Dotted Python module path (e.g. "modules.mock_ingestion").
                           Must be importable from the application's PYTHONPATH.
        class_name  (str): The name of the class to retrieve from the module
                           (e.g. "IngestionEngine").

    Returns:
        type: The class object (not an instance). The caller is responsible
              for instantiating it.

    Raises:
        ModuleNotFoundError: If `module_path` cannot be found on PYTHONPATH.
        AttributeError:      If `class_name` does not exist inside the module.
    """
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


# ------------------------------------------------------------------
# Stage 1 — Lead Ingestion
# ------------------------------------------------------------------

def get_ingestion_engine():
    """
    FastAPI dependency: resolves and returns the active IngestionEngine.

    The concrete class is determined by the `INGESTION_MODULE` env var.
    The returned object is guaranteed to implement `BaseIngestionEngine`.

    Used in routers via:
        engine: BaseIngestionEngine = Depends(get_ingestion_engine)

    Returns:
        BaseIngestionEngine: A fresh instance of the configured ingestion class.
            (Return type annotation added in M3 once the interface is defined.)
    """
    # HOOK FOR INTERNAL ENGINEERS:
    # Point INGESTION_MODULE at your proprietary module. The class inside
    # must be named `IngestionEngine` and must subclass BaseIngestionEngine.
    cls = _load_class(settings.ingestion_module, "IngestionEngine")
    return cls()


# ------------------------------------------------------------------
# Stage 2 — Campaign Dispatch
# ------------------------------------------------------------------

def get_campaign_dispatcher():
    """
    FastAPI dependency: resolves and returns the active CampaignDispatcher.

    The concrete class is determined by the `DISPATCHER_MODULE` env var.
    The returned object is guaranteed to implement `BaseCampaignDispatcher`.

    Used in routers via:
        dispatcher: BaseCampaignDispatcher = Depends(get_campaign_dispatcher)

    Returns:
        BaseCampaignDispatcher: A fresh instance of the configured dispatcher class.
            (Return type annotation added in M3 once the interface is defined.)
    """
    # HOOK FOR INTERNAL ENGINEERS:
    # Point DISPATCHER_MODULE at your proprietary module. The class inside
    # must be named `CampaignDispatcher` and must subclass BaseCampaignDispatcher.
    cls = _load_class(settings.dispatcher_module, "CampaignDispatcher")
    return cls()


# ------------------------------------------------------------------
# Stage 3 — Feedback / Conversion Checking
# ------------------------------------------------------------------

def get_feedback_checker():
    """
    FastAPI dependency: resolves and returns the active FeedbackChecker.

    The concrete class is determined by the `FEEDBACK_MODULE` env var.
    The returned object is guaranteed to implement `BaseFeedbackChecker`.

    Used in the APScheduler worker (workers/scheduler.py) — NOT as a
    request-scoped dependency, but called directly inside the scheduled job.

    Returns:
        BaseFeedbackChecker: A fresh instance of the configured feedback class.
            (Return type annotation added in M3 once the interface is defined.)
    """
    # HOOK FOR INTERNAL ENGINEERS:
    # Point FEEDBACK_MODULE at your proprietary module. The class inside
    # must be named `FeedbackChecker` and must subclass BaseFeedbackChecker.
    cls = _load_class(settings.feedback_module, "FeedbackChecker")
    return cls()
