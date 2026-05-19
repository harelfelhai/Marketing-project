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

    scoring_module: str = "modules.mock_scoring"
    """
    Dotted path to the module containing `ScoringStrategy` (Phase DY).
    Must implement: interfaces.scoring.BaseScoringStrategy

    Internal teams replace this with their proprietary scoring strategy
    (weight tables + formula). The mock implementation ships a default
    hybrid formula that is workable but generic.
    """

    notification_module: str = "modules.mock_chat"
    """
    Dotted path to the module containing `NotificationChannel`
    (Phase NOTIF). Must implement:
    interfaces.notifications.BaseNotificationChannel.

    The open-source default `mock_chat` logs every delivery to stdout
    and always returns success. Internal teams swap in their Slack /
    Teams / Discord / generic-webhook adapter at deployment time.
    """

    # ------------------------------------------------------------------
    # Phase AUTH — admin sync file
    # ------------------------------------------------------------------

    admin_config_path: str = "admins.json"
    """
    Path to the static `admins.json` file (Phase AUTH).

    Read once at startup by `services.admin_sync.sync_admins()` to
    reconcile admin entries into the `user` table. Path is resolved
    relative to the process working directory — the standard `cd
    backend/ && uvicorn main:app` invocation looks for the file at
    `backend/admins.json`.

    The file is the SOURCE OF TRUTH for which usernames have
    Admin role. Edit + restart to rotate. No API endpoint exists for
    admin creation (that's the safety-via-friction the requirement
    asks for).
    """

    scoring_default_confidence: float = 50.0
    """
    Baseline confidence_score written on every newly-ingested PhoneNumber
    row. Neutral midpoint — new numbers compete on tier and relation
    alone until audited (manual verdict, automated check, or a PATCH
    write). Tunable per deployment via env var.
    """

    # ------------------------------------------------------------------
    # Scheduler Intervals
    # ------------------------------------------------------------------

    ingestion_interval_seconds: int = 60
    """How often (in seconds) the automated ingestion job runs."""

    feedback_interval_seconds: int = 120
    """How often (in seconds) the feedback/conversion-check job runs."""

    # ------------------------------------------------------------------
    # Phase 2 — Retry Policy
    # ------------------------------------------------------------------

    max_retry_count: int = 5
    """
    Upper bound on the number of automated retry attempts per ActionLog row.

    Once `ActionLog.retry_count >= max_retry_count`, the next retryable
    failure transitions the row to terminal `status="failed"` instead of
    scheduling yet another retry. Prevents infinite retry loops against
    a broken external provider.
    """

    retry_backoff_seconds: int = 300
    """
    Default seconds added to `now()` when scheduling a retry.
    Used by ActionDispatcher to set `ActionLog.retry_after`.
    Internal deployments may replace this with an exponential back-off
    by overriding `ActionDispatcher` and computing per-attempt durations.
    """

    # ------------------------------------------------------------------
    # Phase 3 — Verification Eligibility Window
    # ------------------------------------------------------------------

    verification_window_days: int = 7
    """
    Number of days that must elapse after the most recent "sent" ActionLog
    before a `pending` PhoneNumber becomes eligible for the automated
    VerificationEngine. Independent of `feedback_interval_seconds` (which
    governs how often the engine *runs*, not its eligibility window).
    """


# Module-level singleton — import this object everywhere settings are needed.
# Do NOT instantiate Settings() again elsewhere; always use this shared instance.
settings = Settings()
