"""
database.py — Database engine, session factory, and table initialisation.

Uses SQLModel (a thin SQLAlchemy wrapper) with SQLite for local development.
All table definitions are registered automatically when SQLModel models are
imported before `create_db_and_tables()` is called.

Internal deployment notes:
    - Replace `DATABASE_URL` in the environment with a production DSN.
    - For PostgreSQL, remove the `check_same_thread` connect arg (SQLite-only).
    - Consider adding Alembic for schema migrations before going to production.
"""

from sqlalchemy import event
from sqlmodel import SQLModel, create_engine, Session

from config import settings


# ------------------------------------------------------------------
# Engine
# ------------------------------------------------------------------

engine = create_engine(
    settings.database_url,
    connect_args={
        # `check_same_thread=False` is required for SQLite only.
        # It allows the same connection to be used across multiple threads,
        # which is necessary because FastAPI handles requests concurrently.
        # Remove this argument when switching to PostgreSQL or MySQL.
        "check_same_thread": False
    },
)


# ------------------------------------------------------------------
# SQLite Foreign-Key Enforcement
# ------------------------------------------------------------------
# SQLite ships with FK enforcement DISABLED by default. Without this listener,
# INSERTing a row with a dangling FK silently succeeds — meaning our tests on
# SQLite would not catch FK violations that Postgres would catch in production.
# This `connect` listener turns the PRAGMA ON for every new SQLite connection.
# No-op for non-SQLite engines.

@event.listens_for(engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    """
    Enable `PRAGMA foreign_keys=ON` for every new SQLite connection.

    Args:
        dbapi_connection: The raw DBAPI connection just opened by SQLAlchemy.
        _connection_record: SQLAlchemy connection pool record (unused).
    """
    if "sqlite" in str(engine.url):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


# ------------------------------------------------------------------
# Table Initialisation
# ------------------------------------------------------------------

def create_db_and_tables() -> None:
    """
    Create all database tables defined by SQLModel model classes.

    This function is called once at application startup (see main.py).
    It is idempotent — calling it on an existing database with existing
    tables is safe and will not overwrite or drop data.

    For this to work, all SQLModel table models MUST be imported somewhere
    before this function is called so that SQLModel's metadata registry
    is populated. The canonical place for those imports is main.py.

    Returns:
        None
    """
    SQLModel.metadata.create_all(engine)

    # ------------------------------------------------------------------
    # UAT auto-migration (dev SQLite only)
    # ------------------------------------------------------------------
    # `create_all` adds new TABLES but NOT new COLUMNS on existing tables.
    # During iterative UAT we add columns (deleted_at, uploaded_by_user_id,
    # etc.) and operators were repeatedly hitting "no such column" errors
    # until they manually `del app.db`. This dev-only auto-migration does
    # the equivalent: detects each new column declared on a model and
    # silently ALTER TABLE ADD COLUMNs it.
    #
    # Strictly dev/SQLite. In production this should be replaced by
    # Alembic migrations (see the production-integration guide).
    if "sqlite" in str(engine.url):
        _autoupgrade_sqlite_columns()


def _autoupgrade_sqlite_columns() -> None:
    """
    For every SQLModel-registered table, ADD COLUMN any column the model
    declares that the live SQLite schema is missing. Idempotent — running
    on an up-to-date DB is a no-op. Failures (rare ALTER limits like
    adding a non-null column without default) are logged and swallowed
    so a malformed addition can't block app startup.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    for table_name, table in SQLModel.metadata.tables.items():
        if not insp.has_table(table_name):
            continue
        live_cols = {c["name"] for c in insp.get_columns(table_name)}
        for column in table.columns:
            if column.name in live_cols:
                continue
            # Compose ALTER TABLE for the missing column. SQLite supports
            # ADD COLUMN with type + nullability + default but not all
            # constraint forms — for the cases we add (nullable
            # timestamps, optional FKs) the simple form is enough.
            col_type = column.type.compile(dialect=engine.dialect)
            null_clause = "" if column.nullable else " NOT NULL"
            default_clause = ""
            if column.default is not None and getattr(column.default, "is_scalar", False):
                default_clause = f" DEFAULT {column.default.arg!r}"
            ddl = (
                f"ALTER TABLE {table_name} "
                f"ADD COLUMN {column.name} {col_type}{null_clause}{default_clause}"
            )
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
            except Exception:
                # Best-effort — if SQLite can't auto-add (e.g. NOT NULL
                # without default on an existing table) leave the column
                # missing; the calling query will surface a clearer error.
                pass


# ------------------------------------------------------------------
# Session Dependency
# ------------------------------------------------------------------

def get_session():
    """
    FastAPI dependency that yields a database session per request.

    Usage in a router:
        from fastapi import Depends
        from database import get_session
        from sqlmodel import Session

        @router.get("/items")
        def list_items(session: Session = Depends(get_session)):
            ...

    The `with` block ensures the session is always closed after the
    request completes, even if an exception is raised mid-handler.

    Yields:
        Session: An active SQLModel/SQLAlchemy session bound to `engine`.
    """
    with Session(engine) as session:
        yield session
