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
Repository contract + filter DSL are identical (proven by the dual-backend
contract test).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from models.action_log import ActionLog
from models.entity import Entity
from models.notification import NotificationDelivery, NotificationSubscription
from models.phone_number import PhoneNumber
from models.pipeline_task import PipelineTask
from models.user import Session as UserSession, User
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
    action_logs: Repository[ActionLog]
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
        action_logs=SqlRepository(session, ActionLog),
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
    ActionLog:                "action_log",
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
        action_logs=_repo(ActionLog),
        tasks=_repo(PipelineTask),
        users=_repo(User),
        sessions=_repo(UserSession),
        notification_subscriptions=_repo(NotificationSubscription),
        notification_deliveries=_repo(NotificationDelivery),
    )
