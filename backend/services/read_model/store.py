"""
services/read_model/store.py — frozen in-memory snapshot of all rows.

Holds every Entity, PhoneNumber, and PipelineTask read from the DB, plus
secondary indexes so the list endpoints can filter and join in O(1) / O(n)
Python instead of issuing repeated DB queries.

The store is rebuilt atomically (reference swap). Python's GIL guarantees
that the assignment `manager._store = new_store` is atomic, so readers
always see a complete, consistent snapshot — never a half-built one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class ReadModelStore:
    # Primary dicts — O(1) lookup by id.
    entities_by_id:   Dict[str, object]   # Entity
    phones_by_id:     Dict[str, object]   # PhoneNumber
    tasks_by_id:      Dict[str, object]   # PipelineTask

    # Secondary indexes for join operations.
    phones_by_entity: Dict[str, List[object]]  # entity_id → [PhoneNumber]
    entities_by_root: Dict[str, List[object]]  # root_id   → [root Entity, ...members]
    tasks_by_entity:  Dict[str, List[object]]  # entity_id → [PipelineTask]

    # Flat lists for full-scan operations (list endpoints).
    # NOT pre-sorted — each endpoint sorts by its own key.
    all_entities: List[object]  # Entity
    all_phones:   List[object]  # PhoneNumber
    all_tasks:    List[object]  # PipelineTask

    @classmethod
    def empty(cls) -> ReadModelStore:
        return cls(
            entities_by_id={}, phones_by_id={}, tasks_by_id={},
            phones_by_entity={}, entities_by_root={}, tasks_by_entity={},
            all_entities=[], all_phones=[], all_tasks=[],
        )
