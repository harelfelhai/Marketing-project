# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **secrets-free outbound-marketing pipeline**: a FastAPI + SQLModel backend and a
React + Vite (RTL Hebrew) frontend. It tracks *entities* (people/organizations),
their *phone numbers*, and *pipeline tasks* an operator must act on, grouped by
*client*. The whole product is built so no real-world identity, client name, or
proprietary vocabulary ever lands in a structured DB column — see **Secrets-Free
Mandate** below.

> ⚠️ `HANDOVER_SPECIFICATION.md` and `הוראות מערכת.md` are **historical** and
> partly stale: they describe an older schema (an `ActionLog` table, integer
> `client_id`, 4 pages, mock-only auth). The current schema uses **string PKs**,
> a two-level entity model, real cookie auth, a `PipelineTask` table, and an
> in-memory read model. Trust the code over those docs.

## Commands

### Backend (`cd backend`)
- Run the API: `uvicorn main:app --reload --port 8000` (CORS allows `:5173`).
- All tests: `python -m pytest` (560+ tests; config in `pytest.ini`).
- One file / one test: `python -m pytest tests/service/test_system_settings_service.py`
  or append `::test_name`. Tests run on SQLite; tests marked `postgres` are skipped.
- Seed a large realistic dataset (100 clients · 1000 entities · 2500 phones · 200 tasks):
  `python scripts/seed_large.py` — add `--reset` to wipe first. **Always `--reset`
  (or delete `app.db`) when re-seeding**, or stale ids linger. Ids are *predictable*
  (`ent-N`, `ph-N`, `task-N`) on purpose (see Gotchas). `scripts/seed_db.py` is a
  tiny 5-client fixture.

### Frontend (`cd frontend`)
- Dev server: `npm run dev` (Vite on `:5173`, proxies `/api` → `:8000`).
- Production build (CI gate — must exit 0): `npm run build`.
- All tests: `npm test` (Vitest). One file: `npx vitest run tests/unit/displayFields.test.js`.
- Watch: `npm run test:watch`.

### Docker
- `docker compose up --build` (frontend on `:80`, backend on `:8000`).
- One-shot seed: `docker compose run --rm seed` (or `... seed python scripts/seed_large.py --reset`).

## Mock mode vs Real mode (the master switch)

The frontend runs in two equal-status modes, toggled by one env var read once in
`frontend/src/api/client.js`:

```
VITE_USE_REAL_API !== 'true'  → MOCK_MODE = true  (default: in-browser seed data)
VITE_USE_REAL_API === 'true'  → MOCK_MODE = false (live FastAPI over HTTP, cookie auth)
```

Set it in `frontend/.env` / `.env.local`. **Both modes must keep working.** Every
function in `src/api/*.js` branches on `MOCK_MODE` at the top: the real path calls
the axios `apiClient` (baseURL `/api/v1`, `withCredentials: true`) and re-reads from
the server; the mock path calls `mockDb.apply*` mutators against in-browser state.
Component code is mode-agnostic — the branch lives only in the API layer. Every API
function takes `mockDb` (the `MockDataContext` value) as its last argument; don't
remove it.

## Backend architecture

**Layering:** endpoint (`app/api/v1/endpoints/*`) → service (`services/*`) →
`Storage` bundle → `Repository` per aggregate → DB. Services never touch a DB
session directly; they receive a `Storage` (see `repositories/storage.py`), which
exposes one `Repository` per table.

**Dual storage backend.** `Repository` (`repositories/base.py`) is an ABC with a
small **filter DSL** (`list(where={...})` supporting `eq`, `in`, `nin`, etc.).
`SqlRepository` and `MongoRepository` implement it identically, so the same service
code runs on SQLite/Postgres *or* MongoDB. The active backend is chosen **per
request** by reading `system_settings.json` (System Settings → DB engine selector).
When you add a query, express it through the filter DSL, not raw SQL, or you break
Mongo parity.

**In-memory read model** (`services/read_model/`). `ReadModelStore` is a frozen
snapshot of *all* Entity/PhoneNumber/PipelineTask rows plus secondary indexes
(`phones_by_entity`, `entities_by_root`, `tasks_by_entity`). `read_model_manager`
loads it synchronously at boot, **reloads after every write**, and polls every 120s.
List endpoints (`phones`, `entities`, `tasks`) have **two code paths**: a fast
memory path (`if mgr.started:` → filter `mgr.store` in Python) and a DB-query
**fallback** (used in tests / before warm-up). When you change list filtering, update
*both* paths or they drift.

**Models** (`models/`, all `SQLModel`): `Entity`, `PhoneNumber`, `PipelineTask`,
`Notification*`, `User`/`Session`. Shared conventions in `models/types.py`:
- **String PKs** via `new_id()` (uuid-ish), never autoincrement ints.
- Every table has an `extra_data: Optional[dict]` JSON bucket.
- **Soft delete by sentinel, not null** — `deleted_at` defaults to
  `SOFT_DELETE_SENTINEL` (`datetime(9999,...)`). "Active" means
  `deleted_at == SOFT_DELETE_SENTINEL`; a real past timestamp means deleted. See
  Gotchas — this trips up the frontend.

