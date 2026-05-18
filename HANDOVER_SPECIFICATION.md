# HANDOVER SPECIFICATION

> **Document purpose.** This file is the absolute source of truth for the successor maintainer of this repository. It captures every architectural invariant, schema contract, and integration milestone delivered up to and including **Phase C** of the integration roadmap. It is written so an incoming engineer with read access to the source tree but no prior runtime context can resume execution at **Phase D — Cache Hydration & Complete State Synchronization** without regression.
>
> **Branch under handover:** `claude/start-new-project-PRxSB`
> **Tip of branch at hand-off:** `73bef79`
> **Build status:** `npm run build` exits 0 with zero warnings (verified at hand-off).
> **Backend tests:** 95 passing under `pytest` (verified at end of M4).

---

## 0. Reading Order

If you are picking this up cold, read in this order:

1. **§1 (Architectural Vision)** — non-negotiable invariants. Violating any of these is a regression even if the code compiles.
2. **§5 (Critical Focus Zones)** — the four places where the codebase has historically broken. Read these BEFORE writing any code.
3. **§6 (Roadmap)** — your current position (Phase D entry gate) and the exit criteria for completion.
4. **§2–§4** — reference material to consult while implementing.
5. **Appendix A** — the full file map. Use it as the authoritative directory index.

---

## 1. High-Level Architectural Vision & Invariants

### 1.1 What the system is, in generic terms

The system is a **structured outbound-action pipeline** that ingests endpoint identifiers (telephone numbers acting as the canonical contact channel), routes each through three explicit lifecycle phases, and exposes operator controls for manual intervention at every phase boundary.

The three phases are:

| Phase | Concern | Persisted in |
|---|---|---|
| **Phase 1 — Ingestion** | How and why an endpoint entered the system | `PhoneNumber.ingestion_*` columns |
| **Phase 2 — Dispatch & Recovery** | Outbound actions executed against the endpoint, with retry semantics | `ActionLog` rows |
| **Phase 3 — Quality Verdict** | Internal evaluation of the endpoint's quality | `PhoneNumber.verification_*` columns |

The system is designed around **runtime-injectable engines** for each phase (`BaseIngestionRoutingEngine`, `BaseActionHandler`, `BaseVerificationStrategy`) so the open-source codebase never embeds proprietary business logic.

### 1.2 The Secrets-Free Mandate (non-negotiable)

The codebase will eventually ship into a confidential deployment environment. The following boundary is **invariant** and must be preserved across every line of code introduced from this point forward.

#### What is structural metadata (allowed in the schema)

- `Entity.client_id` — opaque **integer** (1, 2, 3, …) identifying the client partition. Carries no semantic meaning at the database layer.
- `Entity.relation_type` — explicit string from `{'primary', 'associated'}`. Indicates structural role only, never identity.
- `Entity.entity_type` — free-form indexed string sub-classification (e.g. `'target'`, `'family'`, `'friend'`). The DB does not enforce a vocabulary; engines extend it at runtime.
- `PhoneNumber.classification_type` — opaque label string. The MEANING of each value is resolved at runtime by a separate utility (not in this repo). Examples in comments (`'tier_a'`, `'type_a'`) are illustrative only.
- `verification_status`, `verification_source`, `ingestion_source`, `action_log.status`, `action_log.action_type` — all free-form indexed strings. Their value vocabulary is extensible at runtime.

#### What is proprietary payload (must live in `extra_data`)

Every model in the system carries an `extra_data: Optional[dict]` JSON column. **All** of the following must live exclusively inside `extra_data`:

- Real-world entity names, addresses, demographic attributes
- Scoring vectors, algorithmic explanations, model outputs
- Provider IDs, vendor response payloads, carrier lookup results
- Internal audit trails, business-rule outputs, classification reasons
- Operator attribution fields (e.g. `last_verdict_by`, `force_retried_by_operator`)

The structured columns of the three tables (`Entity`, `PhoneNumber`, `ActionLog`) MUST remain 100% agnostic to real-world corporate names, real-world client identities, and any internal proprietary vocabulary.

#### Display names live ONLY in the frontend

The mapping from `client_id` integer → display name lives in **one file and one file only**:

```
frontend/src/config/clientRegistry.js
```

The integers are stable structural keys. The display names there (`'Client Alpha'`, `'Client Beta'`, …) are placeholder labels and carry a `// HOOK FOR ENTERPRISE LABELS` comment on every entry. When the codebase moves to the internal environment, only this single file is edited.

The backend has **never** seen, stored, or returned a client display name. Verify this invariant with:

```bash
grep -r "Alpha\|Beta\|Gamma\|Delta\|Epsilon" backend/
# expected: zero matches
```

### 1.3 Auth Deferral Invariant

`M5 (Auth & RBAC)` is **deferred**. Until the activation criteria are met (see §6.3), every attribution-bearing call in the system reads `operator_id` from a single mock context:

```
frontend/src/contexts/MockAuthContext.jsx
  → exports useAuth() returning { operatorId: 'mock_operator_01', operatorRole: 'admin' }
```

Every mutation API function accepts `operator_id` as an **explicit parameter** — never reads from auth context itself. This keeps the swap point single-purpose and is marked at seven call sites by the comment:

```
// HOOK FOR ENTERPRISE AUTH
```

Locate them with:
```bash
grep -rn "HOOK FOR ENTERPRISE AUTH" frontend/
```

When Phase G activates, these seven sites and the single `MockAuthContext.jsx` file are the entire surface area of the auth swap.

### 1.4 Mock Mode vs Real Mode

The frontend operates in two modes governed by a single environment variable:

```
VITE_USE_REAL_API=false  → MOCK_MODE = true  (default; in-memory mock state)
VITE_USE_REAL_API=true   → MOCK_MODE = false (live backend over HTTP)
```

The flag is read once in `frontend/src/api/client.js` and re-exported. Every API function in `src/api/*.js` branches on `MOCK_MODE` at the top:

