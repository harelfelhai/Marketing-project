"""
repositories/sql_repository.py — SQLAlchemy/SQLModel implementation.

Wraps a SQLModel `Session` and one model class. Translates the storage-
agnostic filter DSL (see repositories/base.py) into SQLAlchemy conditions
and returns domain model instances — the same instances the service layer
already works with, so migrating a service onto this repository is a
behaviour-preserving change.
"""

from __future__ import annotations

from typing import Optional, Type, TypeVar

from sqlalchemy import func
from sqlmodel import Session, select

from repositories.base import Repository, normalise_clause
from repositories.cache import bump_data_version

T = TypeVar("T")


class SqlRepository(Repository[T]):
    def __init__(self, session: Session, model: Type[T]) -> None:
        self.session = session
        self.model = model

    # ------------------------------------------------------------------
    # Filter translation
    # ------------------------------------------------------------------

    def _condition(self, field: str, op: str, operand):
        col = getattr(self.model, field)
        if op == "eq":
            return col.is_(None) if operand is None else col == operand
        if op == "ne":
            return col.isnot(None) if operand is None else col != operand
        if op == "in":
            return col.in_(list(operand))
        if op == "nin":
            return col.notin_(list(operand))
        if op == "gt":
            return col > operand
        if op == "gte":
            return col >= operand
        if op == "lt":
            return col < operand
        if op == "lte":
            return col <= operand
        if op == "contains":
            return col.ilike(f"%{operand}%")
        raise AssertionError(f"unreachable op {op}")  # normalise_clause guards this

    def _conditions(self, where: Optional[dict]):
        if not where:
            return []
        out = []
        for field, raw in where.items():
            op, operand = normalise_clause(raw)
            out.append(self._condition(field, op, operand))
        return out

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def get(self, id: str) -> Optional[T]:
        return self.session.get(self.model, id)

    def list(
        self,
        where: Optional[dict] = None,
        *,
        order_by: Optional[str] = None,
        descending: bool = False,
        limit: Optional[int] = None,
    ) -> list[T]:
        stmt = select(self.model)
        for cond in self._conditions(where):
            stmt = stmt.where(cond)
        if order_by is not None:
            col = getattr(self.model, order_by)
            stmt = stmt.order_by(col.desc() if descending else col.asc())
        if limit is not None:
            stmt = stmt.limit(limit)
        return list(self.session.exec(stmt).all())

    def count(self, where: Optional[dict] = None) -> int:
        stmt = select(func.count()).select_from(self.model)
        for cond in self._conditions(where):
            stmt = stmt.where(cond)
        return int(self.session.exec(stmt).one())

    def add(self, obj: T) -> T:
        self.session.add(obj)
        self.session.commit()
        self.session.refresh(obj)
        bump_data_version()
        return obj

    def update(self, obj: T, *, commit: bool = True) -> T:
        self.session.add(obj)
        if commit:
            self.session.commit()
            self.session.refresh(obj)
            bump_data_version()
        # commit=False: leave the row staged in the unit-of-work so the
        # caller's outer transaction (or savepoint) owns the flush + commit.
        return obj

    def delete(self, id: str) -> None:
        obj = self.session.get(self.model, id)
        if obj is not None:
            self.session.delete(obj)
            self.session.commit()
            bump_data_version()
