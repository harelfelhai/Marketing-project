"""
repositories/mongo_repository.py — MongoDB implementation.

Codes against the pymongo *collection* surface (`insert_one`, `find`,
`replace_one`, …). In production the collection comes from a real
`pymongo.MongoClient`; in tests it comes from an in-memory `mongomock`
client — the two share the same API, so no `mongod` is needed to exercise
this code.

Translates the storage-agnostic filter DSL (see repositories/base.py) into a
Mongo query document and returns domain model instances, so a service that
talks to this repository is identical to one talking to SqlRepository.

Transaction note: unlike SQL savepoints, multi-document atomicity on Mongo
requires a replica set and is unavailable under mongomock. Per-document
inserts with per-row error handling (the bulk-ingestion "partial success"
contract) are implemented at the service layer rather than relying on nested
transactions.
"""

from __future__ import annotations

import re
from typing import Optional, Type, TypeVar

from repositories.base import Repository, normalise_clause
from repositories.serialization import from_document, to_document

T = TypeVar("T")


class MongoRepository(Repository[T]):
    def __init__(self, collection, model: Type[T]) -> None:
        # `collection` is a pymongo / mongomock Collection.
        self.collection = collection
        self.model = model

    # ------------------------------------------------------------------
    # Filter translation
    # ------------------------------------------------------------------

    @staticmethod
    def _clause(op: str, operand):
        if op == "eq":
            return operand
        if op == "ne":
            return {"$ne": operand}
        if op == "in":
            return {"$in": list(operand)}
        if op == "nin":
            return {"$nin": list(operand)}
        if op == "gt":
            return {"$gt": operand}
        if op == "gte":
            return {"$gte": operand}
        if op == "lt":
            return {"$lt": operand}
        if op == "lte":
            return {"$lte": operand}
        if op == "contains":
            return {"$regex": re.escape(str(operand)), "$options": "i"}
        raise AssertionError(f"unreachable op {op}")  # normalise_clause guards this

    def _query(self, where: Optional[dict]) -> dict:
        if not where:
            return {}
        query: dict = {}
        for field, raw in where.items():
            op, operand = normalise_clause(raw)
            # `id` maps to the Mongo `_id` identity field.
            key = "_id" if field == "id" else field
            query[key] = self._clause(op, operand)
        return query

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def get(self, id: str) -> Optional[T]:
        doc = self.collection.find_one({"_id": id})
        return from_document(doc, self.model) if doc else None

    def list(
        self,
        where: Optional[dict] = None,
        *,
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: Optional[int] = None,
    ) -> list[T]:
        cursor = self.collection.find(self._query(where))
        if order_by is not None:
            key = "_id" if order_by == "id" else order_by
            cursor = cursor.sort(key, -1 if descending else 1)
        if limit is not None:
            cursor = cursor.limit(limit)
        return [from_document(doc, self.model) for doc in cursor]

    def count(self, where: Optional[dict] = None) -> int:
        return int(self.collection.count_documents(self._query(where)))

    def add(self, obj: T) -> T:
        self.collection.insert_one(to_document(obj))
        return obj

    def update(self, obj: T) -> T:
        doc = to_document(obj)
        self.collection.replace_one({"_id": doc["_id"]}, doc, upsert=True)
        return obj

    def delete(self, id: str) -> None:
        self.collection.delete_one({"_id": id})