```js
if (!MOCK_MODE) {
  // real HTTP path
  const { data } = await apiClient.post('/...', payload);
  await mockDb.refetchPhones();   // or refetchActionLogs / both
  return data;
}
// mock path (unchanged) — uses mockDb.apply* mutators
```

**Both modes must continue to work** through every subsequent phase. Real mode talks to the FastAPI backend over HTTP and refetches from the server after every mutation. Mock mode runs entirely in-browser against `buildInitialDb()` seed data. Component code is identical in both modes — the branching lives exclusively in the API layer.

---

## 2. Relational Schema & State Contracts

This section is the authoritative reference for the three tables. Field names, types, constraints, and indexing are stated verbatim from `backend/models/`.

### 2.1 `entity` table

**File:** `backend/models/entity.py`
**Class:** `Entity(SQLModel, table=True)`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `Optional[int]` | PRIMARY KEY, auto-increment | Surrogate PK |
| `client_id` | `Optional[int]` | **INDEXED** | Integer partition key. NULL = unassigned. **Phase A — added.** |
| `relation_type` | `str` | NOT NULL, **INDEXED**, default `'primary'` | Two-value enum-like: `'primary'` or `'associated'`. **Phase A — added.** |
| `entity_type` | `str` | NOT NULL, **INDEXED** | Sub-classification within relation_type bucket. Free-form. |
| `target_entity_id` | `Optional[int]` | FK → `entity.id`, **INDEXED** | Self-reference. NULL ⇒ this row IS a primary target. INT ⇒ row is in a target's circle-of-trust. |
| `created_at` | `datetime` | NOT NULL, default `utcnow()` | Set once on insert |
| `updated_at` | `datetime` | NOT NULL, default `utcnow()`, `onupdate=utcnow()` | Auto-managed by SQLAlchemy |
| `extra_data` | `Optional[dict]` | JSON column | Proprietary payload bucket |

**`relation_type` semantics:**
- `'primary'` — this entity is the direct subject of the pipeline for `client_id`.
- `'associated'` — this entity is a perimeter contact linked via `target_entity_id` to a primary target.

`relation_type` is indexed precisely so queries of the form *"all primary targets for client 3"* (`WHERE client_id=3 AND relation_type='primary'`) run on indexed equality joins.

### 2.2 `phone_number` table

**File:** `backend/models/phone_number.py`
**Class:** `PhoneNumber(SQLModel, table=True)`

| Column | Type | Constraints | Phase |
|---|---|---|---|
| `id` | `Optional[int]` | PRIMARY KEY, auto-increment | core |
| `entity_id` | `int` | FK → `entity.id`, NOT NULL, **INDEXED** | core |
| `phone_number` | `str` | NOT NULL, **INDEXED**, **UNIQUE** | core |
| `classification_type` | `Optional[str]` | **INDEXED** | core, mutable via PATCH |
| `ingestion_source` | `str` | NOT NULL | Phase 1 |
| `ingestion_reason` | `Optional[str]` | — | Phase 1 |
| `ingested_at` | `datetime` | NOT NULL, default `utcnow()` | Phase 1 |
| `verification_status` | `str` | NOT NULL, **INDEXED**, default `'pending'` | Phase 3 |
| `verification_source` | `Optional[str]` | — | Phase 3 |
| `verification_reason` | `Optional[str]` | — | Phase 3 |
| `verified_at` | `Optional[datetime]` | — | Phase 3 |
| `created_at`, `updated_at` | `datetime` | auto-managed | metadata |
| `extra_data` | `Optional[dict]` | JSON column | proprietary payload |

**`verification_status` lifecycle:**

```
'pending' → 'verified_good'
          → 'verified_bad'
```

Backend services accept additional values at runtime — the column is not enum-constrained.

**Mutable fields exposed to operators via `PATCH /api/v1/phones/{id}`:**
- `classification_type`
- `extra_data` (whole-object replacement, not merge)

All Phase 3 fields are written **exclusively** by `VerificationService` — they are NOT in `PhoneUpdateRequest`.

### 2.3 `action_log` table

**File:** `backend/models/action_log.py`
**Class:** `ActionLog(SQLModel, table=True)`

| Column | Type | Constraints |
|---|---|---|
| `id` | `Optional[int]` | PRIMARY KEY |
| `phone_id` | `int` | FK → `phone_number.id`, NOT NULL, **INDEXED** |
| `action_type` | `str` | NOT NULL, **INDEXED** |
| `status` | `str` | NOT NULL, **INDEXED**, default `'pending'` |
| `requested_at` | `datetime` | NOT NULL, default `utcnow()` |
| `executed_at` | `Optional[datetime]` | NULL while pending |
| `retry_count` | `int` | NOT NULL, **INDEXED**, default `0` |
| `retry_after` | `Optional[datetime]` | nullable; back-off deadline |
| `created_at`, `updated_at` | `datetime` | auto-managed |
| `extra_data` | `Optional[dict]` | JSON; provider IDs, response payloads |

**`status` lifecycle:**

```
'pending' ─→ 'sent'              (terminal — successful dispatch)
          ├→ 'delivered'         (terminal — confirmed via provider webhook)
          ├→ 'failed'            (terminal — max retries exceeded / hard error)
          ├→ 'scheduled_retry'   (soft failure; RetryEngine will re-dispatch after retry_after)
          ├→ 'retrying'          (transient — claimed by RetryEngine for atomic re-dispatch)
          └→ 'superseded'        (frontend-only mock marker; not used by real backend)
```

**Retry semantics (do NOT change without consulting tests):**
- The `RetryEngine` queries `WHERE status='scheduled_retry' AND retry_after <= utcnow()`.
- Atomic claim is the cornerstone — covered by `tests/state_machine/test_retry_lifecycle.py`.
- `retry_count` is incremented exclusively by `RetryEngine` on pickup.
- `_NON_RETRYABLE_TERMINAL_STATUSES = {'sent', 'delivered'}` blocks `POST /actions/retry-now/{id}` with HTTP 422 for those statuses.

