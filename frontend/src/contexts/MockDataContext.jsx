/**
 * MockDataContext — in-memory database, mutators, and API hydration.
 *
 * MOCK_MODE = true  → boots from static seed (buildInitialDb), no network traffic.
 * MOCK_MODE = false → hydrates phones + actionLogs from the real API on mount;
 *                     clients come from clientRegistry, entities are synthesized
 *                     from the phone JOIN data returned by the backend.
 *
 * The mutator API is identical in both modes. Phase C replaces mock mutator calls
 * with real HTTP inside api/*.js — this context is never modified for that swap.
 *
 * // HOOK FOR ENTERPRISE AUTH — operatorId for attributed mutations is supplied
 * // by MockAuthContext, not read here. This context stays attribution-agnostic.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { buildInitialDb, deriveClientMetrics } from '../mock/mockData';
import { MOCK_MODE } from '../api/client';
import { listPhones, getPhoneDetail }     from '../api/phonesApi';
import { listTasks, getTaskDetail }        from '../api/tasksApi';
import { listEntities }                    from '../api/entityApi';
import { getSystemSettings }               from '../api/systemApi';
import { CLIENT_REGISTRY } from '../config/clientRegistry';

const MockDataContext = createContext(null);

// All ids are opaque strings (parity with the backend's string PKs). New
// mock rows get a fresh uuid-suffixed id per table; in real mode these ids
// come from the backend / system of record. The prefix is cosmetic — it
// just makes ids self-describing in the dev console.
const _uid = (prefix) => {
  const rand =
    (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${rand}`;
};

// Real-API hydration helpers — mirror the mock's buildInitialDb shape so
// downstream consumers see the same fields regardless of the data source.
//
// _normalizeDeletedAt: the backend uses a far-future SOFT_DELETE_SENTINEL
//   (year 9999) to mean "active" — a TRUTHY string. The whole frontend
//   treats a truthy deleted_at as "this row is deleted" (e.g.
//   `if (e.deleted_at) continue`). Without normalising it, every active
//   backend row would be hidden. Collapse the sentinel back to null so
//   active rows read as active, exactly like the mock seed.
// _enrichEntities: stamps root_entity_id = target_entity_id ?? id on every row.
//   Two-level model: a root entity (target_entity_id == null) is its own
//   client; a member's root_entity_id is the root it points at.
// _enrichPhones:   stamps root_entity_id + relation_type onto every phone from
//                  its owning entity (so phone filters / client lookups work).
// _clientsFromEntities: builds the clients slice from active root entities,
//                  with optional display overrides from CLIENT_REGISTRY when
//                  the entity id matches a registry key.
function _normalizeDeletedAt(value) {
  // Active sentinel = year 9999. Anything else (a real past timestamp)
  // is a genuine soft-delete and stays as-is.
  if (value == null) return null;
  if (typeof value === 'string' && value.startsWith('9999')) return null;
  return value;
}

function _enrichEntities(entities) {
  return (entities || []).map((e) => ({
    ...e,
    deleted_at: _normalizeDeletedAt(e.deleted_at),
    root_entity_id: e.target_entity_id != null ? e.target_entity_id : e.id,
  }));
}

function _enrichPhones(phones, entities) {
  const entityById = new Map((entities || []).map((e) => [e.id, e]));
  return (phones || []).map((p) => {
    const ent = entityById.get(p.entity_id);
    return {
      ...p,
      root_entity_id:     ent?.root_entity_id ?? null,
      relation_type: ent?.relation_type ?? p.relation_type ?? null,
    };
  });
}

function _clientsFromEntities(entities) {
  const overrides = new Map(CLIENT_REGISTRY.map((c) => [c.id, c]));
  return (entities || [])
    .filter(
      (e) =>
        e.relation_type === 'primary' &&
        e.target_entity_id == null &&
        !e.deleted_at,
    )
    .map((e) => {
      const ov = overrides.get(e.id);
      return {
        id:                e.id,
        name:              e.full_name || ov?.name || e.id,
        shortName:         ov?.shortName,
        sla_hours:         e.extra_data?.sla_hours ?? ov?.slaHours ?? null,
        sla_threshold_pct: e.extra_data?.sla_threshold_pct ?? ov?.slaTargetPct ?? null,
        color:             ov?.color,
      };
    });
}

// _enrichTasks: the backend task response carries entity_id + full_name but
//   NOT root_entity_id/client_name. The OperationsQueue's client column and the
//   taskAdapter both expect root_entity_id. Resolve it through the owning entity
//   (task.entity_id → entity.root_entity_id) and stamp root_entity_id + client_name so
//   "who does this task belong to" renders instead of "Unassigned".
function _enrichTasks(tasks, entities, clients) {
  const entityById = new Map((entities || []).map((e) => [e.id, e]));
  const clientById = new Map((clients || []).map((c) => [c.id, c]));
  return (tasks || []).map((t) => {
    const ent      = entityById.get(t.entity_id);
    const rootEntityId = ent?.root_entity_id ?? null;
    const client   = rootEntityId != null ? clientById.get(rootEntityId) : null;
    return {
      ...t,
      root_entity_id:   rootEntityId,
      client_name: client?.name ?? ent?.full_name ?? t.client_name ?? null,
    };
  });
}

// Minimal empty db used as the real-mode boot state while the API hydrates.
const EMPTY_DB = {
  clients:    [],
  entities:   [],
  phones:     [],
  tasks:      [],
  engines:    {
    retry:        { executing: false, lastRunAt: null, lastProcessedCount: 0 },
    verification: { executing: false, lastRunAt: null, lastProcessedCount: 0 },
  },
  // Phase NOTIF — subscription rules + delivery audit trail seeded
  // empty. Operators populate them inline at workflow completion
  // (NotificationOptInPanel). buildInitialDb() merges over these
  // defaults so the seed file can stay focused on phone / task data.
  notificationSubscriptions: [],
  notificationDeliveries:    [],
  // Phase AUTH — mock users + the "currently logged-in" pointer.
  // In real mode the backend tracks this via the session cookie;
  // here we keep an in-memory mirror so the AuthContext's mock
  // mode can hydrate from existing state. Seeded empty — tests
  // that need a pre-logged-in operator inject initialState on
  // <AuthProvider initialState={...}> directly rather than going
  // through this layer.
  users:               [],
  currentMockUserId:   null,
  // System Settings tab — admin-only infra controls. buildInitialDb()
  // overwrites this with the seeded default; in real mode the
  // System Settings page fetches from GET /system/settings.
  systemSettings:      null,
};

export function MockDataProvider({ children }) {
  const [db, setDb]           = useState(MOCK_MODE ? buildInitialDb : () => EMPTY_DB);
  const [loading, setLoading] = useState(!MOCK_MODE);

  // -------------------------------------------------------------------------
  // _currentOperatorUsername — Phase AUTH-B helper.
  //
  // Resolves the operator username for mock-mode mutators that
  // previously read `body.operator_id`, `body.requested_by`, or
  // `body.created_by`. Order:
  //   1. currentMockUserId → users[id].username
  //   2. caller-supplied fallback (backward compat for tests that
  //      still pass operator_id explicitly)
  //   3. the literal `fallback` value (often null)
  //
  // Declared near the top of the provider so every downstream mutator
  // can reference it via closure + useCallback dep array. Without this
  // hoist, JavaScript's temporal-dead-zone forbids any mutator
  // declared earlier from referencing it.
  // -------------------------------------------------------------------------
  const _currentOperatorUsername = useCallback((fallback = null) => {
    if (db.currentMockUserId != null) {
      const u = (db.users || []).find((u) => u.id === db.currentMockUserId);
      if (u) return u.username;
    }
    return fallback;
  }, [db.users, db.currentMockUserId]);

  // ---------------------------------------------------------------------------
  // Real-API boot hydration — fires once on mount when MOCK_MODE = false.
  // Fetches phones + action logs + tasks, synthesizes entities, seeds clients
  // from clientRegistry. Components stay unchanged — they read context as before.
  //
  // Phase DX amendment to Phase D exit gate §6.2.3: the original "exactly two
  // parallel requests" rule generalises to "exactly N parallel requests where
  // N = independent top-level cache slices." With the tasks slice introduced,
  // N is now 3.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (MOCK_MODE) return;

    setLoading(true);
    // Phase AUTH-C — tolerate per-slice failures. /tasks is admin-only
    // and /action-logs requires an authenticated session; guests and
    // regular users should still see Phones + Clients Hub even when
    // those endpoints 401/403.
    //
    // UAT round-3 fix: entities used to be SYNTHESIZED from the phones
    // list (one synthetic entity per distinct phone.entity_id). That
    // missed every entity with zero phones — newly-created entities,
    // freshly minted envelopes, root targets in clients with no phones
    // yet — and made them invisible in the pickers. Switch to a real
    // GET /entities boot fetch so the entities slice is authoritative.
    Promise.allSettled([
      // Single full-dataset boot fetch — no upstream pagination. Every
      // downstream metric (per-group phone counts, client-hub totals,
      // pipeline strip) needs the complete picture, and the UI groups
      // results so display volume isn't a concern.
      listPhones({ pageSize: 1_000_000 }),
      listTasks({ pageSize: 1_000_000 }),
      listEntities({}, /* mockDb */ null),
      // System settings carry the operator-managed vocabularies (closed
      // lists). Fetched at boot so every controlled dropdown reads from one
      // hydrated source instead of hardcoded constants.
      getSystemSettings(/* mockDb */ null),
    ])
      .then(([phonesRes, tasksRes, entitiesRes, settingsRes]) => {
        const phonesRaw    = phonesRes.status   === 'fulfilled' ? phonesRes.value   : [];
        const tasksData    = tasksRes.status    === 'fulfilled' ? tasksRes.value    : [];
        const entitiesRaw  = entitiesRes.status === 'fulfilled' ? entitiesRes.value : [];
        const settingsData = settingsRes.status === 'fulfilled' ? settingsRes.value : null;

        const entitiesData = _enrichEntities(entitiesRaw);
        const phonesData   = _enrichPhones(phonesRaw, entitiesData);
        const clientsData  = _clientsFromEntities(entitiesData);
        const tasksEnriched = _enrichTasks(tasksData, entitiesData, clientsData);

        setDb((prev) => ({
          ...prev,
          phones:   phonesData,
          tasks:    tasksEnriched,
          entities: entitiesData,
          clients:  clientsData,
          systemSettings: settingsData || prev.systemSettings,
        }));
      })
      .finally(() => setLoading(false));
  }, []);

  // Expose raw state slices
  const { clients, entities, phones, tasks, engines } = db;

  // ---------------------------------------------------------------------------
  // refetchPhones — re-hydrates phones + entities from the server.
  // No-op in mock mode. Called by API mutation functions after successful HTTP
  // mutations to enforce the server-as-single-source-of-truth contract.
  // ---------------------------------------------------------------------------
  const refetchPhones = useCallback(async () => {
    if (MOCK_MODE) return;
    const phonesRaw = await listPhones({ pageSize: 1_000_000 });
    setDb((prev) => ({
      ...prev,
      phones: _enrichPhones(phonesRaw, prev.entities),
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // Phase D — targeted SWR-style merges (real-API mode only).
  //
  // These helpers swap the wholesale refetch pattern for narrow updates keyed
  // by id. The single-item mutation paths (verdict, patch, retry, trigger)
  // call into refetchPhoneById / refetchLogsForPhone instead of dragging the
  // full list down on every change. Ingest and runWorker keep the full
  // refetch because their blast radius is wider than one id.
  //
  // mergePhoneById   — replace by id, append if new; rebuild the synthetic
  //                    entity entry from the merged phone so derived selectors
  //                    (getClientForPhone, deriveClientMetrics) stay coherent.
  // mergeLogsByPhoneId — drop existing logs for phoneId, splice in fresh batch.
  //                    Used after triggerManualAction / retryNow to keep the
  //                    drawer timeline and failed-actions table in sync.
  // ---------------------------------------------------------------------------

  const mergePhoneById = useCallback((flatPhone) => {
    if (!flatPhone || flatPhone.id == null) return;
    setDb((prev) => {
      const exists = prev.phones.some((p) => p.id === flatPhone.id);
      const phones = exists
        ? prev.phones.map((p) => (p.id === flatPhone.id ? flatPhone : p))
        : [...prev.phones, flatPhone];

      return { ...prev, phones };
    });
  }, []);

  // refetchPhoneById — narrow refetch for single-phone mutations.
  // Uses GET /phones/{id}; flattens the detail-shape response (entity nested,
  // action_timeline included) back into the list-shape PhoneSummary stored
  // in db.phones, so consumers continue to see the same shape they do after
  // the wholesale refetchPhones() boot path.
  const refetchPhoneById = useCallback(async (id) => {
    if (MOCK_MODE || id == null) return;
    const detail = await getPhoneDetail(id);
    const { entity, ...rest } = detail;
    const flat = {
      ...rest,
      root_entity_id:   entity?.root_entity_id,
      client_name: entity?.client_name,
    };
    mergePhoneById(flat);
  }, [mergePhoneById]);

  // ---------------------------------------------------------------------------
  // Phase DX — Pipeline tasks cache slice.
  //
  // mergeTaskById   — replace-by-id or append a single task. Same merge
  //                   primitive as mergePhoneById / spliceActionLog.
  // refetchTasks    — wholesale; used by openTask (new server-assigned id).
  // refetchTaskById — narrow refetch keyed by id; used by resolveTask.
  // ---------------------------------------------------------------------------

  const mergeTaskById = useCallback((task) => {
    if (!task || task.id == null) return;
    setDb((prev) => {
      const exists = prev.tasks.some((t) => t.id === task.id);
      const next = exists
        ? prev.tasks.map((t) => (t.id === task.id ? task : t))
        : [...prev.tasks, task];
      return { ...prev, tasks: next };
    });
  }, []);

  const refetchTasks = useCallback(async () => {
    if (MOCK_MODE) return;
    const fresh = await listTasks({ pageSize: 1_000_000 });
    setDb((prev) => ({
      ...prev,
      tasks: _enrichTasks(fresh, prev.entities, prev.clients),
    }));
  }, []);

  // UAT round-3: entities is now a real slice (not synthesized). Mutators
  // that create/patch/delete entities (createEntity, createEnvelope,
  // patchEntity, soft-delete, restore) call this so the pickers see the
  // freshly-minted row without a page reload.
  const refetchEntities = useCallback(async () => {
    if (MOCK_MODE) return;
    const freshRaw = await listEntities({}, null);
    const entities = _enrichEntities(freshRaw);
    const clients  = _clientsFromEntities(entities);
    setDb((prev) => ({
      ...prev,
      entities,
      clients,
      // Re-enrich phones so root_entity_id stamps reflect any
      // relationship moves (rare but possible via PATCH /entities).
      phones: _enrichPhones(prev.phones, entities),
    }));
  }, []);

  const refetchTaskById = useCallback(async (id) => {
    if (MOCK_MODE || id == null) return;
    const fresh = await getTaskDetail(id);
    mergeTaskById(fresh);
  }, [mergeTaskById]);

  // -------------------------------------------------------------------------
  // applyIngest
  // -------------------------------------------------------------------------
  const applyIngest = useCallback((payload) => {
    setDb((prev) => {
      const nextEntityId = _uid('ent');
      const nextPhoneId  = _uid('ph');
      const now = new Date().toISOString();

      const newEntity = {
        id:            nextEntityId,
        relation_type: 'primary',
        root_entity_id:     payload.root_entity_id || null,
        extra_data:    payload.entity_extra || {},
      };

      const newPhone = {
        id:                  nextPhoneId,
        entity_id:           nextEntityId,
        phone_number:        payload.phone_number,
        phone_type:          payload.phone_type || null,
        ingestion_source:    payload.ingestion_source,
        verification_status: 'pending',
        score:               null,
        extra_data:          {},
      };

      return {
        ...prev,
        entities:   [...prev.entities, newEntity],
        phones:     [...prev.phones, newPhone],
      };
    });
  }, []);

  // -------------------------------------------------------------------------
  // applyCreateEntity — mock-mode parity for POST /api/v1/entities (Phase E2-A).
  //
  // Mirrors EntityIngestionService.create_single on the backend:
  //   - validate target exists AND is a root (target_entity_id IS NULL)
  //   - inherit root_entity_id from the target
  //   - merge first_name / last_name into extra_data (Secrets-Free Mandate)
  //   - create exactly one new Entity row
  //
  // Returns the EntitySingleCreateOut-shaped object the frontend uses for
  // the friction-free success panel + handoff to the phone modal.
  // Throws an Error on missing / non-root target so the API client can
  // surface it like a 422.
  // -------------------------------------------------------------------------
  const applyCreateEntity = useCallback((payload) => {
    let result;
    setDb((prev) => {
      const target = prev.entities.find((e) => e.id === payload.target_entity_id);
      if (!target) {
        throw new Error(`entity_id=${payload.target_entity_id} not found`);
      }
      if (target.target_entity_id != null) {
        throw new Error(
          `entity_id=${payload.target_entity_id} is not a root target ` +
          `(its own target_entity_id is non-NULL)`,
        );
      }

      const nextId  = _uid('ent');
      const fullName = String(payload.full_name || '').trim() || null;

      const newEntity = {
        id:               nextId,
        root_entity_id:        target.root_entity_id,
        relation_type:    payload.relation_type,
        target_entity_id: target.id,
        full_name:        fullName,
        extra_data:       payload.extra_data || {},
      };

      result = {
        id:               newEntity.id,
        root_entity_id:        newEntity.root_entity_id,
        relation_type:    newEntity.relation_type,
        target_entity_id: newEntity.target_entity_id,
        full_name:        fullName,
      };

      return { ...prev, entities: [...prev.entities, newEntity] };
    });
    return result;
  }, []);

  // -------------------------------------------------------------------------
  // applyEntityBulkText — mock-mode parity for POST /api/v1/entities/bulk-text.
  //
  // Mirrors EntityIngestionService.ingest_bulk_text on the backend:
  //   - validate request-level default target (must exist + be root)
  //     → throws on failure so the API client surfaces it like a 422
  //   - per-row Pass 1: validate first_name, relation_type, target
  //   - per-row Pass 2: create one Entity per surviving candidate
  //   - bulk_submission_id stamped on every new entity's extra_data
  // -------------------------------------------------------------------------
  const applyEntityBulkText = useCallback((payload) => {
    const ASSOCIATED = new Set(['family', 'friend', 'colleague', 'spouse']);
    const submissionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `mock-${Date.now()}-${Math.random()}`;

    let result;
    setDb((prev) => {
      // Pre-flight — default target validation. Throws so the API
      // client maps it to an error toast (the backend returns 422).
      const defaultTarget = prev.entities.find(
        (e) => e.id === payload.default_target_entity_id,
      );
      if (!defaultTarget) {
        throw new Error(`entity_id=${payload.default_target_entity_id} not found`);
      }
      if (defaultTarget.target_entity_id != null) {
        throw new Error(
          `entity_id=${payload.default_target_entity_id} is not a root target`,
        );
      }

      // Pre-resolve every per-row target override in one pass.
      const targetById = new Map();
      targetById.set(defaultTarget.id, defaultTarget);
      for (const r of (payload.rows || [])) {
        const tgt = r.target_entity_id;
        if (tgt != null && !targetById.has(tgt)) {
          const ent = prev.entities.find((e) => e.id === tgt);
          if (ent) targetById.set(tgt, ent);
        }
      }

      const failedRows = [];
      const candidates = [];

      (payload.rows || []).forEach((row, idx) => {
        const rowNum = idx + 1;
        const token  = (row.row_token || '').slice(0, 200);

        const first = String(row.full_name || row.first_name || '').trim();
        if (!first) {
          failedRows.push({ row: rowNum, input: token, error: 'full_name is required' });
          return;
        }

        const relation = row.relation_type || payload.default_relation_type;
        if (!ASSOCIATED.has(relation)) {
          failedRows.push({
            row: rowNum, input: token,
            error: `Invalid relation_type '${relation}'`,
          });
          return;
        }

        const tgtId = row.target_entity_id != null
          ? row.target_entity_id
          : payload.default_target_entity_id;
        const tgt = targetById.get(tgtId);
        if (!tgt) {
          failedRows.push({
            row: rowNum, input: token,
            error: `target_entity_id=${tgtId} not found`,
          });
          return;
        }
        if (tgt.target_entity_id != null) {
          failedRows.push({
            row: rowNum, input: token,
            error: `target_entity_id=${tgtId} is not a root target`,
          });
          return;
        }

        candidates.push({
          row: rowNum,
          rowToken: row.row_token || '',
          fullName: first,
          relation,
          target: tgt,
        });
      });

      // Pass 2 — build new entities.
      const now  = new Date().toISOString();
      const newEntities = candidates.map((c) => {
        const extra = { bulk_submission_id: submissionId };
        if (c.rowToken) extra.row_token = c.rowToken;
        const ent = {
          id:               _uid('ent'),
          root_entity_id:        c.target.root_entity_id,
          relation_type:    c.relation,
          target_entity_id: c.target.id,
          full_name:        c.fullName || null,
          extra_data:       extra,
        };
        return ent;
      });

      failedRows.sort((a, b) => a.row - b.row);
      result = {
        success_count:      newEntities.length,
        failed_count:       failedRows.length,
        phone_ids:          [],
        entity_ids:         newEntities.map((e) => e.id),
        failed_rows:        failedRows,
        bulk_submission_id: submissionId,
      };

      return { ...prev, entities: [...prev.entities, ...newEntities] };
    });
    return result;
  }, []);

  // -------------------------------------------------------------------------
  // applyEntityBulkUploadCsv — mock-mode parity for /api/v1/entities/bulk-upload.
  //
  // Mirrors EntityIngestionService.ingest_bulk_upload (CSV path):
  //   - header row required; required columns: first_name, relation_type,
  //     target_entity_id. Optional: last_name.
  //   - each row is its own ingestion context (own target, own relation)
  //   - per-row validation; per-row failures land in failed_rows
  //
  // Throws Error on file-shape problems (missing required columns, empty
  // file) so the API client surfaces them as 422-equivalent toasts.
  // -------------------------------------------------------------------------
  const applyEntityBulkUploadCsv = useCallback((csvText) => {
    const REQUIRED = ['full_name', 'relation_type', 'target_entity_id'];
    const ASSOCIATED = new Set(['family', 'friend', 'colleague', 'spouse']);
    const INPUT_CAP = 200;

    const lines = csvText.split(/\r?\n/);
    if (lines.length === 0 || !lines[0].trim()) {
      throw new Error('CSV is empty or has no header row');
    }
    // Strip UTF-8 BOM if present.
    const bom = '﻿';
    if (lines[0].startsWith(bom)) lines[0] = lines[0].slice(bom.length);

    const header = lines[0].split(',').map((s) => s.trim());
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (missing.length) {
      throw new Error(`CSV header missing required columns: ${missing.join(', ')}`);
    }

    // Parse rows (no quoted-comma support — matches the mock's phone bulk CSV).
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cells = line.split(',').map((c) => c.trim());
      const row = {};
      header.forEach((col, idx) => { row[col] = cells[idx] ?? ''; });
      rows.push(row);
    }

    const submissionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `mock-${Date.now()}-${Math.random()}`;

    let result;
    setDb((prev) => {
      // Pre-resolve all referenced target_entity_id values in one pass.
      // Ids are opaque strings — normalise to a trimmed string and resolve.
      const targetById = new Map();
      for (const row of rows) {
        const raw = row.target_entity_id;
        if (raw == null || raw === '') continue;
        const id = String(raw).trim();
        if (targetById.has(id)) continue;
        const ent = prev.entities.find((e) => e.id === id);
        if (ent) targetById.set(id, ent);
      }

      const failedRows = [];
      const candidates = [];

      rows.forEach((row, idx) => {
        const rowNum = idx + 1;
        const echo   = JSON.stringify(row).slice(0, INPUT_CAP);

        const first = String(row.full_name || '').trim();
        if (!first) {
          failedRows.push({ row: rowNum, input: echo, error: 'Missing full_name' });
          return;
        }
        const relation = String(row.relation_type || '').trim();
        if (!ASSOCIATED.has(relation)) {
          failedRows.push({
            row: rowNum, input: echo,
            error: `Invalid relation_type '${relation}'`,
          });
          return;
        }
        const tgtRaw = row.target_entity_id;
        if (tgtRaw == null || tgtRaw === '') {
          failedRows.push({ row: rowNum, input: echo, error: 'Missing target_entity_id' });
          return;
        }
        const tgtId = String(tgtRaw).trim();
        const tgt = targetById.get(tgtId);
        if (!tgt) {
          failedRows.push({
            row: rowNum, input: echo,
            error: `target_entity_id=${tgtId} not found`,
          });
          return;
        }
        if (tgt.target_entity_id != null) {
          failedRows.push({
            row: rowNum, input: echo,
            error: `target_entity_id=${tgtId} is not a root target`,
          });
          return;
        }
        candidates.push({
          row: rowNum, fullName: first,
          relation, target: tgt,
        });
      });

      const now  = new Date().toISOString();
      const newEntities = candidates.map((c) => {
        const ent = {
          id:               _uid('ent'),
          root_entity_id:        c.target.root_entity_id,
          relation_type:    c.relation,
          target_entity_id: c.target.id,
          full_name:        c.fullName || null,
          extra_data:       { bulk_submission_id: submissionId },
        };
        return ent;
      });

      failedRows.sort((a, b) => a.row - b.row);
      result = {
        success_count:      newEntities.length,
        failed_count:       failedRows.length,
        phone_ids:          [],
        entity_ids:         newEntities.map((e) => e.id),
        failed_rows:        failedRows,
        bulk_submission_id: submissionId,
      };

      return { ...prev, entities: [...prev.entities, ...newEntities] };
    });
    return result;
  }, []);

  // -------------------------------------------------------------------------
  // applyBulkIngest — mock-mode parity for POST /api/v1/phones/bulk-text.
  //
  // Mirrors BulkIngestionService.ingest_bulk_text on the backend:
  //   - tokenize on commas, semicolons, whitespace
  //   - normalize each token (strip non-digit / non-plus chars)
  //   - validate format (^\+?\d{7,15}$)
  //   - within-batch dedup keyed on the normalized form
  //   - collect failed rows, return BulkIngestSummary-shaped object
  //   - no orphan Entity when zero rows survive
  //
  // Synchronous (operates on state via the same setDb closure other mock
  // mutators use); returns the summary via a synchronous read of the state
  // captured before/after the update.
  // -------------------------------------------------------------------------
  const applyBulkIngest = useCallback((payload) => {
    const submissionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `mock-${Date.now()}-${Math.random()}`;

    const TOKEN_SPLIT = /[,\s;]+/;
    const PHONE_CLEAN = /[^\d+]/g;
    const PHONE_REGEX = /^\+?\d{7,15}$/;
    const INPUT_CAP   = 200;

    // ----- Pass 1: tokenize / normalize / validate / dedup ------------------
    const tokens = (payload.phone_numbers_raw || '').split(TOKEN_SPLIT).filter(Boolean);
    const failedRows = [];
    const candidates = [];      // { row, raw, normalized }
    const seen       = new Map();   // normalized → first row

    tokens.forEach((raw, i) => {
      const row = i + 1;
      const normalized = raw.trim().replace(PHONE_CLEAN, '');
      if (!normalized) {
        failedRows.push({ row, input: raw.slice(0, INPUT_CAP), error: 'Empty after normalization' });
        return;
      }
      if (!PHONE_REGEX.test(normalized)) {
        failedRows.push({ row, input: raw.slice(0, INPUT_CAP), error: 'Invalid phone format' });
        return;
      }
      if (seen.has(normalized)) {
        failedRows.push({
          row,
          input: raw.slice(0, INPUT_CAP),
          error: `Duplicate of row ${seen.get(normalized)} in this batch`,
        });
        return;
      }
      seen.set(normalized, row);
      candidates.push({ row, raw, normalized });
    });

    // Empty-candidates short-circuit — no orphan entity created.
    if (candidates.length === 0) {
      return {
        success_count:      0,
        failed_count:       failedRows.length,
        phone_ids:          [],
        entity_ids:         [],
        failed_rows:        failedRows.sort((a, b) => a.row - b.row),
        bulk_submission_id: submissionId,
      };
    }

    // ----- Pass 2: commit the new Entity + N PhoneNumbers to mock state -----
    // Wrap in a setDb to perform the mutation atomically. We hoist the
    // resulting summary out via a closure-mutated `result` ref.
    let result;
    setDb((prev) => {
      const nextEntityId = _uid('ent');
      const now = new Date().toISOString();

      const newEntity = {
        id:               nextEntityId,
        relation_type:    payload.relation_type === 'primary' ? 'primary' : 'associated',
        root_entity_id:        payload.root_entity_id ?? null,
        target_entity_id: payload.target_entity_id ?? null,
        extra_data: {
          ...(payload.entity_extra || {}),
          bulk_submission_id: submissionId,
        },
      };

      const newPhones = candidates.map(({ normalized }) => {
        const id = _uid('ph');
        return {
          id,
          entity_id:           nextEntityId,
          phone_number:        normalized,
          phone_type:          null,
          ingestion_source:    payload.ingestion_source,
          verification_status: 'pending',
          score:               null,
          extra_data: {
            ...(payload.phone_extra_shared || {}),
            bulk_submission_id: submissionId,
          },
        };
      });

      result = {
        success_count:      newPhones.length,
        failed_count:       failedRows.length,
        phone_ids:          newPhones.map((p) => p.id),
        entity_ids:         [newEntity.id],
        failed_rows:        failedRows.sort((a, b) => a.row - b.row),
        bulk_submission_id: submissionId,
      };

      return {
        ...prev,
        entities: [...prev.entities, newEntity],
        phones:   [...prev.phones, ...newPhones],
      };
    });

    return result;
  }, []);

  // -------------------------------------------------------------------------
  // applyBulkUploadCsv — mock-mode parity for POST /api/v1/phones/bulk-upload.
  //
  // Mirrors BulkIngestionService.ingest_bulk_upload on the backend:
  //   - parse CSV text (header row required; required columns must be present)
  //   - per-row validation: phone format, root_entity_id int, required fields,
  //     optional target_entity_id integer, within-batch dedup
  //   - one Entity per surviving row (NOT one shared envelope — different
  //     from bulk-text)
  //   - per-row failures collected; no orphan if every row failed
  //
  // Throws ValueError-equivalent (Error with descriptive message) on
  // file-shape problems: missing required columns, empty file, etc.
  // The caller (bulkIngestUpload) surfaces these as endpoint-level errors.
  // -------------------------------------------------------------------------
  const applyBulkUploadCsv = useCallback((csvText) => {
    const REQUIRED = ['phone_number', 'root_entity_id', 'relation_type', 'ingestion_source'];
    const PHONE_CLEAN = /[^\d+]/g;
    const PHONE_REGEX = /^\+?\d{7,15}$/;
    const INPUT_CAP   = 200;

    // -------- Minimal CSV parser (no quoted-comma support; sufficient for
    // the mock-mode workflow since operators paste structured contact lists,
    // not free-form prose). Backend uses csv.DictReader for the real path.
    const lines = csvText.split(/\r?\n/).map((l) => l).filter((l, idx) => {
      // Drop the trailing blank line that splitlines naturally produces.
      if (idx === 0) return true;
      return l.trim() !== '' || idx === 0;
    });
    if (lines.length === 0 || !lines[0].trim()) {
      throw new Error('CSV is empty or has no header row');
    }
    // Strip UTF-8 BOM if present.
    const bom = '﻿';
    if (lines[0].startsWith(bom)) lines[0] = lines[0].slice(bom.length);

    const header = lines[0].split(',').map((c) => c.trim());
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (missing.length) {
      throw new Error(`CSV header missing required columns: ${missing.join(', ')}`);
    }

    const dataRows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const raw = lines[i];
      if (raw.trim() === '') continue;
      const cells = raw.split(',').map((c) => c.trim());
      const row = {};
      header.forEach((col, idx) => { row[col] = cells[idx] ?? ''; });
      dataRows.push(row);
    }

    const submissionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `mock-${Date.now()}-${Math.random()}`;

    const failedRows = [];
    const candidates = [];          // { row_idx, row_dict, normalized }
    const seenPhones = new Map();

    const safeInputStr = (row) => {
      const parts = REQUIRED.concat(['target_entity_id'])
        .map((c) => (row[c] != null && row[c] !== '' ? `${c}=${row[c]}` : null))
        .filter(Boolean);
      return (parts.join(' | ') || '(empty row)').slice(0, INPUT_CAP);
    };

    dataRows.forEach((rowIn, idx) => {
      const rowIdx = idx + 1;
      const row = { ...rowIn };
      const rawPhone = String(row.phone_number || '').trim();
      if (!rawPhone) {
        failedRows.push({ row: rowIdx, input: safeInputStr(row), error: 'Missing phone_number' });
        return;
      }
      const normalized = rawPhone.replace(PHONE_CLEAN, '');
      if (!normalized || !PHONE_REGEX.test(normalized)) {
        failedRows.push({ row: rowIdx, input: rawPhone.slice(0, INPUT_CAP), error: 'Invalid phone format' });
        return;
      }
      const missingFields = ['relation_type', 'ingestion_source'].filter((c) => !row[c]);
      // root_entity_id may legitimately be "0" — treat presence-of-value as the test.
      if (row.root_entity_id === '' || row.root_entity_id == null) missingFields.unshift('root_entity_id');
      if (missingFields.length) {
        failedRows.push({
          row: rowIdx,
          input: rawPhone.slice(0, INPUT_CAP),
          error: `Missing required field(s): ${missingFields.join(', ')}`,
        });
        return;
      }
      // Ids are opaque strings — normalise to a trimmed string id.
      row.root_entity_id = String(row.root_entity_id).trim();
      if (row.target_entity_id !== '' && row.target_entity_id != null) {
        row.target_entity_id = String(row.target_entity_id).trim();
      } else {
        row.target_entity_id = null;
      }
      if (seenPhones.has(normalized)) {
        failedRows.push({
          row: rowIdx, input: rawPhone.slice(0, INPUT_CAP),
          error: `Duplicate of row ${seenPhones.get(normalized)} in this batch`,
        });
        return;
      }
      seenPhones.set(normalized, rowIdx);
      row._normalized_phone = normalized;
      candidates.push({ rowIdx, row });
    });

    if (candidates.length === 0) {
      return {
        success_count:      0,
        failed_count:       failedRows.length,
        phone_ids:          [],
        entity_ids:         [],
        failed_rows:        failedRows.sort((a, b) => a.row - b.row),
        bulk_submission_id: submissionId,
      };
    }

    let result;
    setDb((prev) => {
      // entity + phone ids generated per row below (string ids).
      const now = new Date().toISOString();

      // Per-row target_entity_id existence check INSIDE the mutation — a
      // bad id is a per-row failure, not a request-level abort (this is the
      // contract that differs from /bulk-text).
      const existingEntityIds = new Set(prev.entities.map((e) => e.id));

      const newEntities = [];
      const newPhones   = [];
      const succeededRows = [];

      candidates.forEach(({ rowIdx, row }) => {
        if (row.target_entity_id != null && !existingEntityIds.has(row.target_entity_id)) {
          failedRows.push({
            row: rowIdx,
            input: row._normalized_phone.slice(0, INPUT_CAP),
            error: `target_entity_id=${row.target_entity_id} not found`,
          });
          return;
        }
        const entityId = _uid('ent');
        const phoneId = _uid('ph');

        newEntities.push({
          id:               entityId,
          relation_type:    row.relation_type === 'primary' ? 'primary' : 'associated',
          root_entity_id:        row.root_entity_id,
          target_entity_id: row.target_entity_id,
          extra_data:       { bulk_submission_id: submissionId },
        });

        newPhones.push({
          id:                  phoneId,
          entity_id:           entityId,
          phone_number:        row._normalized_phone,
          phone_type:          null,
          ingestion_source:    row.ingestion_source,
          verification_status: 'pending',
          score:               null,
          extra_data:          { bulk_submission_id: submissionId },
        });

        succeededRows.push({ entityId, phoneId });
      });

      result = {
        success_count:      succeededRows.length,
        failed_count:       failedRows.length,
        phone_ids:          succeededRows.map((r) => r.phoneId),
        entity_ids:         succeededRows.map((r) => r.entityId),
        failed_rows:        failedRows.sort((a, b) => a.row - b.row),
        bulk_submission_id: submissionId,
      };

      return {
        ...prev,
        entities: [...prev.entities, ...newEntities],
        phones:   [...prev.phones, ...newPhones],
      };
    });

    return result;
  }, []);

  // -------------------------------------------------------------------------
  // applyPatchPhone
  // -------------------------------------------------------------------------
  const applyPatchPhone = useCallback((phoneId, partial) => {
    setDb((prev) => ({
      ...prev,
      phones: prev.phones.map((p) =>
        p.id === phoneId
          ? { ...p, ...partial, updated_at: new Date().toISOString() }
          : p
      ),
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyVerdict
  // -------------------------------------------------------------------------
  const applyVerdict = useCallback((phoneId, status, operatorId) => {
    setDb((prev) => ({
      ...prev,
      phones: prev.phones.map((p) =>
        p.id === phoneId
          ? {
              ...p,
              verification_status: status,
              extra_data:          { ...p.extra_data, last_verdict_by: operatorId },
            }
          : p
      ),
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyTwoAxisVerdict (Phase DY-4-C, mock-mode only)
  //
  // Mirrors VerificationService.apply_two_axis_verdict on the backend.
  // Mutates the in-memory phone (confidence_score / verification_*) and,
  // when needed, the owning entity (target_entity_id severance for
  // relation_axis=refute; entity_type promotion for identification).
  // -------------------------------------------------------------------------
  const applyTwoAxisVerdict = useCallback((phoneId, payload, operatorId) => {
    setDb((prev) => {
      const phoneIdx = prev.phones.findIndex((p) => p.id === phoneId);
      if (phoneIdx === -1) return prev;
      const phone    = { ...prev.phones[phoneIdx] };
      const ownerIdx = prev.entities.findIndex((e) => e.id === phone.entity_id);
      const entity   = ownerIdx !== -1 ? { ...prev.entities[ownerIdx] } : null;

      // Phone axis: drives confidence score
      if (payload.phone_axis === 'confirm') {
        phone.score = 1.0;
        phone.verification_status = 'verified';
      } else if (payload.phone_axis === 'refute') {
        phone.score = 0.0;
        phone.verification_status = 'rejected';
        if (entity) entity.target_entity_id = null;
      }

      // Relation axis
      if (payload.relation_axis === 'confirm') {
        phone.verification_status = 'verified';
      } else if (payload.relation_axis === 'refute') {
        phone.verification_status = 'rejected';
        if (entity) entity.target_entity_id = null;
      }

      // Identification: update entity relation_type + full_name
      if (payload.identification && entity) {
        const ident = payload.identification;
        if (ident.relation === 'unrelated') {
          entity.relation_type      = 'unrelated';
          phone.verification_status = 'rejected';
          entity.target_entity_id   = null;
        } else if (ident.relation) {
          entity.relation_type      = ident.relation;
          phone.verification_status = 'verified';
        }
        if (ident.full_name) entity.full_name = ident.full_name;
      }

      phone.extra_data = { ...(phone.extra_data || {}), last_verdict_by: operatorId };

      const phones = [...prev.phones];
      phones[phoneIdx] = phone;
      const entities = [...prev.entities];
      if (entity && ownerIdx !== -1) entities[ownerIdx] = entity;
      return { ...prev, phones, entities };
    });
  }, []);

  // -------------------------------------------------------------------------
  // applyWorkerRun
  // -------------------------------------------------------------------------
  const applyWorkerRun = useCallback((engineName, processedCount) => {
    setDb((prev) => ({
      ...prev,
      engines: {
        ...prev.engines,
        [engineName]: {
          ...prev.engines[engineName],
          lastRunAt:          new Date().toISOString(),
          lastProcessedCount: processedCount,
          executing:          false,
        },
      },
    }));
  }, []);

  // -------------------------------------------------------------------------
  // setEngineExecuting
  // -------------------------------------------------------------------------
  const setEngineExecuting = useCallback((engineName, executing) => {
    setDb((prev) => ({
      ...prev,
      engines: {
        ...prev.engines,
        [engineName]: { ...prev.engines[engineName], executing },
      },
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyOpenTask  (mock-mode only; the real path uses refetchTasks)
  //
  // Synthesises a new pending task from the openTask payload. JOIN fields
  // (phone_number, entity_id, entity_type, root_entity_id) are filled by looking
  // up the related phone/entity in the current cache so the mock shape
  // matches the real-API JOIN exactly.
  // -------------------------------------------------------------------------
  const applyOpenTask = useCallback((payload) => {
    setDb((prev) => {
      const nextId = _uid('task');
      const now    = new Date().toISOString();
      const phone  = prev.phones.find((p) => p.id === payload.phone_id);
      const entity = phone ? prev.entities.find((e) => e.id === phone.entity_id) : null;

      const newTask = {
        id:           nextId,
        phone_id:     payload.phone_id,
        task_type:    payload.task_type,
        status:       'pending',
        extra_data:   payload.extra_data ?? null,
        phone_number: phone?.phone_number ?? null,
        entity_id:    phone?.entity_id    ?? null,
        root_entity_id:    entity?.root_entity_id   ?? null,
      };
      return { ...prev, tasks: [...prev.tasks, newTask] };
    });
  }, [_currentOperatorUsername]);

  // -------------------------------------------------------------------------
  // applyResolveTask  (mock-mode only; real path uses refetchTaskById)
  //
  // Writes the terminal state and merges resolution_outcome / resolved_by /
  // resolution_note into extra_data — same shape the backend service produces.
  // -------------------------------------------------------------------------
  const applyResolveTask = useCallback((taskId, body) => {
    setDb((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const merged = {
          ...(t.extra_data || {}),
          resolution_outcome: body.outcome,
        };
        if (body.resolution_note != null) {
          merged.resolution_note = body.resolution_note;
        }
        return { ...t, status: body.outcome, extra_data: merged };
      }),
    }));
  }, []);

  // -------------------------------------------------------------------------
  // applyBulkResolveTasks — mock-mode parity for POST /api/v1/tasks/bulk-status.
  //
  // Mirrors PipelineTaskService.bulk_resolve_tasks on the backend:
  //   - per-task processing with the same terminal-state guard the
  //     singular path uses
  //   - missing ids / already-terminal tasks land in failed_rows
  //   - successful settlers go into success_ids
  // Returns BulkResolveTaskResponse-shaped object.
  // -------------------------------------------------------------------------
  const applyBulkResolveTasks = useCallback((body) => {
    const TERMINAL = new Set(['done', 'rejected']);
    let result;
    setDb((prev) => {
      const successIds = [];
      const failedRows = [];
      const updatedTasks = prev.tasks.map((t) => t);  // shallow array copy
      for (const tid of (body.task_ids || [])) {
        const idx = updatedTasks.findIndex((t) => t.id === tid);
        if (idx === -1) {
          failedRows.push({
            task_id: tid,
            error: `PipelineTask with id=${tid} was not found in the system.`,
          });
          continue;
        }
        const existing = updatedTasks[idx];
        if (TERMINAL.has(existing.status)) {
          failedRows.push({
            task_id: tid,
            error: (
              `PipelineTask id=${tid} is already in terminal status ` +
              `'${existing.status}'. Open a new task instead of re-settling this one.`
            ),
          });
          continue;
        }
        const merged = {
          ...(existing.extra_data || {}),
          resolution_outcome: body.outcome,
        };
        if (body.resolution_note != null) {
          merged.resolution_note = body.resolution_note;
        }
        updatedTasks[idx] = {
          ...existing,
          status:     body.outcome,
          extra_data: merged,
        };
        successIds.push(tid);
      }

      result = {
        success_count: successIds.length,
        failed_count:  failedRows.length,
        success_ids:   successIds,
        failed_rows:   failedRows,
      };
      return { ...prev, tasks: updatedTasks };
    });
    return result;
  }, []);

  // -------------------------------------------------------------------------
  // Phase NOTIF — mock-mode parity for the 5 notification endpoints.
  //
  // The skeleton lives entirely in-memory: subscriptions + delivery
  // rows are arrays on the mock db. Mirrors the backend at the
  // contract level (same filter recognition, same target_kind/target_id
  // invariant, same "channel always succeeds" mock semantics).
  // -------------------------------------------------------------------------

  const listNotificationSubscriptions = useCallback((filters = {}) => {
    const rows = (db.notificationSubscriptions || []).filter((s) => {
      if (filters.targetKind !== undefined && s.target_kind !== filters.targetKind) return false;
      if (filters.targetId !== undefined && s.target_id !== filters.targetId) return false;
      if (filters.triggerEventType !== undefined && s.trigger_event_type !== filters.triggerEventType) return false;
      if (filters.active !== undefined && s.active !== filters.active) return false;
      return true;
    });
    return rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [db.notificationSubscriptions]);

  const applyCreateNotificationSubscription = useCallback((body) => {
    // Mirror the backend's invariant guards so mock-mode operators
    // hit the same error paths the real API enforces.
    const SUPPORTED = new Set(['phone', 'entity', 'task', 'global']);
    if (!SUPPORTED.has(body.target_kind)) {
      throw new Error(`Unsupported target_kind '${body.target_kind}'`);
    }
    if (body.target_kind === 'global' && body.target_id != null) {
      throw new Error('target_id must be NULL when target_kind=global.');
    }
    if (body.target_kind !== 'global' && body.target_id == null) {
      throw new Error(`target_id is required when target_kind='${body.target_kind}'`);
    }
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      throw new Error('recipients must contain at least one entry.');
    }

    // Phase AUTH-B: created_by comes from the current mock user
    // when set; falls back to body.created_by for backward compat.
    const author = _currentOperatorUsername(body.created_by);
    let created;
    setDb((prev) => {
      const nextId = _uid('sub');
      const now = new Date().toISOString();
      created = {
        id:                  nextId,
        trigger_event_type:  body.trigger_event_type,
        target_kind:         body.target_kind,
        target_id:           body.target_id ?? null,
        recipients:          [...body.recipients],
        title_template:      body.title_template ?? null,
        body_template:       body.body_template ?? null,
        active:              true,
        created_by:          author,
        created_at:          now,
        updated_at:          now,
        extra_data:          body.extra_data ?? null,
      };
      return {
        ...prev,
        notificationSubscriptions: [...(prev.notificationSubscriptions || []), created],
      };
    });
    return created;
  }, [_currentOperatorUsername]);

  const applyUpdateNotificationSubscription = useCallback((id, body) => {
    if (body.recipients != null && body.recipients.length === 0) {
      throw new Error('recipients must contain at least one entry.');
    }
    let updated;
    setDb((prev) => {
      const subs = (prev.notificationSubscriptions || []).slice();
      const idx = subs.findIndex((s) => s.id === id);
      if (idx === -1) {
        throw new Error(`NotificationSubscription with id=${id} was not found.`);
      }
      const next = { ...subs[idx], updated_at: new Date().toISOString() };
      if (body.recipients !== undefined)     next.recipients     = [...body.recipients];
      if (body.title_template !== undefined) next.title_template = body.title_template;
      if (body.body_template !== undefined)  next.body_template  = body.body_template;
      if (body.active !== undefined)         next.active         = body.active;
      if (body.extra_data !== undefined)     next.extra_data     = body.extra_data;
      subs[idx] = next;
      updated = next;
      return { ...prev, notificationSubscriptions: subs };
    });
    return updated;
  }, []);

  const applyDeleteNotificationSubscription = useCallback((id) => {
    setDb((prev) => {
      const subs = (prev.notificationSubscriptions || []).filter((s) => s.id !== id);
      if (subs.length === (prev.notificationSubscriptions || []).length) {
        throw new Error(`NotificationSubscription with id=${id} was not found.`);
      }
      return { ...prev, notificationSubscriptions: subs };
    });
  }, []);

  const applyNotificationTestFire = useCallback((body) => {
    // Mirrors the backend's mock_chat: always succeeds. Lands as a
    // NotificationDelivery row tagged trigger_event_type='manual.test'.
    let delivery;
    setDb((prev) => {
      const nextId = _uid('del');
      const now = new Date().toISOString();
      delivery = {
        id:                   nextId,
        subscription_id:      null,
        trigger_event_type:   'manual.test',
        title:                body.title,
        body:                 body.body,
        recipients:           [...body.recipients],
        status:               'sent',
        retry_count:          0,
        last_error:           null,
        provider_message_id:  `mock_${nextId}`,
        attempted_at:         now,
        delivered_at:         now,
        created_at:           now,
        updated_at:           now,
        extra_data:           { raw_response: { mock: true, recipients_count: body.recipients.length } },
      };
      return {
        ...prev,
        notificationDeliveries: [...(prev.notificationDeliveries || []), delivery],
      };
    });
    return delivery;
  }, []);

  // -------------------------------------------------------------------------
  // Phase AUTH — mock-mode auth parity.
  //
  // Mirrors the backend's /api/v1/auth/* contract just well enough
  // for the AuthContext + LoginPage + RegisterPage to function in
  // MOCK_MODE without a live server. Throws operator-friendly
  // errors on the same conditions the real backend would (duplicate
  // username, wrong password, unauthenticated).
  // -------------------------------------------------------------------------

  const _userToResponse = useCallback((u) => ({
    id:                  u.id,
    username:            u.username,
    role:                u.role,
    managed_client_ids:  u.managed_client_ids || [],
    display_name:        u.display_name || null,
    created_at:          u.created_at,
  }), []);

  const getCurrentMockUser = useCallback(() => {
    // /auth/me equivalent — throws when nobody is "logged in" in
    // the mock layer (same semantics as the real 401 path).
    const cur = (db.users || []).find((u) => u.id === db.currentMockUserId);
    if (!cur) throw new Error('Not authenticated');
    return _userToResponse(cur);
  }, [db.users, db.currentMockUserId, _userToResponse]);

  const applyAuthRegister = useCallback((body) => {
    // Validate BEFORE setDb — throwing inside a state-updater
    // callback would propagate to React's reconciler as an uncaught
    // error, never reaching the caller's try/catch. So we read the
    // current users list from the closure, validate, then setDb.
    if ((db.users || []).some((u) => u.username === body.username)) {
      throw new Error(`Username '${body.username}' is already taken.`);
    }
    const nextId = _uid('usr');
    const user = {
      id:                  nextId,
      username:            body.username,
      password_hash:       `mock:${body.password}`,
      role:                'regular',
      active:              true,
      managed_client_ids:  [...(body.managed_client_ids || [])],
      display_name:        body.display_name || null,
      created_at:          new Date().toISOString(),
    };
    setDb((prev) => ({
      ...prev,
      users:             [...(prev.users || []), user],
      currentMockUserId: nextId,
    }));
    return _userToResponse(user);
  }, [db.users, _userToResponse]);

  const applyAuthLogin = useCallback((body) => {
    // Same rationale as applyAuthRegister — validate first, mutate
    // second.
    const u = (db.users || []).find((u) => u.username === body.username);
    if (!u || !u.active) {
      throw new Error('Invalid username or password.');
    }
    if (u.password_hash !== `mock:${body.password}`) {
      throw new Error('Invalid username or password.');
    }
    setDb((prev) => ({ ...prev, currentMockUserId: u.id }));
    return _userToResponse(u);
  }, [db.users, _userToResponse]);

  const applyAuthLogout = useCallback(() => {
    setDb((prev) => ({ ...prev, currentMockUserId: null }));
  }, []);

  // -------------------------------------------------------------------------
  // _syncTestUser — Phase AUTH-B test helper.
  //
  // The AuthProvider calls this on mount whenever it's given an
  // `initialState` with a user (the renderApp test seam). It mirrors
  // the user into mockDb.users + sets currentMockUserId so the
  // mock-mode mutators that read attribution from the DB (resolve_by,
  // requested_by, created_by) have a single source of truth.
  //
  // Idempotent: if the user already exists by id, we just bump the
  // currentMockUserId pointer.
  // -------------------------------------------------------------------------
  const _syncTestUser = useCallback((user) => {
    if (!user || user.id == null) return;
    setDb((prev) => {
      const users = (prev.users || []).slice();
      const idx = users.findIndex((u) => u.id === user.id);
      const mockUser = {
        id:                 user.id,
        username:           user.username,
        password_hash:      'mock:test',
        role:               user.role,
        active:             true,
        managed_client_ids: [...(user.managed_client_ids || [])],
        display_name:       user.display_name || null,
        created_at:         user.created_at || new Date().toISOString(),
      };
      if (idx === -1) users.push(mockUser);
      else            users[idx] = mockUser;
      return { ...prev, users, currentMockUserId: user.id };
    });
  }, []);

  const applyAuthPatchMe = useCallback((body) => {
    // Validate-then-mutate (same rationale as the auth login/register
    // mutators above).
    const cur = (db.users || []).find((u) => u.id === db.currentMockUserId);
    if (!cur) throw new Error('Not authenticated');
    // UAT round-3: empty managed_client_ids is now valid (operator can
    // opt out of personalization). Backend mirrors the same relaxation.
    const next = { ...cur };
    if (body.managed_client_ids !== undefined) {
      next.managed_client_ids = [...body.managed_client_ids];
    }
    if (body.display_name !== undefined) {
      next.display_name = body.display_name;
    }
    setDb((prev) => {
      const users = (prev.users || []).map((u) => (u.id === cur.id ? next : u));
      return { ...prev, users };
    });
    return _userToResponse(next);
  }, [db.users, db.currentMockUserId, _userToResponse]);

  // -------------------------------------------------------------------------
  // applyTableExport — mock-mode parity for POST /api/v1/{table}/export.
  //
  // Mirrors ExportService on the backend at the contract level (same
  // filter recognition, same column projection, same dotted-key
  // resolution into extra_data). Returns a CSV blob (Excel opens it
  // natively) rather than xlsx because the mock doesn't bundle a JS
  // xlsx writer — same trade-off as bulkIngestUpload in mock mode.
  // -------------------------------------------------------------------------
  const applyTableExport = useCallback((tableId, body) => {
    const { filters = {}, columns = [], filename_hint } = body;

    // Per-table row source + filter application.
    let rows;
    if (tableId === 'phones') {
      rows = _mockFilterPhones(db, filters);
    } else if (tableId === 'tasks') {
      rows = _mockFilterTasks(db, filters);
    } else {
      throw new Error(`Unsupported export table: ${tableId}`);
    }

    // Build CSV in memory.
    const lines = [];
    lines.push(columns.map((c) => _csvEscape(c.label)).join(','));
    for (const row of rows) {
      lines.push(
        columns
          .map((c) => _csvEscape(_formatCell(_resolveDotted(row, c.key), c.format)))
          .join(','),
      );
    }
    const csv = lines.join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

    // Filename mirrors the backend: {table}_{hint?}_{YYYY-MM-DD}_{HHMM}.csv
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const safeHint = (filename_hint || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const filename = [tableId, safeHint, stamp].filter(Boolean).join('_') + '.csv';

    return { blob, filename };
  }, [db]);

  // -------------------------------------------------------------------------
  // UAT round-3 — admin CRUD mock parity (entities + phones)
  // -------------------------------------------------------------------------
  // Mirrors the DataAdminService contract in MOCK_MODE so the new
  // view + admin tabs work end-to-end without a live backend. The
  // tombstone field here is a real `deleted_at` ISO string on the
  // mock entity / phone row — frontend filters honor it the same
  // way the backend WHERE clause does.

  const _entityToView = useCallback((e) => {
    return {
      id:               e.id,
      root_entity_id:        e.root_entity_id,
      relation_type:    e.relation_type,
      target_entity_id: e.target_entity_id,
      full_name:        e.full_name ?? null,
      identifier_1:     e.identifier_1 ?? null,
      identifier_2:     e.identifier_2 ?? null,
      extra_data:       e.extra_data || {},
      deleted_at:       e.deleted_at ?? null,
    };
  }, []);

  const applyListEntities = useCallback((filters = {}) => {
    let rows = (db.entities || []).slice();
    if (!filters.includeDeleted) rows = rows.filter((e) => !e.deleted_at);
    if (filters.rootEntityId != null && filters.rootEntityId !== '') {
      rows = rows.filter((e) => String(e.root_entity_id) === String(filters.rootEntityId));
    }
    if (filters.rootEntityIds?.length) {
      const set = new Set(filters.rootEntityIds.map(String));
      rows = rows.filter((e) => set.has(String(e.root_entity_id)));
    }
    if (filters.relationType) {
      rows = rows.filter((e) => e.relation_type === filters.relationType);
    }
    if (filters.q) {
      const needle = String(filters.q).toLowerCase();
      rows = rows.filter((e) => {
        const name = (e.full_name || '').toLowerCase();
        return `${name} ${e.id}`.includes(needle);
      });
    }
    return rows.map(_entityToView);
  }, [db, _entityToView]);

  const applyGetEntityDetail = useCallback((id, includeDeleted) => {
    const e = (db.entities || []).find((x) => x.id === id);
    if (!e) throw new Error(`Entity ${id} not found`);
    if (e.deleted_at && !includeDeleted) throw new Error(`Entity ${id} not found`);
    return _entityToView(e);
  }, [db, _entityToView]);

  const applyPatchEntity = useCallback((id, body) => {
    let snapshot;
    setDb((prev) => {
      const idx = prev.entities.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`Entity ${id} not found`);
      const existing = prev.entities[idx];
      if (existing.deleted_at) throw new Error(`Entity ${id} not found`);
      const next = {
        ...existing,
        relation_type:    body.relation_type    ?? existing.relation_type,
        full_name:        body.full_name        ?? existing.full_name,
        identifier_1:     body.identifier_1     ?? existing.identifier_1,
        identifier_2:     body.identifier_2     ?? existing.identifier_2,
        target_entity_id: body.target_entity_id ?? existing.target_entity_id,
        root_entity_id:        body.root_entity_id        ?? existing.root_entity_id,
        extra_data:       { ...(existing.extra_data || {}), ...(body.extra_data || {}) },
      };
      snapshot = next;
      const entities = prev.entities.slice();
      entities[idx] = next;
      return { ...prev, entities };
    });
    return _entityToView(snapshot);
  }, [_entityToView]);

  const applySoftDeleteEntity = useCallback((id) => {
    // UAT round-3 — mirrors backend cascade: tombstones the entity,
    // every child entity (target_entity_id == id), and every active
    // phone in that sub-graph. All rows stamped with a shared
    // deletion_group_id so applyRestoreEntity can reverse exactly the
    // set that fell together.
    let summary;
    setDb((prev) => {
      const idx = prev.entities.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`Entity ${id} not found`);
      if (prev.entities[idx].deleted_at) throw new Error(`Entity ${id} not found`);
      const now = new Date().toISOString();
      const groupId =
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `del-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const childIds = new Set(
        prev.entities
          .filter((e) => e.target_entity_id === id && !e.deleted_at)
          .map((e) => e.id),
      );
      const entityIdsToKill = new Set([id, ...childIds]);

      let phonesDeleted = 0;
      const entities = prev.entities.map((e) => {
        if (entityIdsToKill.has(e.id) && !e.deleted_at) {
          return { ...e, deleted_at: now, deletion_group_id: groupId };
        }
        return e;
      });
      const phones = prev.phones.map((p) => {
        if (entityIdsToKill.has(p.entity_id) && !p.deleted_at) {
          phonesDeleted += 1;
          return { ...p, deleted_at: now, deletion_group_id: groupId };
        }
        return p;
      });
      summary = {
        entity_id:          id,
        phones_deleted:     phonesDeleted,
        entities_deleted:   childIds.size + 1,
        deletion_group_id:  groupId,
      };
      return { ...prev, entities, phones };
    });
    return summary;
  }, []);

  const applyRestoreEntity = useCallback((id) => {
    // UAT round-3 — symmetric counterpart: brings back every row
    // sharing the same deletion_group_id, leaving unrelated tombstones
    // (deleted by other actions) alone.
    let summary;
    setDb((prev) => {
      const idx = prev.entities.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`Entity ${id} not found`);
      const target = prev.entities[idx];
      if (!target.deleted_at) {
        summary = { entity_id: id, phones_restored: 0, entities_restored: 0 };
        return prev;
      }
      const groupId = target.deletion_group_id;
      let entitiesRestored = 0;
      const entities = prev.entities.map((e) => {
        if (e.id === id) {
          entitiesRestored += 1;
          return { ...e, deleted_at: null, deletion_group_id: null };
        }
        if (groupId && e.deletion_group_id === groupId && e.deleted_at) {
          entitiesRestored += 1;
          return { ...e, deleted_at: null, deletion_group_id: null };
        }
        return e;
      });
      let phonesRestored = 0;
      const phones = prev.phones.map((p) => {
        if (groupId && p.deletion_group_id === groupId && p.deleted_at) {
          phonesRestored += 1;
          return { ...p, deleted_at: null, deletion_group_id: null };
        }
        return p;
      });
      summary = {
        entity_id:          id,
        phones_restored:    phonesRestored,
        entities_restored:  entitiesRestored,
      };
      return { ...prev, entities, phones };
    });
    return summary;
  }, []);

  const applyAdminPatchPhone = useCallback((id, body) => {
    let snapshot;
    setDb((prev) => {
      const idx = prev.phones.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error(`Phone ${id} not found`);
      if (prev.phones[idx].deleted_at) throw new Error(`Phone ${id} not found`);
      const next = {
        ...prev.phones[idx],
        ...(body.phone_number        != null ? { phone_number:        body.phone_number.trim() } : {}),
        ...(body.phone_type          != null ? { phone_type:          body.phone_type          } : {}),
        ...(body.verification_status != null ? { verification_status: body.verification_status } : {}),
        ...(body.score               != null ? { score:               body.score               } : {}),
      };
      snapshot = next;
      const phones = prev.phones.slice();
      phones[idx] = next;
      return { ...prev, phones };
    });
    return snapshot;
  }, []);

  const applySoftDeletePhone = useCallback((id) => {
    // UAT round-3 — stamp a fresh group_id so applyRestorePhone can
    // revive any cascade peers (currently always just this one row,
    // matching the backend's single-phone delete contract).
    let snapshot;
    setDb((prev) => {
      const idx = prev.phones.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error(`Phone ${id} not found`);
      if (prev.phones[idx].deleted_at) throw new Error(`Phone ${id} not found`);
      const groupId =
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `del-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const next = {
        ...prev.phones[idx],
        deleted_at: new Date().toISOString(),
        deletion_group_id: groupId,
      };
      snapshot = next;
      const phones = prev.phones.slice();
      phones[idx] = next;
      return { ...prev, phones };
    });
    return snapshot;
  }, []);

  // UAT round-3 — quick-attach + envelope creation mock parity.
  const applyCreateEnvelope = useCallback((rootEntityId) => {
    let snapshot;
    setDb((prev) => {
      const nextId = _uid('ent');
      const now = new Date().toISOString();
      const ent = {
        id:               nextId,
        root_entity_id:        rootEntityId,
        relation_type:    'associated',
        target_entity_id: rootEntityId,
        extra_data:       {},
        deleted_at:       null,
      };
      snapshot = ent;
      return { ...prev, entities: [...prev.entities, ent] };
    });
    return _entityToView(snapshot);
  }, [_entityToView]);

  const applyQuickAttachPhone = useCallback((body) => {
    // UAT round-3 fix: return a Promise that resolves AFTER the setDb
    // updater commits the new phone. Previously the helper returned
    // whatever `snapshot` was at function-return time — which was
    // undefined when the updater ran asynchronously, breaking any
    // caller that looped over multiple phones (the bulk panel hit
    // exactly this: 1 succeeded by luck, the rest crashed on
    // `ph.id` of undefined).
    return new Promise((resolve, reject) => {
      setDb((prev) => {
        const ent = prev.entities.find((e) => e.id === body.entity_id);
        if (!ent || ent.deleted_at) {
          reject(new Error(`Entity ${body.entity_id} not found`));
          return prev;
        }
        const nextId = _uid('ph');
        const now = new Date().toISOString();
        const ph = {
          id:                  nextId,
          entity_id:           body.entity_id,
          phone_number:        String(body.phone_number || '').trim(),
          phone_type:          body.phone_type || null,
          ingestion_source:    'manual',
          verification_status: 'pending',
          score:               null,
          deleted_at:          null,
          extra_data:          body.extra_data || {},
          root_entity_id:           ent.root_entity_id,
        };
        resolve(ph);
        return { ...prev, phones: [...prev.phones, ph] };
      });
    });
  }, []);

  const applyRestorePhone = useCallback((id) => {
    // UAT round-3 — symmetric: if the phone fell as part of a cascade
    // it shares a deletion_group_id with other rows; revive them too.
    let snapshot;
    setDb((prev) => {
      const idx = prev.phones.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error(`Phone ${id} not found`);
      const target = prev.phones[idx];
      const groupId = target.deletion_group_id;
      const next = { ...target, deleted_at: null, deletion_group_id: null };
      snapshot = next;
      const phones = prev.phones.map((p, i) => {
        if (i === idx) return next;
        if (groupId && p.deletion_group_id === groupId && p.deleted_at) {
          return { ...p, deleted_at: null, deletion_group_id: null };
        }
        return p;
      });
      const entities = prev.entities.map((e) => {
        if (groupId && e.deletion_group_id === groupId && e.deleted_at) {
          return { ...e, deleted_at: null, deletion_group_id: null };
        }
        return e;
      });
      return { ...prev, phones, entities };
    });
    return snapshot;
  }, []);

  // -------------------------------------------------------------------------
  // Derived helpers
  // -------------------------------------------------------------------------
  const getClientMetrics = useCallback(
    (rootEntityId) => deriveClientMetrics(rootEntityId, phones, entities, tasks),
    [phones, entities, tasks]
  );

  const getEntityById = useCallback(
    (entityId) => entities.find((e) => e.id === entityId) || null,
    [entities]
  );

  const getPhoneById = useCallback(
    (phoneId) => phones.find((p) => p.id === phoneId) || null,
    [phones]
  );

  const getClientForPhone = useCallback(
    (phoneId) => {
      const phone  = phones.find((p) => p.id === phoneId);
      if (!phone) return null;
      const entity = entities.find((e) => e.id === phone.entity_id);
      if (!entity) return null;
      return clients.find((c) => c.id === entity.root_entity_id) || null;
    },
    [phones, entities, clients]
  );

  // -------------------------------------------------------------------------
  // System Settings — mock parity for GET/PUT /system/settings.
  // -------------------------------------------------------------------------
  const applyGetSystemSettings = useCallback(
    () => structuredClone(db.systemSettings),
    [db.systemSettings],
  );

  const applyUpdateSystemSettings = useCallback((payload) => {
    const backend = payload?.storage_backend;
    const current = db.systemSettings;
    const known   = current.backends.find((b) => b.id === backend);
    // Mirror the backend's 422 contract: unknown / not-yet-available
    // backends are rejected with a thrown Error (the api layer maps it
    // to a toast, exactly like a real 422).
    if (!known) {
      throw new Error(`Unknown storage backend '${backend}'.`);
    }
    if (!known.available) {
      throw new Error(`Storage backend '${backend}' is not available yet.`);
    }
    let snapshot;
    setDb((prev) => {
      const next = { ...prev.systemSettings, storage_backend: backend };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  const applyUpdateDisplayFields = useCallback((surface, fields) => {
    let snapshot;
    setDb((prev) => {
      const nextDisplay = { ...(prev.systemSettings.display_fields || {}), [surface]: [...fields] };
      const next = { ...prev.systemSettings, display_fields: nextDisplay };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  const applyUpdateDisplayLabels = useCallback((surface, labels) => {
    let snapshot;
    setDb((prev) => {
      const store = { ...(prev.systemSettings.display_labels || {}) };
      // Drop blank values; an empty map clears the surface's overrides.
      const cleaned = Object.fromEntries(
        Object.entries(labels).filter(([, v]) => v && v.trim()),
      );
      if (Object.keys(cleaned).length) store[surface] = cleaned;
      else delete store[surface];
      const next = { ...prev.systemSettings, display_labels: store };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  const applyUpdateFilterFields = useCallback((surface, fields) => {
    let snapshot;
    setDb((prev) => {
      const nextFilter = { ...(prev.systemSettings.filter_fields || {}), [surface]: [...fields] };
      const next = { ...prev.systemSettings, filter_fields: nextFilter };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  const applyUpdateCustomFilters = useCallback((surface, filters) => {
    let snapshot;
    setDb((prev) => {
      const store = { ...(prev.systemSettings.custom_filters || {}) };
      // An empty list clears the surface's custom filters (mirrors backend).
      if (Array.isArray(filters) && filters.length) {
        store[surface] = filters.map((d) => ({ ...d }));
      } else {
        delete store[surface];
      }
      const next = { ...prev.systemSettings, custom_filters: store };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  const applyUpdateIngestionFields = useCallback((surface, fields) => {
    let snapshot;
    setDb((prev) => {
      const store = { ...(prev.systemSettings.ingestion_fields || {}) };
      if (Array.isArray(fields) && fields.length) {
        store[surface] = fields.map((d) => ({ ...d }));
      } else {
        delete store[surface];
      }
      const next = { ...prev.systemSettings, ingestion_fields: store };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  // Mock parity for PUT /system/settings/vocabulary/{name}. Also used as the
  // in-memory mirror update in BOTH modes: the System Settings editor calls
  // this after a successful save so the controlled dropdowns (which read
  // `vocabularies` from this context) update live without a page reload.
  const applyUpdateVocabulary = useCallback((name, items) => {
    setDb((prev) => {
      const vocabularies = {
        ...(prev.systemSettings?.vocabularies || {}),
        [name]: [...items],
      };
      return {
        ...prev,
        systemSettings: { ...prev.systemSettings, vocabularies },
      };
    });
    return { name, items: [...items] };
  }, []);

  // Mock parity for PUT /system/settings/mongo-url.
  // In mock mode the connection "always succeeds" — we just flip the flag.
  // The URL itself is intentionally not stored in mock state (Secrets-Free).
  const applyUpdateMongoUrl = useCallback((_url) => {
    let snapshot;
    setDb((prev) => {
      const next = { ...prev.systemSettings, mongo_configured: true };
      snapshot = next;
      return { ...prev, systemSettings: next };
    });
    return structuredClone(snapshot);
  }, [db.systemSettings]);

  const value = {
    // State slices
    clients,
    entities,
    phones,
    tasks,
    engines,
    loading,
    // Invalidation / refetch (real-API mode — no-op in mock mode)
    refetchPhones,
    refetchTasks,
    refetchEntities,
    // Phase D / DX — narrowed refetches (real-API mode only; no-op in mock mode).
    refetchPhoneById,
    refetchTaskById,
    // Mutators (mock mode — apply*; real-API mode — used only for engine UI state)
    applyIngest,
    applyCreateEntity,
    applyEntityBulkText,
    applyEntityBulkUploadCsv,
    applyBulkIngest,
    applyBulkUploadCsv,
    applyPatchPhone,
    applyVerdict,
    applyTwoAxisVerdict,
    applyWorkerRun,
    applyOpenTask,
    applyResolveTask,
    applyBulkResolveTasks,
    applyTableExport,
    // UAT round-3 admin CRUD mock parity
    applyListEntities,
    applyGetEntityDetail,
    applyPatchEntity,
    applySoftDeleteEntity,
    applyRestoreEntity,
    applyAdminPatchPhone,
    applySoftDeletePhone,
    applyRestorePhone,
    applyCreateEnvelope,
    applyQuickAttachPhone,
    // System Settings tab
    applyGetSystemSettings,
    applyUpdateSystemSettings,
    applyUpdateDisplayFields,
    applyUpdateDisplayLabels,
    applyUpdateFilterFields,
    applyUpdateCustomFilters,
    applyUpdateIngestionFields,
    applyUpdateVocabulary,
    applyUpdateMongoUrl,
    // Operator-managed closed lists — the single source every controlled
    // dropdown reads from (hydrated at boot, updated live on edit).
    vocabularies: db.systemSettings?.vocabularies || {},
    // Phase NOTIF
    listNotificationSubscriptions,
    applyCreateNotificationSubscription,
    applyUpdateNotificationSubscription,
    applyDeleteNotificationSubscription,
    applyNotificationTestFire,
    // Phase AUTH (mock-mode parity)
    getCurrentMockUser,
    applyAuthRegister,
    applyAuthLogin,
    applyAuthLogout,
    applyAuthPatchMe,
    _syncTestUser,
    setEngineExecuting,
    // Derived helpers
    getClientMetrics,
    getEntityById,
    getPhoneById,
    getClientForPhone,
  };

  return (
    <MockDataContext.Provider value={value}>
      {children}
    </MockDataContext.Provider>
  );
}

export function useMockData() {
  const ctx = useContext(MockDataContext);
  if (!ctx) throw new Error('useMockData must be used within MockDataProvider');
  return ctx;
}


// ===========================================================================
// Module-level helpers for applyTableExport (Phase EXP mock-parity layer)
//
// Kept private to this file — they mirror the backend's filter and
// projection semantics so mock-mode operators see the same export
// shape the real backend would emit.
// ===========================================================================


function _mockFilterPhones(db, f) {
  let rows = (db.phones || []).slice();
  // Materialize each row with the root_entity_id JOIN field.
  rows = rows.map((p) => {
    const ent = db.entities.find((e) => e.id === p.entity_id);
    return { ...p, root_entity_id: p.root_entity_id ?? ent?.root_entity_id ?? null };
  });

  if (f.verification_status) {
    rows = rows.filter((r) => r.verification_status === f.verification_status);
  }
  if (f.ingestion_source) {
    rows = rows.filter((r) => r.ingestion_source === f.ingestion_source);
  }
  if (f.phone_type) {
    rows = rows.filter((r) => r.phone_type === f.phone_type);
  }
  if (f.root_entity_id != null && f.root_entity_id !== '') {
    rows = rows.filter((r) => String(r.root_entity_id) === String(f.root_entity_id));
  }
  if (f.root_entity_ids?.length) {
    const allowed = new Set(f.root_entity_ids.map(String));
    rows = rows.filter((r) => allowed.has(String(r.root_entity_id)));
  }
  if (f.q) {
    const needle = String(f.q).toLowerCase();
    rows = rows.filter((r) => {
      const hay = [
        r.phone_number || '',
        String(r.entity_id ?? ''),
        String(r.root_entity_id ?? ''),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  return rows;
}


function _mockFilterTasks(db, f) {
  let rows = (db.tasks || []).slice();

  if (f.status) {
    rows = rows.filter((r) => r.status === f.status);
  }
  if (f.task_type) {
    rows = rows.filter((r) => r.task_type === f.task_type);
  }
  if (f.phone_id != null && f.phone_id !== '') {
    rows = rows.filter((r) => String(r.phone_id) === String(f.phone_id));
  }
  // Phase AUTH-C — multi-value personalization filter parity.
  if (f.root_entity_ids?.length) {
    const allowed = new Set(f.root_entity_ids.map(String));
    rows = rows.filter((r) => allowed.has(String(r.root_entity_id)));
  }
  if (f.exclude_terminal && !f.status) {
    rows = rows.filter((r) => r.status !== 'done' && r.status !== 'rejected');
  }
  if (f.q) {
    const needle = String(f.q).toLowerCase();
    rows = rows.filter((r) => {
      const hay = [
        r.phone_number || '',
        String(r.root_entity_id ?? ''),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  rows.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return rows;
}


function _resolveDotted(row, key) {
  if (!key.includes('.')) return row[key];
  let cursor = row;
  for (const seg of key.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return null;
    cursor = cursor[seg];
    if (cursor == null) return null;
  }
  return cursor;
}


function _formatCell(value, fmt) {
  if (value == null) return '';
  if (fmt === 'datetime') {
    try {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
    } catch {
      return String(value);
    }
  }
  if (fmt === 'number2') {
    const f = Number(value);
    return Number.isFinite(f) ? String(Math.round(f * 100) / 100) : String(value);
  }
  if (fmt === 'number') {
    const f = Number(value);
    return Number.isFinite(f) ? String(f) : String(value);
  }
  return String(value);
}


/**
 * CSV-escape a single cell: wrap in double-quotes if it contains
 * comma / newline / quote, and double any inner quotes per RFC 4180.
 */
function _csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
