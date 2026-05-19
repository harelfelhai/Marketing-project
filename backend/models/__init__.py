"""
models package — Centralised re-exports of all SQLModel table classes.

Importing `models` (or any of these names from `models`) is enough to
register every table with SQLModel's metadata registry. The startup
hook in `main.py` imports this package precisely for that side-effect,
so that `SQLModel.metadata.create_all(engine)` can see all tables.

INTERNAL HOOK POINT
-------------------
If you add a new table model:
    1. Create the file under `backend/models/your_model.py`.
    2. Add the class import to this file.
    3. The startup hook in main.py will pick it up automatically.
"""

from models.entity import Entity
from models.phone_number import PhoneNumber
from models.action_log import ActionLog
from models.pipeline_task import PipelineTask
from models.notification import NotificationSubscription, NotificationDelivery
from models.user import User, Session

__all__ = [
    "Entity",
    "PhoneNumber",
    "ActionLog",
    "PipelineTask",
    "NotificationSubscription",
    "NotificationDelivery",
    "User",
    "Session",
]