### 2.4 Front-end state slice shape (after Phase B hydration)

When `MOCK_MODE = false`, `MockDataContext` exposes the following shape:

```js
{
  // Hydrated from backend on mount
  phones:     PhoneSummary[],   // each row carries client_id (int), entity_type, client_name (enriched)
  actionLogs: ActionLogResponse[],

  // Derived synthetically from the phone JOIN data
  entities: [{ id, entity_type, client_id }],

  // Sourced from frontend clientRegistry.js (never from backend)
  clients: CLIENT_REGISTRY,

  // Pure UI state (never persisted server-side)
  engines: {
    retry:        { executing, lastRunAt, lastProcessedCount, label },
    verification: { executing, lastRunAt, lastProcessedCount, label },
  },

  loading: boolean,
}
```

`entities` in real mode is **synthetic** — it is rebuilt from the `entity_id`/`entity_type`/`client_id` fields that come embedded on every `PhoneSummary` via the backend JOIN. No `/entities` endpoint exists, and none is needed.

---

## 3. REST API Contracts & Pagination Envelopes

All endpoints are prefixed with `/api/v1`. Full contracts in `backend/app/schemas/api_contracts.py`.

### 3.1 Endpoint matrix

| Method | Path | Request | Response | Read or Write |
|---|---|---|---|---|
| `GET`  | `/schema/lead-form` | — | `LeadFormSchemaResponse` | read |
| `GET`  | `/phones` | query params | `PhoneListResponse` (envelope) | read |
| `GET`  | `/phones/{id}` | — | `PhoneDetailsResponse` | read |
| `PATCH`| `/phones/{id}` | `PhoneUpdateRequest` | `PhoneUpdateResponse` | write |
| `POST` | `/ingest` | `IngestionPayload` | `IngestionResponse` (201) | write |
| `POST` | `/actions/trigger` | `ManualActionTriggerRequest` | `ActionLogResponse` (201) | write |
| `POST` | `/actions/retry-now/{log_id}` | `RetryNowRequest` | `ActionLogResponse` | write |
| `POST` | `/verification/verdict` | `VerificationVerdictRequest` | `IngestionResponse` | write |
| `GET`  | `/actions/logs` | query params | `ActionLogListResponse` (envelope) | read |
| `GET`  | `/dashboard/metrics` | — | `DashboardMetricsResponse` (flat) | read |
| `POST` | `/system/workers/run?worker_name=` | — | `WorkerRunResponse` | write |

### 3.2 Pagination envelope (LIST endpoints only)

Both `PhoneListResponse` and `ActionLogListResponse` use the same wrapper:

```json
{
  "items": [...],
  "total": 47,
  "page": 1,
  "page_size": 200
}
```

**The frontend MUST strip this envelope.** Components receive flat arrays. The single function that performs the strip is:

```
frontend/src/api/adapters/paginationAdapter.js
  → unwrapPage(response) returns { items, meta: { total, page, pageSize } }
  → throws ApiShapeError if response.items is not an array
```

Every list-endpoint API function in `src/api/*.js` passes the raw response through `unwrapPage()` before returning `items`. Do not bypass.

### 3.3 Filter-as-view pattern (CRITICAL — never violate)

Both `GET /phones` and `GET /actions/logs` are designed as **filter-driven sub-views**. To get the operator task queue, the frontend passes `?verification_status=pending` to `/phones`. To get the failed-actions table, it passes `?status=failed` to `/actions/logs`.

**Do NOT add dedicated endpoints for sub-views.** Adding `/phones/pending` or `/actions/failed` is a regression. Status is a query parameter on purpose so introducing a new status value (e.g. `'needs_manual_review'`) requires zero new API surface.

### 3.4 Query parameter mapping (frontend → backend)

The frontend uses camelCase filter keys; the backend expects snake_case. The mapping happens inside each `listX` function in `src/api/*.js`:

| Frontend filter | Backend query param |
|---|---|
| `clientId` | `client_id` |
| `verificationStatus` | `verification_status` |
| `ingestionSource` | `ingestion_source` |
| `classificationType` | `classification_type` |
| `pageSize` | `page_size` |
| `status` | `status` (same name) |
| `phone_id` | `phone_id` (same name) |

The `search` filter has **no backend equivalent** — it is applied client-side over the returned page in `listPhones`. The page request defaults to `page_size=200` for phones and `page_size=500` for action logs precisely so client-side `search` operates on a full snapshot.

### 3.5 Schema option shape (CRITICAL)

`GET /schema/lead-form` returns `FormField.options` as:

```json
[{ "value": "manual", "label": "Manual Entry" }, ...]
```

The legacy mock returned plain strings: `["manual", "automated"]`. `frontend/src/api/adapters/schemaAdapter.js → normalizeFormSchema()` accepts both shapes and always emits `{value, label}` objects. `DynamicField.jsx` consumes only the normalized form. See §5.2.

### 3.6 Operator attribution placement

| Endpoint | Field carrying `operator_id` |
|---|---|
| `POST /actions/trigger` | `body.operator_id` (top-level) |
| `POST /actions/retry-now/{id}` | `body.operator_id` (top-level, optional) |
| `PATCH /phones/{id}` | not accepted by the contract; routed into `extra_data` if needed |
| `POST /verification/verdict` | **`body.extra_metadata.operator_id`** — `VerificationVerdictRequest` has no top-level `operator_id` field |
| `POST /ingest` | not accepted; ingestion is unattributed in the open contract |

**Watch out for `/verification/verdict`** — this is the one endpoint where attribution lives inside `extra_metadata`. The frontend `submitVerdict()` already routes it correctly. Don't change this without also updating the backend contract.

---

## 4. Frontend Component & Adapter Topology

### 4.1 Adapter layer (`frontend/src/api/adapters/`)

Three adapter modules sit between the raw HTTP responses and the rest of the codebase. They are the **only** authorized translation layer between backend shapes and frontend consumers.

#### `paginationAdapter.js`

