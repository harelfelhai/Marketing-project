"""
repositories/storage.py — the per-request bundle of repositories.

A `Storage` is a thin container that exposes one Repository per aggregate.
Services receive a `Storage` instead of a `Session` / Mongo client, so the
same service code runs against either backend.

Two concrete builders:

    SqlStorage(session)        — every repo wraps the same SQLModel Session.
    MongoStorage(database)     — every repo wraps a pymongo / mongomock
                                  collection on the same Database.

The active backend is chosen at request boundary (the dependency factory
reads the System Settings file). Behaviour is identical because the
Repository contract + filter DSL are identical.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from models.entity import Entity
from models.notification import NotificationDelivery, NotificationSubscription
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from models.user import Session as UserSession, User
from repositories.api_repository import ApiRepository
from repositories.base import Repository
from repositories.mongo_repository import MongoRepository
from repositories.sql_repository import SqlRepository

if TYPE_CHECKING:
    from sqlmodel import Session


@dataclass
class Storage:
    """One repository per aggregate. Backend-agnostic from the outside."""

    entities: Repository[Entity]
    phones: Repository[PhoneNumber]
    tasks: Repository[PipelineTask]
    users: Repository[User]
    sessions: Repository[UserSession]
    notification_subscriptions: Repository[NotificationSubscription]
    notification_deliveries: Repository[NotificationDelivery]


def SqlStorage(session: "Session") -> Storage:
    """Build a Storage whose repos all wrap the given SQLModel Session."""
    return Storage(
        entities=SqlRepository(session, Entity),
        phones=SqlRepository(session, PhoneNumber),
        tasks=SqlRepository(session, PipelineTask),
        users=SqlRepository(session, User),
        sessions=SqlRepository(session, UserSession),
        notification_subscriptions=SqlRepository(session, NotificationSubscription),
        notification_deliveries=SqlRepository(session, NotificationDelivery),
    )


# Per-aggregate Mongo collection names. Kept here so the SQL table
# definitions in `models/` stay free of Mongo-isms — this is the single
# place that maps an aggregate to its collection name.
_MONGO_COLLECTIONS = {
    Entity:                   "entity",
    PhoneNumber:              "phone_number",
    PipelineTask:             "pipeline_task",
    User:                     "user",
    UserSession:              "session",
    NotificationSubscription: "notification_subscription",
    NotificationDelivery:     "notification_delivery",
}


def MongoStorage(database) -> Storage:
    """
    Build a Storage whose repos all bind to collections on the given Mongo
    Database (a pymongo Database in prod, a mongomock Database in tests).
    """
    def _repo(model):
        return MongoRepository(database[_MONGO_COLLECTIONS[model]], model)
    return Storage(
        entities=_repo(Entity),
        phones=_repo(PhoneNumber),
        tasks=_repo(PipelineTask),
        users=_repo(User),
        sessions=_repo(UserSession),
        notification_subscriptions=_repo(NotificationSubscription),
        notification_deliveries=_repo(NotificationDelivery),
    )


# Per-aggregate default "table" keys for the HTTP/REST backend. Identical to
# the Mongo collection names so a config written once lines up across backends;
# an admin overrides the actual endpoint path per table via `field`/`path` in
# the api_backend config (these are only the lookup keys + default paths).
_API_TABLE_KEYS = dict(_MONGO_COLLECTIONS)


def ApiStorage(config: dict) -> Storage:
    """
    Build a Storage whose repos all talk to a remote HTTP/REST API described by
    the `api_backend` config dict (base_url + per-table descriptors). The shared
    httpx.Client (auth header + timeout) comes from repositories.api_connection.
    """
    from repositories.api_connection import get_api_client

    client = get_api_client()
    base_url = config.get("base_url", "")
    tables = config.get("tables") or {}

    def _repo(model):
        key = _API_TABLE_KEYS[model]
        desc = tables.get(key) or {}
        return ApiRepository(
            client,
            base_url,
            model,
            path=str(desc.get("path") or key),
            rows_path=desc.get("rows_path", ""),
            item_path=desc.get("item_path", ""),
            field_map=desc.get("field_map") or {},
            methods=desc.get("methods") or {},
            path_templates=desc.get("path_templates") or {},
            query_params=desc.get("query_params") or {},
            headers=desc.get("headers") or {},
            body_wrapper=desc.get("body_wrapper") or "",
            pagination=desc.get("pagination") or {},
        )

    return Storage(
        entities=_repo(Entity),
        phones=_repo(PhoneNumber),
        tasks=_repo(PipelineTask),
        users=_repo(User),
        sessions=_repo(UserSession),
        notification_subscriptions=_repo(NotificationSubscription),
        notification_deliveries=_repo(NotificationDelivery),
    )
