import importlib
from config import settings


def _load_class(module_path: str, class_name: str):
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def get_ingestion_engine():
    cls = _load_class(settings.ingestion_module, "IngestionEngine")
    return cls()


def get_campaign_dispatcher():
    cls = _load_class(settings.dispatcher_module, "CampaignDispatcher")
    return cls()


def get_feedback_checker():
    cls = _load_class(settings.feedback_module, "FeedbackChecker")
    return cls()