```
unwrapPage(response): { items, meta }
class ApiShapeError extends Error
```

- Validates `response.items` is an array; throws `ApiShapeError` if not.
- Returns `meta = { total, page, pageSize }` (note: backend's `page_size` is camelCased to `pageSize` here).
- Called by `listPhones`, `getPhoneDetail` does NOT use it (single-item response), `listActionLogs`.

#### `schemaAdapter.js`

```
normalizeFormSchema(raw): {form_title, form_description, fields: [...]}
```

- Each `field.options` is coerced to `[{value, label}]` regardless of input shape.
- Accepts: `null`, string arrays, object arrays, mixed arrays.
- Called by `getLeadFormSchema()` in **both** modes (so mock mode and real mode emit identical shapes to `DynamicField.jsx`).

#### `phoneAdapter.js`

```
enrichPhone(phoneSummary): { ...phoneSummary, client_name: getClientName(client_id) }
enrichPhoneDetail(detail): { ...detail, entity: { ...detail.entity, client_name } }
```

- The single seam where backend integer `client_id` → frontend display name resolution happens.
- Calls `getClientName()` from `src/config/clientRegistry.js`.
- Called by `listPhones` (per item) and `getPhoneDetail` (on the response).

**Invariant:** No component, page, or other API function calls `getClientName()` directly. The enrichment must happen at the API boundary. Anything reading from `MockDataContext` already has `client_name` populated.

### 4.2 Two-context state architecture

- `MockAuthContext` (`src/contexts/MockAuthContext.jsx`): single source of `operatorId` and `operatorRole`. **Hardcoded** until Phase G.
- `MockDataContext` (`src/contexts/MockDataContext.jsx`): the application data cache. Holds `phones`, `entities`, `clients`, `actionLogs`, `engines`, `loading`. Exposes mutators (`apply*`) used only in mock mode and refetch functions (`refetchPhones`, `refetchActionLogs`) used only in real mode.
- `UIContext` (`src/contexts/UIContext.jsx`): cross-page UI state — ingestion modal open/close, toast queue, persistent phone filters.

### 4.3 Mutation invalidation pattern (Phase C contract)

Mutating API functions in `src/api/*.js` follow this exact pattern:

```js
export async function someMutation(args, mockDb) {
  if (!MOCK_MODE) {
    const { data } = await apiClient.post('/path', payload);
    await mockDb.refetchPhones();          // or refetchActionLogs / both
    return data;
  }
  // mock path — mockDb.apply* mutators
}
```

Refetch routing by mutation:

| Mutation | `refetchPhones` | `refetchActionLogs` |
|---|---|---|
| `ingestCircleMember` | ✓ | |
| `submitVerdict` | ✓ | |
| `patchPhone` | ✓ | |
| `triggerManualAction` | | ✓ |
| `retryNow` | | ✓ |
| `runWorker` | ✓ | ✓ |

This is **strict server-as-source-of-truth invalidation**. No optimistic in-memory updates in real mode. The user-stated decision is final: do not introduce optimistic patching as a perceived-latency optimisation without explicit approval.

### 4.4 `PhoneTable` — 5-column stacked-data layout

**File:** `frontend/src/components/phones/PhoneTable.jsx`
**Row component:** `frontend/src/components/phones/PhoneRow.jsx`

The table uses `table-fixed` with explicit `<colgroup>` widths so layout is deterministic:

| Col | Width | Content |
|---|---|---|
| 1 | `w-[180px]` | Phone number (monospace, truncate) + classification badge below |
| 2 | `w-[200px]` | Client name (truncate, `max-w-[180px]`) + entity ID stacked below |
| 3 | `w-[160px]` | Verification status badge + source caption stacked below |
| 4 | (free) | `<ActionMiniPipeline>` — up to 5 icon-tooltips |
| 5 | `w-[140px]` | Updated-at timestamp (tabular-nums, whitespace-nowrap) |

**Truncation mechanics (do not regress):**

Every column whose content can overflow uses the pattern:

```jsx
<div className="flex flex-col min-w-0 max-w-[...]">
  <span className="truncate" title={fullValue}>{fullValue}</span>
</div>
```

The **`min-w-0`** on the inner flex column is the load-bearing piece — without it, flex children refuse to shrink below their content's intrinsic width, and the table layout breaks. Any new column that adds variable-length text must repeat this pattern.

**Action-icon tooltip overflow escape:**

`ActionMiniPipeline.jsx` (line 59) opens its hover tooltips **upward** to escape the row's `overflow-x` clipping:

```jsx
className="absolute bottom-full mb-2 ... z-20 hidden group-hover:block ..."
```

- `bottom-full` anchors the tooltip ABOVE its trigger.
- `mb-2` provides 8px clearance.
- `z-20` keeps it above other table chrome.
- The tooltip uses `pointer-events-none whitespace-nowrap` so hovering it doesn't toggle visibility and long strings don't wrap.

For tooltips on the last two icons (rightmost in LTR, leftmost in RTL), the anchor flips to `right-0` instead of `left-0` so the tooltip body doesn't overflow the viewport. This logic is RTL-aware — leave it in place.

### 4.5 `PhoneDetailDrawer` — isolated scroll surface

**File:** `frontend/src/components/phones/PhoneDetailDrawer.jsx`

Drawer is `fixed top-0 left-0 z-40 h-screen w-full sm:w-[480px] lg:w-[40%]`. **Left-anchored** because the document is `dir="rtl"` — `left-0` puts it on the trailing edge in RTL.

Three-region vertical layout enforces a single scrollable surface:

```
┌─────────────────────────────────────────┐
│ <header className="shrink-0">           │  ← never compresses
├─────────────────────────────────────────┤
│ <div className="flex-1 overflow-y-auto">│  ← THE ONLY scroll surface
│   <JsonMetadataExplorer>                │
│   <VerticalAuditTimeline>               │
├─────────────────────────────────────────┤
│ <footer className="shrink-0 sticky      │  ← stays at bottom
│         bottom-0 bg-white border-t">    │
│   [Trigger Action]    [Approve][Reject] │
└─────────────────────────────────────────┘
```

**Critical:** the footer is `sticky bottom-0` with an **opaque** background and a `border-t`. Without all three, content scrolling underneath becomes visible through the footer and the verdict buttons appear to "float".

The drawer reads ALL of its data from `useMockData()` context arrays — it does NOT keep local state for the phone detail. This means `refetchPhones()` in real mode automatically updates the drawer with no extra component logic.

### 4.6 Hebrew RTL invariants

- `<html lang="he" dir="rtl">` is set in `frontend/index.html`. Do not change.
- All directional Tailwind classes use **logical properties**:
  - `ms-*` / `me-*` instead of `ml-*` / `mr-*`
  - `ps-*` / `pe-*` instead of `pl-*` / `pr-*`
  - `border-s` / `border-e` instead of `border-l` / `border-r`
  - `text-start` instead of `text-left`
- Drawer slide keyframes (`tailwind.config.js`) are flipped: `translateX(-100%) → translateX(0)`.
- Toast stack lives at `bottom-4 left-4` (trailing edge in RTL).
- All visible strings are sourced from `frontend/src/config/strings.he.js`. Hardcoding any new English or Hebrew string in a component is a regression.

### 4.7 Dynamic form rendering

**File:** `frontend/src/components/ingestion/DynamicField.jsx`

The form is **schema-driven**. The component renders exactly the fields returned by `getLeadFormSchema()` and never references a field name directly. `field.type` selects the widget:

| `type` | Widget |
|---|---|
| `'text'` | `<input type="text">` |
| `'tel'` | `<input type="tel">` |
| `'select'` | `<select>` populated from `field.options` |
| `'textarea'` | `<textarea>` |
| `'json_blob'` | `<textarea>` (monospace, validated as JSON on submit) |

Validation:
- `field.required` empty after `.trim()` → inline error under the field, no toast.
- `field.type === 'json_blob'` with non-empty content that fails `JSON.parse()` → inline error under the field, no toast.
- Empty `json_blob` fields are submitted as `{}` (NOT `null`).

---

## 5. Critical Engineering Focus Zones (High Precision Required)

These are the four places where regression has historically been introduced. **Read this section twice before touching any of these files.**

### 5.1 Numeric URL params vs integer `client_id`

**File:** `frontend/src/pages/PhoneGridPage.jsx`

URL query parameters are always strings:

```js
const raw = searchParams.get('client_id');   // '1' (string), never 1 (number)
```

But in real mode, every `phone.client_id` and `entity.client_id` is an **integer** (1, 2, 3, …) — sourced from the backend's `Entity.client_id` integer column. Strict-equality filter comparison (`entity.client_id === filters.clientId`) fails silently when one side is `'1'` and the other is `1`.

The fix already in place at `PhoneGridPage.jsx`:

```js
useEffect(() => {
  const raw = searchParams.get('client_id');
  if (raw) {
    const parsed = Number(raw);
    seedClientFilter(Number.isFinite(parsed) && raw.trim() !== '' ? parsed : raw);
  }
}, [searchParams, seedClientFilter]);
```

The same pattern applies to any new place where a `client_id` enters the system from a URL, form, or other string-typed source. If you add deep links of the form `/phones?client_id=N` from any new origin, you MUST coerce to integer before storing the value in `UIContext.phoneFilters`.

`deriveClientMetrics` in `src/mock/mockData.js` already handles both modes:

```js
export function deriveClientMetrics(clientId, phones, actionLogs, entities = SEED_ENTITIES) {
  const clientPhones = phones.filter((p) => {
    // Real-API mode: client_id is embedded directly on the phone (from the JOIN).
    if (p.client_id != null) return String(p.client_id) === String(clientId);
    // Mock mode: resolve via entity lookup.
    const entity = entities.find((e) => e.id === p.entity_id);
    return entity?.client_id === clientId;
  });
  ...
}
```

The `String(...) === String(...)` coercion is intentional — do not "optimise" it away. It permits both `1 === 1` and `'1' === 1` to succeed, which protects against the URL-string class of bug regardless of where the value originated.

### 5.2 `DynamicField.jsx` — dual option shape

**File:** `frontend/src/components/ingestion/DynamicField.jsx`

Before Phase B, the mock returned options as plain strings (`['manual', 'automated']`). After Phase B, the backend returns `FormFieldOption` objects (`[{value: 'manual', label: 'Manual Entry'}, ...]`). The `schemaAdapter.normalizeFormSchema()` adapter accepts both forms and emits the object form in all cases.

`DynamicField.jsx` renders the select as:

```jsx
{(field.options || []).map((opt) => (
  <option key={opt.value} value={opt.value}>{opt.label}</option>
))}
```

**Do not regress this to `opt`** when reading `field.options`. The adapter guarantees object shape; the component depends on it.

If you ever introduce a new field type whose options are populated from elsewhere (e.g. a fetch from `clientRegistry`), pass them through `normalizeOptions()` from `schemaAdapter.js` so the shape stays consistent.

### 5.3 Atomic worker execution

**File:** `frontend/src/api/systemApi.js` (function `runWorker`)

The `runWorker` function operates a three-step sequence and must be atomic from the UI's perspective:

```js
// Step 1: signal "executing" — triggers global overlay on dependent tables
mockDb.setEngineExecuting(engineName, true);

try {
  // Step 2: hit the backend; backend blocks until worker finishes
  const { data } = await apiClient.post('/system/workers/run', null, {
    params: { worker_name: engineName },
  });

  // Step 3a: clear executing + store result (this also drops the overlay)
  mockDb.applyWorkerRun(engineName, data.processed_count);

  // Step 3b: force cache invalidation — worker may have touched both tables
  await Promise.all([
    mockDb.refetchPhones(),
    mockDb.refetchActionLogs(),
  ]);

  return data;
} catch (err) {
  // Failure path: MUST clear the executing flag or the overlay sticks forever
  mockDb.setEngineExecuting(engineName, false);
  throw err;
}
```

**Hard constraints:**

1. The executing flag is set BEFORE the HTTP call and cleared AFTER the refetch. The `FailedActionsTable` reads `engines` from context and dims itself + shows a centered spinner overlay when ANY engine is executing. This is the "global overlay" guarantee — operators cannot interact with stale rows mid-pass.
2. The `try/catch` is non-optional. A thrown `ApiError` without clearing `executing` leaves the overlay permanently visible.
3. `Promise.all([refetchPhones, refetchActionLogs])` is intentional — running them in parallel halves the post-worker latency.
4. The mock mode path uses the same `setEngineExecuting → mockDelay → applyWorkerRun` sequence (no refetches because mock state is already authoritative).

If you add a third engine, the same three-step pattern applies. Do not split the executing-state management across multiple API functions.

### 5.4 The `mockDb` parameter convention

Every mutation function and every read function in `src/api/*.js` accepts `mockDb` as its last argument. In real mode, the function reads only `mockDb.refetchPhones` / `mockDb.refetchActionLogs` from it. In mock mode, the function uses `mockDb.apply*` mutators and `mockDb.phones` / `mockDb.actionLogs` as the source of truth.

**Components MUST continue to pass `mockDb` even in real mode.** Removing it would force every refetch call site into the components themselves — a regression of cleanliness. The `mockDb` parameter is the surface that lets components stay mode-agnostic.

When adding a new mutation API function:

- Accept `mockDb` as the last argument.
- Branch on `MOCK_MODE` at the top.
- In the real path, call the appropriate `mockDb.refetchX()` after the HTTP completes.
- In the mock path, call the appropriate `mockDb.applyX()` mutator.
- Components require zero changes.

---

## 6. Remaining Roadmap & Execution Plan

### 6.1 Phase status at hand-off

| Phase | Scope | Status |
|---|---|---|
| **A** | Relational schema enforcement (`client_id`, `relation_type`), seed script, frontend prep | ✅ Complete |
| **B** | Read-only API integration: 3 adapters, axios + interceptors, 4 read endpoints wired, boot hydration | ✅ Complete (commit `ebf8913`) |
| **C** | Mutation endpoints wired (5 endpoints), server-invalidation refetch loop | ✅ Complete (commit `32582df`) |
| **D** | Cache hydration, SWR merge, full state synchronization | **← YOU ARE HERE** |
| **E** | Error boundaries, empty states, text wrap, skeleton standardization | not started |
| **F** | Docker Compose + nginx + Postgres + Alembic; air-gapped deployment | not started |
| **G** | Auth, JWT, RBAC | **DEFERRED** — awaiting requirements |

### 6.2 Phase D — entry gate, scope, exit criteria

#### Entry gate

The following must be true before Phase D begins. Verify each before writing code.

1. `npm run build` exits 0 with zero warnings on the current branch tip.
2. With `VITE_USE_REAL_API=true` and a seeded backend running on `:8000`, all four pages render real data and every mutation completes a round-trip.
3. The `clientRegistry.js` integer keys match `seed_db.py`'s seeded `Entity.client_id` values (currently 1–5).

#### Scope of Phase D

Phase D upgrades `MockDataContext` from a **boot-once** cache into a **reactive cache** that maintains tight consistency with the backend without forcing full-table refetches on every mutation.

**Deliverable 1 — Stale-while-revalidate merge keyed by `id`.**

Replace the current "full refetch" pattern in `refetchPhones` / `refetchActionLogs` with a targeted merge:

- After `submitVerdict` and `patchPhone`: call `getPhoneDetail(phoneId)`, merge the single phone into `db.phones` by `id`.
- After `triggerManualAction`: call `listActionLogs({phone_id})`, merge those logs into `db.actionLogs` by `id` (replace existing IDs, append new IDs, drop missing IDs only when sourced from a full list call).
- After `ingestCircleMember`: full `listPhones()` refetch — a new phone has a server-assigned ID that the client doesn't know.
- After `retryNow`: a single phone's `phone_id`-scoped `listActionLogs` refetch.
- After `runWorker`: keep the full refetch of both tables — the worker pass can touch arbitrary rows.

The merge function lives inside `MockDataContext` as a private helper. Components remain untouched.

**Deliverable 2 — Cold-boot skeleton standardisation.**

A reusable `<Skeleton width height className>` primitive in `src/components/primitives/Skeleton.jsx` (`animate-pulse` background blocks). Applied to:

- `PhoneTable` cold load: 8 rows × 5 columns of skeletons (replaces the brief empty state).
- `PhoneDetailDrawer` open: header + 3 metadata rows + 4 timeline events.
- `ClientHubPage` cold load: 4 grid skeletons.
- `Dashboard*` widgets: bar/funnel/SLA skeletons.

All skeletons must respect RTL layout — verify visually.

**Deliverable 3 — `loading` flag fan-out.**

`MockDataContext.loading` already exists (from Phase B). Consume it in:
- `ClientHubPage` — skeleton grid while `loading === true`.
- `PhoneGridPage` — skeleton rows while `loading === true`.
- `SystemOpsPage` — skeleton failed-actions table while `loading === true`.
- `DashboardPage` — three skeleton tiles while `loading === true`.

Do NOT show the "no records" empty state while `loading === true`. That is the bug Phase E will catch as a regression — Phase D should already prevent it.

**Deliverable 4 — Two-tab consistency proof.**

Open the app in two browser tabs against the same backend. Mutate in tab A. Reload tab B. The mutation must be visible. This is the acceptance test that the cache is truly server-anchored.

#### Exit criteria for Phase D

1. Delete the `buildInitialDb()` call from `MockDataContext` while `MOCK_MODE = false` — the app boots and works without static seed.
2. Open two tabs as above — mutations propagate after reload of the second tab.
3. Network tab on cold boot shows exactly two parallel requests (`/phones`, `/actions/logs`), not N-per-component.
4. Mutating any single phone or log triggers exactly one targeted refetch — not a full list refetch — except for the documented "full" cases (ingest, runWorker).
5. `npm run build` still exits 0 with zero warnings.

### 6.3 Deferred phases (do NOT begin without explicit approval)

**Phase E — Polish.** Global `ErrorBoundary` (three nested scopes), empty-state primitive, text-wrap enforcement audit, skeleton standardization. Pre-requisite: Phase D done.

**Phase F — Isolated Deployment.** Docker Compose stack with PostgreSQL, FastAPI + uvicorn + Alembic, Vite-built static assets served via Nginx. Single-command boot, `pgdata` volume, internal `marketing_internal` network with only `frontend:80` exposed to the host. `.env.example` committed with placeholder values; `.env` gitignored. Migration from SQLite to PostgreSQL via Alembic `0001_initial.py` derived from current SQLModel metadata.

**Carry-over tech debt for Phase F (do not address standalone):** the legacy tables `Entity`, `PhoneNumber`, and `ActionLog` and every service that writes to them still use naive `datetime.utcnow()` (Python 3.12-deprecated). Phase DX introduced the timezone-aware pattern (`datetime.now(timezone.utc)` + `UTCDateTime` TypeDecorator in `backend/models/pipeline_task.py`) for the new `PipelineTask` table. The legacy migration to tz-aware UTC is bundled into Phase F because the Alembic SQLite → PostgreSQL cutover already touches every datetime column — doing both as one operation avoids a second test-churn pass. Cross-table joins must remain tolerant of mixed tz-aware (PipelineTask) vs tz-naive (legacy) shapes until then.

**Phase G — Auth & RBAC.** Blocked indefinitely until the access-control matrix is delivered by the deployment team. Activation criteria require an explicit, written role/permission spec. Until then, every `// HOOK FOR ENTERPRISE AUTH` comment stays in place. The eventual surface area is:

- `MockAuthContext.jsx` → replace with real JWT decode + `GET /api/v1/auth/me`.
- New backend endpoints `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`.
- A `get_current_operator` FastAPI dependency replacing the free-string `operator_id` on mutating endpoints.
- A `<RequireAuth>` route wrapper and `<RequireRole>` conditional render in the frontend.

Phase G is a *replacement* phase, not an *additive* phase. It swaps the mock seam; component code is untouched.

---

## 7. Cross-Cutting Invariants — Enforce on Every Commit

The following must remain true through every subsequent change. Treat them as CI guard-rails until the project has an actual CI suite.

1. **Generic nomenclature**: no proprietary names, classification tokens, or entity labels enter the codebase. Verify per-commit:
   ```bash
   grep -rni "<real-org-name>\|<real-classification>\|<real-region>" backend frontend
   ```
2. **HOOK comments preserved**: `// HOOK FOR ENTERPRISE LABELS` and `// HOOK FOR ENTERPRISE AUTH` are markers, not decoration. Removing one without replacing the underlying seam is a regression.
3. **`.env` discipline**: `frontend/.env.local` and `backend/.env` are gitignored. `.env.example` carries only placeholder values. No credentials in compose files or Dockerfiles.
4. **Adapter boundary**: backend response shapes touch the codebase only through `src/api/adapters/*`. Adding a `JSON.parse` or shape coercion anywhere else is a regression.
5. **No optimistic in-memory updates in real mode**: every mutation triggers a server-anchored refetch. The user has explicitly rejected optimistic patching for this product.
6. **Operator attribution stays explicit**: `api/*.js` functions never import `MockAuthContext`. `operator_id` is always passed as an argument from the calling component.
7. **Mock mode never breaks**: every change that touches `src/api/*.js` or `src/contexts/MockDataContext.jsx` must continue to work with `VITE_USE_REAL_API=false`. The two modes are equal-status code paths, not "mock first then real".

---

## Appendix A — Authoritative File Map

### Backend (`backend/`)

```
main.py                          FastAPI app factory, CORS, startup hook
config.py                        Pydantic BaseSettings — injectable module paths
database.py                      SQLite/PostgreSQL session factory (DATABASE_URL)
dependencies.py                  Runtime resolution of injectable modules
exceptions.py                    Typed domain exceptions

models/
  entity.py                      Entity table (client_id, relation_type, entity_type)
  phone_number.py                PhoneNumber table (3-phase block + extra_data)
  action_log.py                  ActionLog table (Phase 2 events + retry tracking)

schemas/
  ingestion.py                   IngestionPayload (input contract for /ingest)
  verification.py                Internal verdict shapes

interfaces/                      ABC contracts — NEVER add concrete logic here
  ingestion.py                   BaseIngestionRoutingEngine
  dispatcher.py                  BaseActionHandler
  verification.py                BaseVerificationStrategy

modules/                         Mock implementations of the ABCs
  mock_ingestion.py
  mock_dispatcher.py
  mock_feedback.py

services/                        Concrete service layer above the engines
  ingestion.py                   IngestionService
  dispatcher.py                  ActionDispatcher, RetryEngine, UserActionService,
                                 ActionDataTriggerService
  verification.py                VerificationService, VerificationEngine

app/api/
  deps.py                        FastAPI Depends factories for services + engines
  v1/router.py                   Aggregates the eight endpoint routers
  v1/endpoints/
    schema.py                    GET  /schema/lead-form
    ingestion.py                 POST /ingest
    phones.py                    GET  /phones, GET /phones/{id}, PATCH /phones/{id}
    actions.py                   POST /actions/trigger, POST /actions/retry-now/{id},
                                 GET  /actions/logs
    verification.py              POST /verification/verdict
    system.py                    POST /system/workers/run
    dashboard.py                 GET  /dashboard/metrics
  schemas/api_contracts.py       Pydantic request/response models (THE API CONTRACT)

scripts/
  seed_db.py                     Idempotent seed; --reset flag drops tables

tests/                           95 tests passing under pytest
  api/test_endpoints.py
  service/                       Per-service unit tests
  state_machine/test_retry_lifecycle.py     ← retry semantics gold standard
  transactional/test_rollback_invariants.py
  unit/test_abc_contracts.py
  unit/test_schemas.py
```

### Frontend (`frontend/`)

```
index.html                       lang="he" dir="rtl"
vite.config.js                   /api proxy to localhost:8000
tailwind.config.js               Custom keyframes (drawer flipped for RTL)
.env.example                     VITE_USE_REAL_API, VITE_API_BASE_URL

src/
  main.jsx                       BrowserRouter + all three context providers
  App.jsx                        AppShell + Routes + IngestionModal portal
  index.css                      Tailwind + custom keyframes

  config/
    clientRegistry.js            Integer client_id → display metadata (THE label seam)
    strings.he.js                ALL Hebrew strings (~200 named exports)

  api/
    client.js                    axios instance, MOCK_MODE flag, ApiError class,
                                 X-Request-ID interceptor, normalizeError
    adapters/
      paginationAdapter.js       unwrapPage + ApiShapeError
      schemaAdapter.js           normalizeFormSchema (handles dual options shape)
      phoneAdapter.js            enrichPhone + enrichPhoneDetail
    phonesApi.js                 listPhones, getPhoneDetail, patchPhone
    actionsApi.js                listActionLogs, triggerManualAction, retryNow
    ingestionApi.js              ingestCircleMember
    verificationApi.js           submitVerdict
    systemApi.js                 runWorker
    dashboardApi.js              getDashboardMetrics
    schemaApi.js                 getLeadFormSchema

  contexts/
    MockAuthContext.jsx          useAuth() — single auth seam
    MockDataContext.jsx          Cache + mutators + refetchPhones + refetchActionLogs
    UIContext.jsx                Modal state, toasts, persistent phone filters

  mock/
    mockData.js                  buildInitialDb, deriveClientMetrics, SEED_*

  components/
    layout/      AppShell, NavTabs, HeaderActions
    primitives/  Badge, Modal, ProgressBar, Toast
    clients/     ClientCard
    phones/      PhoneTable, PhoneRow, PhoneFilterBar,
                 ActionMiniPipeline,
                 PhoneDetailDrawer, JsonMetadataExplorer, VerticalAuditTimeline,
                 ManualActionModal, VerdictSplitButtons
    ops/         EngineControlCard, PipelineHealthStrip,
                 FailedActionsTable, ErrorAccordionCell
    dashboard/   ThroughputBars, QualityFunnel, SlaIndicator
    ingestion/   IngestionModal, DynamicField

  pages/         ClientHubPage, PhoneGridPage, SystemOpsPage, DashboardPage

  utils/         formatDate, classifyStatus, actionTypeIcons
```

---

## Appendix B — Environment Variables

### Backend (`backend/.env`, sourced via `config.py`)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./app.db` | DB DSN; switches engine without code change |
| `INGESTION_MODULE` | `modules.mock_ingestion:MockIngestionRoutingEngine` | DI path for the active ingestion engine |
| `ACTION_MODULE` | `modules.mock_dispatcher:MockActionHandler` | DI path for the active action handler |
| `VERIFICATION_MODULE` | `modules.mock_feedback:MockVerificationStrategy` | DI path for the active verification strategy |
| `SECRET_KEY` | — | Reserved for Phase G |

### Frontend (`frontend/.env.local`)

| Var | Default in `.env.example` | Purpose |
|---|---|---|
| `VITE_USE_REAL_API` | `false` | Master mock-mode toggle |
| `VITE_API_BASE_URL` | `/api/v1` | Backend base path. Same-origin under the Vite proxy and Nginx |

---

## Appendix C — Boot Sequence (real mode)

```
1.  Browser loads index.html (lang=he, dir=rtl)
2.  main.jsx mounts <BrowserRouter> with three context providers (Auth, Data, UI)
3.  MockDataContext mounts
    └─ MOCK_MODE === false → useEffect fires
       └─ Promise.all([
            listPhones({pageSize: 200}),           → GET /phones (200 max)
            listActionLogs({pageSize: 500})        → GET /actions/logs (500 max)
          ])
       └─ entities synthesized from phone JOIN data
       └─ clients sourced from CLIENT_REGISTRY (frontend-only)
       └─ setLoading(false)
4.  Routes render the requested page
    └─ Page reads phones/clients/actionLogs from useMockData()
    └─ Components reactively re-render whenever the cache changes
5.  Mutation flow:
    component → api/*.js function → apiClient.post/patch
                                  → await mockDb.refetchX()
                                  → setDb updates → components re-render
```

---

## Appendix D — Verification Checklist Before Beginning Phase D

Run through this in order. Do not begin Phase D implementation until every box is checked.

- [ ] `git log -5 --oneline` shows `73bef79` as the tip.
- [ ] `cd frontend && npm install && npm run build` exits 0 with zero warnings.
- [ ] `grep -rn "HOOK FOR ENTERPRISE AUTH" frontend/` returns at least 7 hits.
- [ ] `grep -rn "HOOK FOR ENTERPRISE LABELS" frontend/` returns at least 5 hits (in `clientRegistry.js`).
- [ ] `grep -rn "<real-corporate-name-redacted>" backend/ frontend/` returns 0 hits.
- [ ] With `VITE_USE_REAL_API=true` and a seeded backend on `:8000`, the Client Hub displays five client cards with non-zero metrics derived from real-mode `phones`.
- [ ] Clicking a client card navigates to `/phones?client_id=N` (integer in URL) and the table pre-filters correctly.
- [ ] Submitting a verdict via the drawer in real mode results in exactly: 1× `POST /verification/verdict`, then 1× `GET /phones`. The verdict status badge updates in both the drawer and the table row.
- [ ] Running the retry engine in real mode results in: 1× `POST /system/workers/run`, then 1× `GET /phones` and 1× `GET /actions/logs` in parallel.

If any of these fail, **fix them as a Phase B/C regression before starting Phase D**.

---

*End of handover specification. Signed off at commit `73bef79`.*
