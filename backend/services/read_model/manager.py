"""
services/read_model/manager.py — process-wide ReadModelManager singleton.

Lifecycle
---------
1. On startup  : main.py calls `read_model_manager.start()`, which loads the
                 initial store synchronously (so the first request hits memory,
                 not the DB) and then starts a background daemon thread that
                 reloads every POLL_INTERVAL_S seconds.

2. On any write: every mutating endpoint calls `read_model_manager.reload()`
                 immediately after the DB commit.  The reload issues 3 table
                 scans, builds the new store, and atomically swaps the
                 reference.  Subsequent reads see the fresh data with no DB
                 round-trip.

3. Background  : The daemon thread polls every 120 s.  This is the safety net
                 for changes made outside this process (migrations, direct DB
                 edits).  Conservative choice: no trust in updated_at from
                 external systems, no DB triggers needed.

Thread safety
-------------
`self._store` is a plain Python reference.  Python's GIL makes a single
reference assignment atomic, so readers calling `manager.store` always get
a complete, consistent snapshot — never a half-built object.
"""

from __future__ import annotations

import logging
import threading
import time

from services.read_model.store import ReadModelStore

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 120


def _build_store(storage) -> ReadModelStore:
    """
    Three table scans → ReadModelStore.  All rows (including soft-deleted)
    are loaded so the admin "include_deleted" views also hit only memory.
    """
    entities = storage.entities.list({})
    phones   = storage.phones.list({})
    tasks    = storage.tasks.list({})

    entities_by_id: dict = {e.id: e for e in entities}
    phones_by_id:   dict = {p.id: p for p in phones}
    tasks_by_id:    dict = {t.id: t for t in tasks}

    phones_by_entity: dict = {}
    for p in phones:
        phones_by_entity.setdefault(p.entity_id, []).append(p)

    entities_by_root: dict = {}
    for e in entities:
        root_id = e.target_entity_id if e.target_entity_id else e.id
        entities_by_root.setdefault(root_id, []).append(e)

    tasks_by_entity: dict = {}
    for t in tasks:
        if t.entity_id:
            tasks_by_entity.setdefault(t.entity_id, []).append(t)

    return ReadModelStore(
        entities_by_id=entities_by_id,
        phones_by_id=phones_by_id,
        tasks_by_id=tasks_by_id,
        phones_by_entity=phones_by_entity,
        entities_by_root=entities_by_root,
        tasks_by_entity=tasks_by_entity,
        all_entities=entities,
        all_phones=phones,
        all_tasks=tasks,
    )


class ReadModelManager:
    """Owns the singleton ReadModelStore and the background reload thread."""

    def __init__(self) -> None:
        self._store: ReadModelStore = ReadModelStore.empty()
        self._lock   = threading.Lock()
        self._started  = False
        self._disabled = False  # set True in tests to make start() a no-op

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    @property
    def started(self) -> bool:
        return self._started

    def disable_for_tests(self) -> None:
        """
        Called by the test autouse fixture.  Makes start() a no-op so the
        manager never reads from the production DB during tests.  Endpoints
        fall back to the DB path (which respects FastAPI dependency overrides).
        """
        self._disabled = True
        self._started  = False
        self._store    = ReadModelStore.empty()

    def start(self) -> None:
        """
        Load the initial store and start background polling.
        Called once from main.py on_startup; safe to call more than once.
        """
        if self._disabled:
            return
        with self._lock:
            if self._started:
                return
            self._started = True

        try:
            self._reload()
            logger.info(
                "ReadModelManager: initial load complete — %d entities, %d phones, %d tasks",
                len(self._store.entities_by_id),
                len(self._store.phones_by_id),
                len(self._store.tasks_by_id),
            )
        except Exception:
            logger.exception("ReadModelManager: initial load failed — store stays empty")

        t = threading.Thread(
            target=self._poll_loop, daemon=True, name="read-model-poller"
        )
        t.start()

    def reload(self) -> None:
        """
        Write-through hook.  Call after any API write (ingest, patch,
        delete, restore) to keep the store fresh for subsequent reads.
        Best-effort: a reload failure does NOT roll back the write.

        Skipped for the 'api' storage backend: a synchronous reload there means
        3 full-table GETs over HTTP on the request path after every write. The
        120s background poll keeps the store fresh instead, so reads may lag a
        write by up to one poll interval on the api backend (documented
        tradeoff). SQL/Mongo are unaffected.
        """
        try:
            from dependencies import _resolve_storage_backend
            if _resolve_storage_backend() == "api":
                return
        except Exception:
            pass
        try:
            self._reload()
        except Exception:
            logger.exception("ReadModelManager: write-through reload failed")

    @property
    def store(self) -> ReadModelStore:
        """Return the current store snapshot.  Safe to call from any thread."""
        return self._store

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _poll_loop(self) -> None:
        while True:
            time.sleep(_POLL_INTERVAL_S)
            try:
                self._reload()
                logger.debug(
                    "ReadModelManager: background reload complete — %d entities",
                    len(self._store.entities_by_id),
                )
            except Exception:
                logger.exception("ReadModelManager: background reload failed")

    def _reload(self) -> None:
        """Full 3-table scan, builds new store, atomically swaps reference."""
        from database import get_session
        from dependencies import get_storage

        db = next(get_session())
        try:
            storage = get_storage(session=db)
            new_store = _build_store(storage)
        finally:
            db.close()

        self._store = new_store  # GIL-safe atomic reference swap


# Module-level singleton — import this everywhere.
read_model_manager = ReadModelManager()
