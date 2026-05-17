"""
config.py — Application-wide settings via environment variables.

All injectable module paths are defined here. To swap in a proprietary
internal implementation, an engineer only needs to set the corresponding
environment variable — no source code changes required.

Environment variables can be provided via a `.env` file at the project root
or injected directly into the process environment (e.g. via Docker, K8s secrets).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central configuration object loaded from environment variables.

    Each field maps directly to an env var of the same name (uppercased).
    Pydantic-settings handles type coercion and validation automatically.

    Injectable Module Convention
    ----------------------------
    The three `*_module` fields follow Python's dotted-module path format
    (e.g. "modules.mock_ingestion"). The named module MUST export a class
    with the exact name specified in `dependencies.py` (e.g. `IngestionEngine`).
    The class MUST subclass the corresponding abstract interface in `interfaces/`.

    Example override for internal deployment:
        INGESTION_MODULE=company.proprietary.lead_engine
        DISPATCHER_MODULE=company.proprietary.campaign_dispatcher
        FEEDBACK_MODULE=company.proprietary.conversion_checker
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # silently ignore unknown env vars
    )

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------

    database_url: str = "sqlite:///./app.db"
    """
    SQLAlchemy-compatible connection string.
    Default: local SQLite file for development.
    Internal deployment: replace with PostgreSQL/MySQL DSN.
    """

    # ------------------------------------------------------------------
    # Injectable Module Paths
    # ------------------------------------------------------------------
    # IMPORTANT FOR INTERNAL ENGINEERS:
    # Each variable below points to a Python module that contains the
    # concrete implementation of one of the three core pipeline stages.
    # Set these env vars in your deployment environment to inject your
    # proprietary implementations without touching this codebase.

    ingestion_module: str = "modules.mock_ingestion"
    """
    Dotted path to the module containing `IngestionEngine`.
    Must implement: interfaces.ingestion.BaseIngestionEngine
    """

    dispatcher_module: str = "modules.mock_dispatcher"
    """
    Dotted path to the module containing `CampaignDispatcher`.
    Must implement: interfaces.dispatcher.BaseCampaignDispatcher
    """

    feedback_module: str = "modules.mock_feedback"
    """
    Dotted path to the module containing `FeedbackChecker`.
    Must implement: interfaces.feedback.BaseFeedbackChecker
    """

    # ------------------------------------------------------------------
    # Scheduler Intervals
    # ------------------------------------------------------------------

    ingestion_interval_seconds: int = 60
    """How often (in seconds) the automated ingestion job runs."""

    feedback_interval_seconds: int = 120
    """How often (in seconds) the feedback/conversion-check job runs."""


# Module-level singleton — import this object everywhere settings are needed.
# Do NOT instantiate Settings() again elsewhere; always use this shared instance.
settings = Settings()
