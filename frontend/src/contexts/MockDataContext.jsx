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
import { listActionLogs }                  from '../api/actionsApi';
import { listTasks, getTaskDetail }        from '../api/tasksApi';
import { CLIENT_REGISTRY } from '../config/clientRegistry';

const MockDataContext = createContext(null);

// Minimal empty db used as the real-mode boot state while the API hydrates.
const EMPTY_DB = {
  clients:    [],
  entities:   [],
  phones:     [],
  actionLogs: [],
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
    // those endpoints 401/403. Using Promise.allSettled instead of
    // Promise.all means one rejected slice no longer collapses the
    // whole boot hydration into an empty state.
    Promise.allSettled([
      listPhones({ pageSize: 200 }),
      listActionLogs({ pageSize: 500 }),
      listTasks({ pageSize: 500 }),
    ])
      .then(([phonesRes, logsRes, tasksRes]) => {
        const phonesData = phonesRes.status === 'fulfilled' ? phonesRes.value : [];
        const logsData   = logsRes.status   === 'fulfilled' ? logsRes.value   : [];
        const tasksData  = tasksRes.status  === 'fulfilled' ? tasksRes.value  : [];

        // Synthesize entities from the phone JOIN data.
        // Each phone carries entity_id, entity_type, and client_id from the backend.
        const entityMap = new Map();
        phonesData.forEach((p) => {
          if (!entityMap.has(p.entity_id)) {
            entityMap.set(p.entity_id, {
              id:          p.entity_id,
              entity_type: p.entity_type,
              client_id:   p.client_id,
            });
          }
        });

        setDb((prev) => ({
          ...prev,
          phones:     phonesData,
          actionLogs: logsData,
          tasks:      tasksData,
          entities:   Array.from(entityMap.values()),
          clients:    CLIENT_REGISTRY,
        }));
      })
      .finally(() => setLoading(false));
  }, []);

  // Expose raw state slices
  const { clients, entities, phones, actionLogs, tasks, engines } = db;

  // ---------------------------------------------------------------------------
  // refetchPhones — re-hydrates phones + entities from the server.
  // No-op in mock mode. Called by API mutation functions after successful HTTP
  // mutations to enforce the server-as-single-source-of-truth contract.
  // ---------------------------------------------------------------------------
  const refetchPhones = useCallback(async () => {
    if (MOCK_MODE) return;
    const phonesData = await listPhones({ pageSize: 200 });
    const entityMap  = new Map();
    phonesData.forEach((p) => {
      if (!entityMap.has(p.entity_id)) {
        entityMap.set(p.entity_id, {
          id:          p.entity_id,
          entity_type: p.entity_type,
          client_id:   p.client_id,
        });
      }
    });
    setDb((prev) => ({
      ...prev,
      phones:   phonesData,
      entities: Array.from(entityMap.values()),
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // refetchActionLogs — re-hydrates action logs from the server.
  // No-op in mock mode.
  // ---------------------------------------------------------------------------
  const refetchActionLogs = useCallback(async () => {
    if (MOCK_MODE) return;
    const logsData = await listActionLogs({ pageSize: 500 });
    setDb((prev) => ({ ...prev, actionLogs: logsData }));
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

      // Keep the synthetic entities list consistent with the JOIN data
      // that now lives on the merged phone row.
      const entityMap = new Map(prev.entities.map((e) => [e.id, e]));
      if (flatPhone.entity_id != null) {
        entityMap.set(flatPhone.entity_id, {
          id:          flatPhone.entity_id,
          entity_type: flatPhone.entity_type,
          client_id:   flatPhone.client_id,
        });
      }
      return { ...prev, phones, entities: Array.from(entityMap.values()) };
    });
  }, []);

  const mergeLogsByPhoneId = useCallback((phoneId, freshLogs) => {
    if (phoneId == null) return;
    setDb((prev) => {
      const others = prev.actionLogs.filter((l) => l.phone_id !== phoneId);
      return { ...prev, actionLogs: [...others, ...freshLogs] };
    });
  }, []);

  // spliceActionLog — replace-by-id or append a SINGLE ActionLog that the
  // server has already delivered to us inside another response body.
  //
  // Today's only caller is patchPhone, which can receive a
  // PhoneUpdateResponse.triggered_action when ActionDataTriggerService
  // fires a re-dispatch as a side-effect of the PATCH. The log is server-
  // authoritative (just delivered inline rather than via a follow-up GET),
  // so splicing it into the cache is consistent with §7.5 — not optimistic.
  const spliceActionLog = useCallback((log) => {
    if (!log || log.id == null) return;
    setDb((prev) => {
      const exists = prev.actionLogs.some((l) => l.id === log.id);
      const next = exists
        ? prev.actionLogs.map((l) => (l.id === log.id ? log : l))
        : [...prev.actionLogs, log];
      return { ...prev, actionLogs: next };
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
    const { entity, action_timeline, ...rest } = detail;
    const flat = {
      ...rest,
      entity_type: entity?.entity_type,
      client_id:   entity?.client_id,
      client_name: entity?.client_name,
    };
    mergePhoneById(flat);
  }, [mergePhoneById]);

  // refetchLogsForPhone — narrow refetch for log-touching mutations.
  // Uses GET /actions/logs?phone_id=... (filter-as-view per §3.3) rather
  // than a dedicated endpoint, so no backend changes are required.
  const refetchLogsForPhone = useCallback(async (phoneId) => {
    if (MOCK_MODE || phoneId == null) return;
    const fresh = await listActionLogs({ phone_id: phoneId });
    mergeLogsByPhoneId(phoneId, fresh);
  }, [mergeLogsByPhoneId]);

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
    const fresh = await listTasks({ pageSize: 500 });
    setDb((prev) => ({ ...prev, tasks: fresh }));
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
      const nextEntityId = Math.max(...prev.entities.map((e) => e.id), 0) + 1;
      const nextPhoneId  = Math.max(...prev.phones.map((p) => p.id), 0) + 1;
      const now = new Date().toISOString();

      const newEntity = {
        id:          nextEntityId,
        entity_type: payload.entity_type || 'target',
        client_id:   payload.client_id || null,
        extra_data:  payload.entity_extra || {},
      };

      const newPhone = {
        id:                  nextPhoneId,
        entity_id:           nextEntityId,
        phone_number:        payload.phone_number,
        classification_type: payload.classification_type || null,
        ingestion_source:    payload.ingestion_source,
        ingestion_reason:    payload.ingestion_reason || null,
        ingested_at:         now,
        verification_status: 'pending',
        verification_source: null,
        verification_reason: null,
        verified_at:         null,
        created_at:          now,
        updated_at:          now,
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
  //   - inherit client_id from the target
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

      const nextId = Math.max(0, ...prev.entities.map((e) => e.id)) + 1;
      const now    = new Date().toISOString();

      const firstName = String(payload.first_name || '').trim();
      const lastRaw   = payload.last_name == null ? null : String(payload.last_name).trim();
      const lastName  = lastRaw || null;

      // Names land in extra_data alongside any caller-supplied keys.
      // The structured fields are the canonical source — they win on
      // conflict with stale keys inside extra_data.
      const mergedExtra = { ...(payload.extra_data || {}), first_name: firstName };
      if (lastName) mergedExtra.last_name = lastName;

      const newEntity = {
        id:               nextId,
        client_id:        target.client_id,             // inherited
        relation_type:    'associated',
        entity_type:      payload.relation_type,
        target_entity_id: target.id,
        extra_data:       mergedExtra,
        created_at:       now,
        updated_at:       now,
      };

      result = {
        id:               newEntity.id,
        client_id:        newEntity.client_id,
        relation_type:    newEntity.entity_type,   // operator-facing label = entity_type
        target_entity_id: newEntity.target_entity_id,
        first_name:       firstName,
        last_name:        lastName,
        created_at:       now,
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

        const first = String(row.first_name || '').trim();
        if (!first) {
          failedRows.push({ row: rowNum, input: token, error: 'first_name is required' });
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

        const lastRaw = row.last_name == null ? null : String(row.last_name).trim();
        candidates.push({
          row: rowNum,
          rowToken: row.row_token || '',
          firstName: first,
          lastName: lastRaw || null,
          relation,
          target: tgt,
        });
      });

      // Pass 2 — build new entities.
      let nextId = Math.max(0, ...prev.entities.map((e) => e.id)) + 1;
      const now  = new Date().toISOString();
      const newEntities = candidates.map((c) => {
        const extra = {
          first_name:         c.firstName,
          bulk_submission_id: submissionId,
        };
        if (c.lastName) extra.last_name = c.lastName;
        if (c.rowToken) extra.row_token = c.rowToken;
        const ent = {
          id:               nextId,
          client_id:        c.target.client_id,
          relation_type:    'associated',
          entity_type:      c.relation,
          target_entity_id: c.target.id,
          extra_data:       extra,
          created_at:       now,
          updated_at:       now,
        };
        nextId += 1;
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
    const REQUIRED = ['first_name', 'relation_type', 'target_entity_id'];
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
      const targetById = new Map();
      for (const row of rows) {
        const raw = row.target_entity_id;
        if (raw == null || raw === '') continue;
        const id = Number(raw);
        if (!Number.isFinite(id) || targetById.has(id)) continue;
        const ent = prev.entities.find((e) => e.id === id);
        if (ent) targetById.set(id, ent);
      }

      const failedRows = [];
      const candidates = [];

      rows.forEach((row, idx) => {
        const rowNum = idx + 1;
        const echo   = JSON.stringify(row).slice(0, INPUT_CAP);

        const first = String(row.first_name || '').trim();
        if (!first) {
          failedRows.push({ row: rowNum, input: echo, error: 'Missing first_name' });
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
        const tgtId = Number(tgtRaw);
        if (!Number.isFinite(tgtId)) {
          failedRows.push({
            row: rowNum, input: echo,
            error: 'target_entity_id must be an integer',
          });
          return;
        }
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
        const lastRaw = row.last_name == null ? null : String(row.last_name).trim();
        candidates.push({
          row: rowNum, firstName: first, lastName: lastRaw || null,
          relation, target: tgt,
        });
      });

      let nextId = Math.max(0, ...prev.entities.map((e) => e.id)) + 1;
      const now  = new Date().toISOString();
      const newEntities = candidates.map((c) => {
        const extra = {
          first_name:         c.firstName,
          bulk_submission_id: submissionId,
        };
        if (c.lastName) extra.last_name = c.lastName;
        const ent = {
          id:               nextId,
          client_id:        c.target.client_id,
          relation_type:    'associated',
          entity_type:      c.relation,
          target_entity_id: c.target.id,
          extra_data:       extra,
          created_at:       now,
          updated_at:       now,
        };
        nextId += 1;
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
      const nextEntityId = Math.max(0, ...prev.entities.map((e) => e.id)) + 1;
      let nextPhoneId    = Math.max(0, ...prev.phones.map((p) => p.id)) + 1;
      const now = new Date().toISOString();

      const newEntity = {
        id:                nextEntityId,
        entity_type:       payload.entity_type || 'target',
        relation_type:     payload.entity_type === 'target' ? 'primary' : 'associated',
        client_id:         payload.client_id ?? null,
        target_entity_id:  payload.target_entity_id ?? null,
        extra_data: {
          ...(payload.entity_extra || {}),
          bulk_submission_id: submissionId,
        },
      };

      const newPhones = candidates.map(({ normalized }) => {
        const id = nextPhoneId;
        nextPhoneId += 1;
        return {
          id,
          entity_id:           nextEntityId,
          phone_number:        normalized,
          classification_type: null,
          ingestion_source:    payload.ingestion_source,
          ingestion_reason:    payload.ingestion_reason || null,
          ingested_at:         now,
          verification_status: 'pending',
          verification_source: null,
          verification_reason: null,
          verified_at:         null,
          created_at:          now,
          updated_at:          now,
          confidence_score:    0,
          priority_score:      0,
          priority_updated_at: null,
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
  //   - per-row validation: phone format, client_id int, required fields,
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
    const REQUIRED = ['phone_number', 'client_id', 'entity_type', 'ingestion_source'];
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
      const parts = REQUIRED.concat(['target_entity_id', 'ingestion_reason'])
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
      const missingFields = ['entity_type', 'ingestion_source'].filter((c) => !row[c]);
      // client_id may legitimately be "0" — treat presence-of-value as the test.
      if (row.client_id === '' || row.client_id == null) missingFields.unshift('client_id');
      if (missingFields.length) {
        failedRows.push({
          row: rowIdx,
          input: rawPhone.slice(0, INPUT_CAP),
          error: `Missing required field(s): ${missingFields.join(', ')}`,
        });
        return;
      }
      const clientIdNum = Number(row.client_id);
      if (!Number.isInteger(clientIdNum)) {
        failedRows.push({
          row: rowIdx, input: rawPhone.slice(0, INPUT_CAP),
          error: 'client_id must be an integer',
        });
        return;
      }
      row.client_id = clientIdNum;
      if (row.target_entity_id !== '' && row.target_entity_id != null) {
        const tgt = Number(row.target_entity_id);
        if (!Number.isInteger(tgt)) {
          failedRows.push({
            row: rowIdx, input: rawPhone.slice(0, INPUT_CAP),
            error: 'target_entity_id must be an integer',
          });
          return;
        }
        row.target_entity_id = tgt;
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
      let nextEntityId = Math.max(0, ...prev.entities.map((e) => e.id)) + 1;
      let nextPhoneId  = Math.max(0, ...prev.phones.map((p) => p.id)) + 1;
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
        const entityId = nextEntityId;
        nextEntityId += 1;
        const phoneId = nextPhoneId;
        nextPhoneId += 1;

        newEntities.push({
          id:               entityId,
          entity_type:      row.entity_type,
          relation_type:    row.entity_type === 'target' ? 'primary' : 'associated',
          client_id:        row.client_id,
          target_entity_id: row.target_entity_id,
          extra_data:       { bulk_submission_id: submissionId },
        });

        newPhones.push({
          id:                  phoneId,
          entity_id:           entityId,
          phone_number:        row._normalized_phone,
          classification_type: null,
          ingestion_source:    row.ingestion_source,
          ingestion_reason:    row.ingestion_reason || null,
          ingested_at:         now,
          verification_status: 'pending',
          verification_source: null,
          verification_reason: null,
          verified_at:         null,
          created_at:          now,
          updated_at:          now,
          confidence_score:    0,
          priority_score:      0,
          priority_updated_at: null,
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
  const applyVerdict = useCallback((phoneId, status, reason, operatorId) => {
    setDb((prev) => ({
      ...prev,
      phones: prev.phones.map((p) =>
        p.id === phoneId
          ? {
              ...p,
              verification_status: status,
              verification_source: 'manual',
              verification_reason: reason || null,
              verified_at:         new Date().toISOString(),
              updated_at:          new Date().toISOString(),
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
      const now = new Date().toISOString();
      const phoneIdx = prev.phones.findIndex((p) => p.id === phoneId);
      if (phoneIdx === -1) return prev;
      const phone   = { ...prev.phones[phoneIdx] };
      const ownerIdx = prev.entities.findIndex((e) => e.id === phone.entity_id);
      const entity  = ownerIdx !== -1 ? { ...prev.entities[ownerIdx] } : null;
      const isEnvelopeAtStart = entity?.entity_type === 'social_envelope';

      // ---- Phone axis (envelope-aware DY-4-D propagation) ----
      if (payload.phone_axis === 'confirm') {
        phone.confidence_score      = 100;
        phone.confidence_updated_at = now;
        if (isEnvelopeAtStart) {
          // Phone-in-network = person-to-target for envelopes.
          phone.verification_status = 'verified_good';
          phone.verification_source = 'manual';
          phone.verification_reason = payload.reason || 'Operator confirmed phone is in target network';
          phone.verified_at         = now;
        }
      } else if (payload.phone_axis === 'refute') {
        phone.confidence_score      = 0;
        phone.confidence_updated_at = now;
        phone.priority_score        = 0;
        if (isEnvelopeAtStart) {
          phone.verification_status = 'verified_bad';
          phone.verification_source = 'manual';
          phone.verification_reason = payload.reason || 'Operator rejected envelope placement';
          phone.verified_at         = now;
          if (entity) entity.target_entity_id = null;
        }
      }

      // ---- Relation axis (Vector A only; UI hides for envelopes) ----
      if (payload.relation_axis === 'confirm') {
        phone.verification_status = 'verified_good';
        phone.verification_source = 'manual';
        phone.verification_reason = payload.reason || 'Operator confirmed relation';
        phone.verified_at         = now;
      } else if (payload.relation_axis === 'refute') {
        phone.verification_status = 'verified_bad';
        phone.verification_source = 'manual';
        phone.verification_reason = payload.reason || 'Operator severed relation';
        phone.verified_at         = now;
        if (entity) entity.target_entity_id = null;
      }

      // ---- Identification (envelope → named / identified_envelope) ----
      if (payload.identification && isEnvelopeAtStart && entity) {
        const ident = payload.identification;
        const rel   = ident.relation;
        if (rel === 'unrelated') {
          entity.entity_type        = 'unrelated';
          phone.verification_status = 'verified_bad';
          phone.verification_source = 'manual';
          phone.verification_reason = payload.reason || 'Operator identified owner as unrelated';
          phone.verified_at         = now;
          entity.target_entity_id   = null;
        } else if (rel) {
          entity.entity_type        = rel;
          phone.verification_status = 'verified_good';
          phone.verification_source = 'manual';
          phone.verification_reason = payload.reason || `Operator identified owner with relation '${rel}'`;
          phone.verified_at         = now;
        } else {
          entity.entity_type = 'identified_envelope';
          // Propagate verified_good iff the phone-in-network was previously
          // OR concurrently confirmed (confidence_score >= 80 after this submit).
          if (phone.confidence_score != null && phone.confidence_score >= 80) {
            phone.verification_status = 'verified_good';
            phone.verification_source = 'manual';
            phone.verification_reason = payload.reason || 'Operator named owner; envelope previously confirmed';
            phone.verified_at         = now;
          }
          // else: leave verification_status untouched.
        }
        entity.extra_data = {
          ...(entity.extra_data || {}),
          ...(ident.first_name ? { first_name: ident.first_name } : {}),
          ...(ident.last_name  ? { last_name:  ident.last_name  } : {}),
        };
      }

      // Operator attribution stamp (mirrors the backend's audit trail).
      phone.extra_data  = { ...(phone.extra_data || {}), last_verdict_by: operatorId };
      phone.updated_at  = now;

      const phones   = [...prev.phones];
      phones[phoneIdx] = phone;
      const entities = [...prev.entities];
      if (entity && ownerIdx !== -1) entities[ownerIdx] = entity;
      return { ...prev, phones, entities };
    });
  }, []);

  // -------------------------------------------------------------------------
  // applyRetryNow
  // -------------------------------------------------------------------------
  const applyRetryNow = useCallback((logId, operatorId) => {
    // Phase AUTH-B: prefer the current mock user.
    const op = _currentOperatorUsername(operatorId);
    setDb((prev) => {
      const original = prev.actionLogs.find((l) => l.id === logId);
      if (!original) return prev;

      const nextId = Math.max(...prev.actionLogs.map((l) => l.id), 0) + 1;
      const now    = new Date().toISOString();

      const retryLog = {
        id:           nextId,
        phone_id:     original.phone_id,
        action_type:  original.action_type,
        status:       'sent',
        requested_at: now,
        executed_at:  now,
        retry_count:  0,
        retry_after:  null,
        extra_data:   { force_retried_by_operator: op, manual_retry_of: logId },
      };

      const updatedLogs = prev.actionLogs.map((l) =>
        l.id === logId ? { ...l, status: 'superseded', updated_at: now } : l
      );

      return { ...prev, actionLogs: [...updatedLogs, retryLog] };
    });
  }, [_currentOperatorUsername]);

  // -------------------------------------------------------------------------
  // applyTriggerAction
  // -------------------------------------------------------------------------
  const applyTriggerAction = useCallback((newLog) => {
    setDb((prev) => ({ ...prev, actionLogs: [...prev.actionLogs, newLog] }));
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
  // (phone_number, entity_id, entity_type, client_id) are filled by looking
  // up the related phone/entity in the current cache so the mock shape
  // matches the real-API JOIN exactly.
  // -------------------------------------------------------------------------
  const applyOpenTask = useCallback((payload) => {
    setDb((prev) => {
      const nextId = Math.max(...prev.tasks.map((t) => t.id), 0) + 1;
      const now    = new Date().toISOString();
      const phone  = prev.phones.find((p) => p.id === payload.phone_id);
      const entity = phone ? prev.entities.find((e) => e.id === phone.entity_id) : null;

      const newTask = {
        id:                   nextId,
        phone_id:             payload.phone_id,
        source_action_log_id: payload.source_action_log_id ?? null,
        task_type:            payload.task_type,
        status:               'pending',
        // Phase AUTH-B: prefer the current mock user; fall back to
        // the body field for automation-style callers.
        requested_by:         _currentOperatorUsername(payload.requested_by),
        resolved_by:          null,
        created_at:           now,
        updated_at:           now,
        resolved_at:          null,
        extra_data:           payload.extra_data ?? null,
        // JOIN-shape echo so consumers see identical structure to real mode.
        phone_number:         phone?.phone_number ?? null,
        entity_id:            phone?.entity_id    ?? null,
        entity_type:          entity?.entity_type ?? null,
        client_id:            entity?.client_id   ?? null,
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
    // Phase AUTH-B: resolved_by comes from the current mock user
    // when set, falling back to the body field for backward compat
    // with tests that still pass operator_id explicitly.
    const operator = _currentOperatorUsername(body.operator_id);
    setDb((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const now = new Date().toISOString();
        const merged = {
          ...(t.extra_data || {}),
          resolution_outcome: body.outcome,
          resolved_by:        operator,
        };
        if (body.resolution_note != null) {
          merged.resolution_note = body.resolution_note;
        }
        return {
          ...t,
          status:      body.outcome,
          resolved_by: operator,
          resolved_at: now,
          updated_at:  now,
          extra_data:  merged,
        };
      }),
    }));
  }, [_currentOperatorUsername]);

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
    const TERMINAL = new Set(['resolved', 'rejected']);
    // Phase AUTH-B: resolve the operator once at the top.
    const operator = _currentOperatorUsername(body.operator_id);
    let result;
    setDb((prev) => {
      const successIds = [];
      const failedRows = [];
      const now = new Date().toISOString();

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
          resolved_by:        operator,
        };
        if (body.resolution_note != null) {
          merged.resolution_note = body.resolution_note;
        }
        updatedTasks[idx] = {
          ...existing,
          status:      body.outcome,
          resolved_by: operator,
          resolved_at: now,
          updated_at:  now,
          extra_data:  merged,
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
  }, [_currentOperatorUsername]);

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
      const nextId = Math.max(0, ...(prev.notificationSubscriptions || []).map((s) => s.id)) + 1;
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
      const nextId = Math.max(0, ...(prev.notificationDeliveries || []).map((d) => d.id)) + 1;
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
    const nextId = Math.max(0, ...(db.users || []).map((u) => u.id)) + 1;
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
    if (body.managed_client_ids !== undefined && body.managed_client_ids.length === 0) {
      throw new Error('managed_client_ids must contain at least one entry.');
    }
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
  // Derived helpers
  // -------------------------------------------------------------------------
  const getClientMetrics = useCallback(
    (clientId) => deriveClientMetrics(clientId, phones, actionLogs, entities, tasks),
    [phones, actionLogs, entities, tasks]
  );

  const getEntityById = useCallback(
    (entityId) => entities.find((e) => e.id === entityId) || null,
    [entities]
  );

  const getPhoneById = useCallback(
    (phoneId) => phones.find((p) => p.id === phoneId) || null,
    [phones]
  );

  const getLogsForPhone = useCallback(
    (phoneId) => actionLogs.filter((l) => l.phone_id === phoneId),
    [actionLogs]
  );

  const getClientForPhone = useCallback(
    (phoneId) => {
      const phone  = phones.find((p) => p.id === phoneId);
      if (!phone) return null;
      const entity = entities.find((e) => e.id === phone.entity_id);
      if (!entity) return null;
      return clients.find((c) => c.id === entity.client_id) || null;
    },
    [phones, entities, clients]
  );

  const value = {
    // State slices
    clients,
    entities,
    phones,
    actionLogs,
    tasks,
    engines,
    loading,
    // Invalidation / refetch (real-API mode — no-op in mock mode)
    refetchPhones,
    refetchActionLogs,
    refetchTasks,
    // Phase D / DX — narrowed refetches (real-API mode only; no-op in mock mode).
    // Consumers should prefer these over the wholesale refetches when the
    // mutation scope is a single id.
    refetchPhoneById,
    refetchLogsForPhone,
    refetchTaskById,
    spliceActionLog,
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
    applyRetryNow,
    applyTriggerAction,
    applyWorkerRun,
    applyOpenTask,
    applyResolveTask,
    applyBulkResolveTasks,
    applyTableExport,
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
    getLogsForPhone,
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
  // Materialize each row with the JOIN fields the backend includes —
  // entity_type, client_id, customer_tier (pulled from the root
  // target's extra_data when this row is associated, else from its
  // own extra_data).
  rows = rows.map((p) => {
    const ent = db.entities.find((e) => e.id === p.entity_id);
    const root = ent && ent.target_entity_id != null
      ? db.entities.find((e) => e.id === ent.target_entity_id)
      : ent;
    let customerTier = null;
    const tierSrc = (root && root.extra_data) || (ent && ent.extra_data);
    if (tierSrc && tierSrc.customer_tier != null) {
      const parsed = Number(tierSrc.customer_tier);
      customerTier = Number.isFinite(parsed) ? parsed : null;
    }
    return {
      ...p,
      entity_type:   ent?.entity_type ?? null,
      client_id:     ent?.client_id   ?? null,
      customer_tier: customerTier,
    };
  });

  if (f.verification_status) {
    rows = rows.filter((r) => r.verification_status === f.verification_status);
  }
  if (f.ingestion_source) {
    rows = rows.filter((r) => r.ingestion_source === f.ingestion_source);
  }
  if (f.entity_type) {
    rows = rows.filter((r) => r.entity_type === f.entity_type);
  }
  if (f.classification_type) {
    rows = rows.filter((r) => r.classification_type === f.classification_type);
  }
  if (f.client_id != null && f.client_id !== '') {
    rows = rows.filter((r) => String(r.client_id) === String(f.client_id));
  }
  // Phase AUTH-C — multi-value personalization filter parity.
  if (f.client_ids?.length) {
    const allowed = new Set(f.client_ids.map(String));
    rows = rows.filter((r) => allowed.has(String(r.client_id)));
  }
  if (f.q) {
    const needle = String(f.q).toLowerCase();
    rows = rows.filter((r) => {
      const hay = [
        r.phone_number || '',
        String(r.entity_id ?? ''),
        String(r.client_id ?? ''),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  // Newest-first to match the backend's ORDER BY ingested_at DESC.
  rows.sort((a, b) => new Date(b.ingested_at) - new Date(a.ingested_at));
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
  if (f.client_ids?.length) {
    const allowed = new Set(f.client_ids.map(String));
    rows = rows.filter((r) => allowed.has(String(r.client_id)));
  }
  if (f.exclude_terminal && !f.status) {
    // Mirrors the backend: explicit status filter wins.
    rows = rows.filter((r) => r.status !== 'resolved' && r.status !== 'rejected');
  }
  if (f.q) {
    const needle = String(f.q).toLowerCase();
    rows = rows.filter((r) => {
      const hay = [
        r.phone_number || '',
        r.requested_by || '',
        r.resolved_by  || '',
        String(r.client_id ?? ''),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
