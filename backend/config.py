"""
config.py — Application-wide settings via environment variables.

All injectable module paths are defined here. To swap in a proprietary
internal implementation, an engineer only needs to set the corresponding
environment variable — no source code changes required.

Environment variables can be provided via a `.env` file at the project root
or injected directly into the process environment.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Central configuration object loaded from environment variables.

    Each field maps directly to an env var of the same name (uppercased).
    Pydantic-settings handles type coercion and validation automatically.
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
    """

    system_settings_path: str = "system_settings.json"
    """
    Path to the operator-editable system-settings file (System Settings tab).

    Holds runtime-selectable infrastructure choices. Lives OUTSIDE the database
    on purpose: the storage backend choice must be readable at boot regardless
    of which DB is active. Changes take effect on the next reconnect / restart.
    """

    mongo_url: str = "mongodb://localhost:27017"
    """
    MongoDB connection string, used only when the System Settings storage
    backend is set to 'mongo'. Secrets-Free Mandate: supplied via environment
    / secret store on the server, never via the frontend.
    """

    mongo_db_name: str = "marketing"
    """Database name used inside the MongoDB server when storage_backend='mongo'."""

    read_cache_enabled: bool = True
    """
    Enable the process-wide, version-invalidated read cache.
    Set False to bypass (always recompute) — useful when running multiple worker
    processes that don't share an invalidation signal.
    """

    # ------------------------------------------------------------------
    # Injectable Module Paths
    # ------------------------------------------------------------------

    ingestion_module: str = "modules.mock_ingestion"
    """
    Dotted path to the module containing `IngestionRoutingEngine`.
    Must implement: interfaces.ingestion.BaseIngestionRoutingEngine
    """

    feedback_module: str = "modules.mock_feedback"
    """
    Dotted path to the module containing `VerificationStrategy`.
    Must implement: interfaces.verification.BaseVerificationStrategy
    """

    notification_module: str = "modules.mock_chat"
    """
    Dotted path to the module containing `NotificationChannel` (Phase NOTIF).
    Must implement: interfaces.notifications.BaseNotificationChannel.
    """

    # ------------------------------------------------------------------
    # Phase AUTH — admin sync file
    # ------------------------------------------------------------------

    admin_config_path: str = "admins.json"
    """
    Path to the static `admins.json` file (Phase AUTH).
    Read once at startup by `services.admin_sync.sync_admins()`.
    """


# Module-level singleton — import this object everywhere settings are needed.
# Do NOT instantiate Settings() again elsewhere; always use this shared instance.
settings = Settings()
