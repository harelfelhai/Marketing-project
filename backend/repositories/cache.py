"""
repositories/cache.py — process-wide, version-invalidated read cache.

Addresses the performance request: instead of every read re-querying the DB,
read projections (the unified client read-model, and any future read path)
memoise their result here and serve it until the data actually changes.

Invalidation is EXACT, not time-based. Every write through the repository
layer calls `bump_data_version()`, advancing a monotonic counter. A cached
entry records the version it was computed at; a read returns it only while
that version is still current, otherwise it recomputes. So a cache hit is
guaranteed fresh within the process — strictly better than a periodic
refetch, and it is the "smartly update when the backend changes" behaviour
the request describes.

Scope & limitations
--------------------
- Process-wide singleton. Under multiple worker processes each has its own
  cache + version; a write in one worker doesn't invalidate another's cache
  until that worker also writes (or restarts). For the single-worker
  deployments this targets that is exact; multi-worker setups should front
  this with a shared invalidation signal (out of scope here).
- Values are treated as immutable by convention — read projections return
  fresh dicts that callers serialize but never mutate.
"""

from __future__ import annotations

import threading
from typing import Callable

_lock = threading.Lock()
_version = 0
_store: dict[str, tuple[int, object]] = {}


def bump_data_version() -> None:
    """Advance the data version. Called by every repository write."""
    global _version
    with _lock:
        _version += 1


def current_data_version() -> int:
    return _version


def cached(key: str, compute: Callable[[], object]) -> object:
    """
    Return the memoised value for `key` if it was computed at the current
    data version; otherwise call `compute()`, store, and return it.

    The version is captured BEFORE computing so that a write landing during
    the computation invalidates the just-stored entry on the next read
    (it will be stored against the older version), keeping reads honest.
    """
    v = _version
    hit = _store.get(key)
    if hit is not None and hit[0] == v:
        return hit[1]
    value = compute()
    with _lock:
        _store[key] = (v, value)
    return value


def reset() -> None:
    """Clear the cache and zero the version. Used by tests for isolation."""
    global _version, _store
    with _lock:
        _version = 0
        _store = {}
