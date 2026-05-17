from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./app.db"

    # Module paths — override these env vars to inject internal implementations
    ingestion_module: str = "modules.mock_ingestion"
    dispatcher_module: str = "modules.mock_dispatcher"
    feedback_module: str = "modules.mock_feedback"

    # Scheduler intervals (seconds)
    ingestion_interval_seconds: int = 60
    feedback_interval_seconds: int = 120


settings = Settings()