**Two-level entity model.** An `Entity` with `target_entity_id == None` is a *root*
(its own client); a member's `target_entity_id` points at its root. The **derived
`client_id`** of any entity is `target_entity_id ?? id`. Phones/tasks inherit their
client through their owning entity. There is no separate "client" table — the clients
list is *derived from root entities*.

**Auth** (`app/api/v1/endpoints/auth.py`, `services/auth.py`, `models/user.py`):
real HttpOnly cookie sessions (`marketing_session`), bcrypt password hashing. Admin
accounts are reconciled from `admins.json` into the `user` table on every boot
(`services/admin_sync.py`; see `admins.example.json`). FastAPI deps `require_admin`
/ `require_authenticated_user` (`app/api/deps.py`) guard endpoints. A user's
`managed_client_ids` (in `extra_data`) drives the "My Data" personalization filter.

**Injectable engines.** Ingestion / feedback / notification logic is loaded by dotted
path from env (`INGESTION_MODULE`, `FEEDBACK_MODULE`, `NOTIFICATION_MODULE`), against
the ABCs in `interfaces/`. `modules/mock_*` are the open-source stand-ins. Keep
concrete business logic out of `interfaces/`.

## Frontend architecture

**`MockDataContext`** (`src/contexts/MockDataContext.jsx`) is the central data cache
and the heart of real-mode behavior. On boot in real mode it fetches phones + tasks +
entities, then **enriches** them so consumers see one consistent shape regardless of
source:
- `_enrichEntities` — stamps derived `client_id` and **normalizes the soft-delete
  sentinel to `null`** (critical; see Gotchas).
- `_enrichPhones` — stamps `client_id` + `relation_type` from the owning entity.
- `_clientsFromEntities` — derives the clients slice from active root entities,
  with display/SLA overrides layered from `clientRegistry.js` when ids match.
- `_enrichTasks` — resolves each task's owner via `entity_id → entity → client`.
Mock-mode mutators (`apply*`) and real-mode refetchers (`refetchPhones`,
`refetchEntities`, `refetchTasks`) all funnel through the same enrichment.

**Other contexts:** `UIContext` (modals, toasts, persistent per-tab filters),
`MockAuthContext` (`useAuth()` — identity, role, `managed_client_ids`,
`personalizationActive`).

**Adapters** (`src/api/adapters/`) are the only place backend shapes are translated:
`paginationAdapter` (`unwrapPage` strips `{items,total,page,page_size}` envelopes),
`phoneAdapter`, `schemaAdapter` (normalizes form-field option shapes), `taskAdapter`.

**`clientRegistry.js`** is no longer the source of the client list — it is now only a
small set of *display/SLA overrides* (5 entries, each marked
`// HOOK FOR ENTERPRISE LABELS`) applied on top of the derived clients slice.

**Configurable tables** (System Settings page). Per-surface column config persists
opaquely in `system_settings.json` and is applied by
`resolveVisibleColumns(surface, displayFields, displayLabels)` in
`config/displayFields.js`:
- `display_fields` — which columns show + their order.
- `display_labels` — **column rename overrides** (`{surface: {key: label}}`).
- `filter_fields` — which filter controls show (`config/filterFields.js`).
Surfaces consuming this: `PhoneTable`, `EntitiesPage`, `ClientCard` (keys only).

## Secrets-Free Mandate (invariant — do not violate)

The structured columns of every table stay 100% agnostic to real-world identity.
Real names, scores' meaning, vendor payloads, audit trails → all live in `extra_data`.
Client display names exist **only** in the frontend (`clientRegistry.js`,
`strings.he.js`); the backend has never stored or returned one. Markers
`// HOOK FOR ENTERPRISE LABELS` and `// HOOK FOR ENTERPRISE AUTH` are seams, not
decoration — don't delete one without replacing the seam.

## RTL / i18n invariants

`<html lang="he" dir="rtl">`. Use **logical** Tailwind props (`ms-/me-`, `ps-/pe-`,
`border-s/-e`, `text-start`) never `ml-/mr-/text-left`. **Every visible string comes
from `src/config/strings.he.js`** (~640 exports) — hardcoding a string in a component
is a regression.

## Gotchas that cause silent breakage

1. **Soft-delete sentinel is truthy.** The backend returns `deleted_at` = year-9999
   for *active* rows. Frontend code checks `if (e.deleted_at)` to mean "deleted", so
   raw backend rows look deleted and vanish. `_enrichEntities` normalizes the sentinel
   to `null` on hydration — keep that normalization on any new entity-bearing fetch.
2. **Predictable seed ids matter.** `seed_large.py` emits `ent-N`/`ph-N`/`task-N`
   (not random uuids) so real-mode ids line up with mock-mode assumptions and
   `clientRegistry` overrides. Don't randomize them.
3. **Two list code paths.** Changing a list filter in an endpoint means editing both
   the `read_model_manager.store` memory path and the DB fallback.
4. **String ids everywhere.** Don't `Number(...)`-coerce client/entity ids (they're
   strings like `ent-1`); compare as strings.
5. **No pagination caps on boot.** List endpoints intentionally allow large
   `page_size`; `MockDataContext` fetches the full dataset once at boot. Aggregates
   (group counts, client metrics) assume the complete set is present.

## Git workflow

Commit/push only when asked. Do not create PRs unless explicitly requested. Keep the
model identifier out of commit messages and any committed artifact.
