/**
 * mockData.js — Single source of truth for all in-memory seed data.
 *
 * Consolidated per design mandate: no scatter across multiple seed files.
 * All baseline arrays, static structures, and derivation helpers live here.
 *
 * Scale: 100 clients · 1000 entities (100 roots + 900 members) ·
 *        2500 phones · 200 tasks. Generated deterministically via
 *        _mulberry32 so the data is reproducible across hot-reloads.
 *
 * Swap point: when real APIs are wired, MockDataContext stops importing
 * buildInitialDb() and fetches from the backend instead. This file becomes
 * test fixtures only.
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG — Mulberry32, fixed seed for reproducible mock data.
// ---------------------------------------------------------------------------
function _mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _now    = new Date('2026-05-17T10:00:00Z');
const _daysAgo = (d) => new Date(_now - d * 86400000).toISOString();

// ---------------------------------------------------------------------------
// Seed generator — runs once at module load.
// ---------------------------------------------------------------------------
function _generateSeedData() {
  const rng  = _mulberry32(0x1a2b3c4d);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const rn   = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  // Vocabulary tables
  const _BASES    = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa'];
  const _TYPES    = ['Solutions','Corp','Tech','Group','Systems','Capital','Labs','Media','Digital','Finance'];
  const _FIRSTS   = ['יוסי','מיכל','דני','תמר','אבי','רחל','עמי','לאה','גיל','נועה','ארי','שרה','רון','מאיה','עופר','דינה','יוני','כרמל','מתן','הילה'];
  const _LASTS    = ['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','גבאי','אשכנזי','שפירא','רוזן','עמר','דהן','חיים','סבג','צרפתי','בן-דוד','נחמני','קדוש','הרוש','בר-לב'];
  const _ROLES    = ['מנכ"ל','סמנכ"ל כספים','מנהל בכיר','שותף מנהל','מייסד ומנכ"ל','יו"ר','מנהל פעילות','מנהל שיווק','מנהל מכירות','מנהל טכנולוגיה'];
  const _REGIONS  = ['north','south','east','west','center'];
  const _RELTYPES = ['family','friend','colleague','spouse','associated'];
  const _PTYPES   = ['mobile','work','home','type_a','type_b'];
  const _SOURCES  = ['api','manual','import','partner_feed'];
  const _VSTATS   = ['pending','verified','rejected'];
  const _TTYPES   = ['remediation_failure','approval_required','manual_recommendation'];
  // 50% pending bias so the operations queue looks non-trivial by default.
  const _TSTATS   = ['pending','pending','done','rejected'];
  const _SLA_HRS  = [4, 6, 8, 12];

  // 10×10 = 100 unique company names, deterministic by index.
  const companyOf = (i) => `${_BASES[i % 10]} ${_TYPES[Math.floor(i / 10) % 10]}`;

  // ── SEED_CLIENTS (100) ───────────────────────────────────────────────────
  const clients = Array.from({ length: 100 }, (_, i) => ({
    id:               `ent-${i + 1}`,
    name:             companyOf(i),
    sla_hours:        _SLA_HRS[i % 4],
    sla_threshold_pct: 75 + (i % 16),
  }));

  // ── CLIENT_TIER_MAP — tiers 1/2/3 cycling across 100 clients ────────────
  const tierMap = {};
  for (let i = 1; i <= 100; i++) tierMap[`ent-${i}`] = (i % 3) + 1;

  // ── SEED_ENTITIES (1000 = 100 roots + 900 members, 9 per root) ──────────
  const entities = [];

  for (let i = 1; i <= 100; i++) {
    const company = companyOf(i - 1);
    entities.push({
      id:               `ent-${i}`,
      relation_type:    'primary',
      target_entity_id: null,
      full_name:        company,
      identifier_1:     `IL-${String(i).padStart(3, '0')}`,
      extra_data: {
        region: pick(_REGIONS),
        role:   `${pick(_ROLES)}, ${company}`,
      },
    });
  }

  for (let r = 1; r <= 100; r++) {
    for (let m = 0; m < 9; m++) {
      const eNum = 100 + (r - 1) * 9 + m + 1;   // 101 – 1000
      entities.push({
        id:               `ent-${eNum}`,
        relation_type:    pick(_RELTYPES),
        target_entity_id: `ent-${r}`,
        full_name:        `${pick(_FIRSTS)} ${pick(_LASTS)}`,
        identifier_1:     rng() > 0.6 ? `ID-${String(eNum).padStart(4, '0')}` : null,
        identifier_2:     rng() > 0.8 ? `P${eNum}-${rn(1000, 9999)}` : null,
        extra_data:       { region: pick(_REGIONS) },
      });
    }
  }

  // ── SEED_PHONES (2500) ───────────────────────────────────────────────────
  // ph-i  →  ent-((i−1) % 1000 + 1)
  // Entities 1–500 receive 3 phones each; 501–1000 receive 2 each.
  const phones = Array.from({ length: 2500 }, (_, idx) => {
    const i         = idx + 1;
    const entityNum = ((i - 1) % 1000) + 1;
    return {
      id:                  `ph-${i}`,
      entity_id:           `ent-${entityNum}`,
      phone_number:        `+1555${String(i).padStart(7, '0')}`,
      phone_type:          pick(_PTYPES),
      ingestion_source:    pick(_SOURCES),
      verification_status: pick(_VSTATS),
      score:               Math.round(rng() * 100) / 100,
      extra_data:          {},
    };
  });

  // ── SEED_TASKS (200) ─────────────────────────────────────────────────────
  // Each task references ph-i / ent-entityNum / the root of that entity.
  const tasks = Array.from({ length: 200 }, (_, idx) => {
    const i         = idx + 1;
    const entityNum = ((i - 1) % 1000) + 1;
    // Root: roots are ent-1..ent-100; members ent-N → root ent-ceil((N-100)/9)
    const rootNum   = entityNum <= 100 ? entityNum : Math.ceil((entityNum - 100) / 9);
    return {
      id:           `task-${i}`,
      phone_id:     `ph-${i}`,
      phone_number: `+1555${String(i).padStart(7, '0')}`,
      entity_id:    `ent-${entityNum}`,
      task_type:    pick(_TTYPES),
      status:       pick(_TSTATS),
      root_entity_id:    `ent-${rootNum}`,
      extra_data:   {},
    };
  });

  return { clients, tierMap, entities, phones, tasks };
}

const _seed = _generateSeedData();

// ---------------------------------------------------------------------------
// Clients  (100 — one per root entity)
// ---------------------------------------------------------------------------

export const SEED_CLIENTS = _seed.clients;

// ---------------------------------------------------------------------------
// Phase DY — customer_tier mapping (mock parity with backend seed_db.py).
// ---------------------------------------------------------------------------

export const CLIENT_TIER_MAP = _seed.tierMap;

// ---------------------------------------------------------------------------
// Classification types  (// HOOK FOR ENTERPRISE LABELS)
// ---------------------------------------------------------------------------

export const CLASSIFICATION_TYPES = [
  'type_a',
  'type_b',
  'type_c',
  'type_d',
];

export const PHONE_TYPES = CLASSIFICATION_TYPES;

// ---------------------------------------------------------------------------
// Entities — 1000 total (100 root + 900 members, 9 per root).
// ---------------------------------------------------------------------------

export const SEED_ENTITIES = _seed.entities;

// ---------------------------------------------------------------------------
// Phones — 2500 total distributed across all 1000 entities.
// ---------------------------------------------------------------------------

export const SEED_PHONES = _seed.phones;

// ActionLog model was removed. Empty export kept for import compatibility.
export const SEED_ACTION_LOGS = [];

// ---------------------------------------------------------------------------
// Lead Form Schema — mirrors GET /api/v1/schema/lead-form response shape
// ---------------------------------------------------------------------------

export const SEED_FORM_SCHEMA = {
  form_title: 'New Number Ingestion',    // HOOK FOR ENTERPRISE LABELS
  form_description: 'Submit a new contact number for pipeline processing.',
  fields: [
    {
      name: 'phone_number',
      label: 'Phone Number',
      type: 'tel',
      required: true,
      placeholder: '+1 555 000 0000',
      help_text: 'E.164 format required.',
    },
    {
      name: 'entity_type',
      label: 'Entity Type',
      type: 'select',
      required: true,
      options: ['target', 'family', 'friend', 'colleague', 'spouse', 'social_envelope'],
      help_text: 'Classification of the entity being registered.',
    },
    {
      name: 'ingestion_source',
      label: 'Source',
      type: 'select',
      required: true,
      options: ['api', 'manual', 'import', 'partner_feed'],
      help_text: 'Where this contact originated.',
    },
    {
      name: 'ingestion_reason',
      label: 'Ingestion Reason',
      type: 'text',
      required: false,
      placeholder: 'e.g. campaign_signup, referral',
      help_text: 'Optional context for why this number is being ingested.',
    },
    {
      name: 'root_entity_id',
      label: 'Client',       // HOOK FOR ENTERPRISE LABELS
      type: 'select',
      required: true,
      options: Array.from({ length: 100 }, (_, i) => `ent-${i + 1}`),
      help_text: 'Associate this contact with a client account.',
    },
    {
      name: 'entity_extra',
      label: 'Entity Metadata (JSON)',
      type: 'json_blob',
      required: false,
      placeholder: '{"region": "north"}',
      help_text: 'Optional structured metadata for the entity record.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Pipeline tasks (200 — Operations Task Queue mock seed)
// ---------------------------------------------------------------------------

export const SEED_TASKS = _seed.tasks;


// ---------------------------------------------------------------------------
// Engine worker state defaults
// ---------------------------------------------------------------------------

export const DEFAULT_ENGINE_STATES = {
  retry: {
    name: 'retry',
    label: 'Retry Engine',                // HOOK FOR ENTERPRISE LABELS
    lastRunAt: _daysAgo(0.5),
    lastProcessedCount: 4,
    executing: false,
  },
  verification: {
    name: 'verification',
    label: 'Verification Engine',         // HOOK FOR ENTERPRISE LABELS
    lastRunAt: _daysAgo(1),
    lastProcessedCount: 7,
    executing: false,
  },
};

// ---------------------------------------------------------------------------
// Pure derivation helper — computes per-client metrics from live state.
// Called by MockDataContext and consumed by ClientCard.
// ---------------------------------------------------------------------------

export function deriveClientMetrics(
  rootEntityId,
  phones,
  _actionLogs,
  entities = SEED_ENTITIES,
  tasks    = [],
) {
  const clientPhones = phones.filter((p) => {
    if (p.root_entity_id != null) return String(p.root_entity_id) === String(rootEntityId);
    const entity = entities.find((e) => e.id === p.entity_id);
    if (!entity) return false;
    const eClientId = entity.root_entity_id ?? entity.target_entity_id ?? entity.id;
    return String(eClientId) === String(rootEntityId);
  });

  const total    = clientPhones.length;
  const pending  = clientPhones.filter((p) => p.verification_status === 'pending').length;
  const good     = clientPhones.filter((p) => p.verification_status === 'verified').length;
  const bad      = clientPhones.filter((p) => p.verification_status === 'rejected').length;

  const openTasks = tasks.filter(
    (t) => t.status === 'pending' && String(t.root_entity_id) === String(rootEntityId),
  ).length;

  return { total, pending, good, bad, failed: 0, openTasks };
}

// ---------------------------------------------------------------------------
// buildInitialDb — called once by MockDataContext on mount.
// Returns deep copies so mutations don't corrupt the originals.
// ---------------------------------------------------------------------------

export function buildInitialDb() {
  // Phase DY — inject customer_tier into every entity's extra_data so
  // mock-mode renders parity with the backend's JSON-pivot storage.
  // Done at build time rather than embedded in each SEED_ENTITIES entry
  // so the table above stays scannable and the tier mapping is the
  // single source of truth (CLIENT_TIER_MAP).
  const entities = structuredClone(SEED_ENTITIES).map((e) => {
    // Two-level model: root_entity_id is DERIVED. A root (target_entity_id null)
    // is its own client; a member's root_entity_id is the root it points at.
    const rootEntityId = e.target_entity_id != null ? e.target_entity_id : e.id;
    return {
      ...e,
      root_entity_id: rootEntityId,
      extra_data: {
        ...(e.extra_data || {}),
        // Tier keyed by the heading root's id — members inherit it.
        customer_tier: CLIENT_TIER_MAP[rootEntityId] ?? null,
      },
    };
  });

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const phones = structuredClone(SEED_PHONES).map((p) => {
    const entity = entityById.get(p.entity_id);
    return {
      ...p,
      root_entity_id:    entity?.root_entity_id ?? null,
      relation_type: entity?.relation_type ?? null,
    };
  });

  return {
    clients:    structuredClone(SEED_CLIENTS),
    entities,
    phones,
    actionLogs: [],
    tasks:      structuredClone(SEED_TASKS),
    engines:    structuredClone(DEFAULT_ENGINE_STATES),
    // Phase NOTIF — subscriptions + deliveries seeded empty.
    // Operators populate inline via NotificationOptInPanel.
    notificationSubscriptions: [],
    notificationDeliveries:    [],
    // Phase AUTH — mock users + the "currently logged-in" pointer.
    // Seeded empty; tests inject identity via <AuthProvider
    // initialState={...}> rather than seeding here. Production
    // mock-mode operators register through the LoginPage.
    users:               [],
    currentMockUserId:   null,
    // System Settings tab — admin-only infrastructure controls. Mirrors
    // the backend GET /system/settings shape. Only 'sql' is wired today;
    // 'mongo' is a known-but-not-yet-available option.
    systemSettings:      structuredClone(SEED_SYSTEM_SETTINGS),
  };
}


// ---------------------------------------------------------------------------
// System Settings (mock parity with backend /system/settings)
// ---------------------------------------------------------------------------

// Operator-managed closed lists. Single source of truth for every dropdown
// whose options are a controlled vocabulary. Mirrors the backend's
// DEFAULT_VOCABULARIES (services/system_settings.py) and is aligned to the
// values present in the seed data above. Admins add/remove/reorder these
// from the System Settings tab; they persist via /settings/vocabulary/{name}.
export const SEED_VOCABULARIES = {
  relation_types:        ['primary', 'family', 'friend', 'colleague', 'spouse', 'associated'],
  phone_types:           ['mobile', 'work', 'home', 'type_a', 'type_b'],
  ingestion_sources:     ['api', 'manual', 'import', 'partner_feed'],
  verification_statuses: ['pending', 'verified', 'rejected'],
  task_types:            ['remediation_failure', 'approval_required', 'manual_recommendation'],
  task_statuses:         ['pending', 'done', 'rejected'],
};

export const SEED_SYSTEM_SETTINGS = {
  storage_backend: 'sql',
  backends: [
    { id: 'sql',   available: true },
    { id: 'mongo', available: true },
  ],
  // Operator-managed closed lists (see SEED_VOCABULARIES). Every controlled
  // dropdown reads from here so adding a type is a frontend-only action.
  vocabularies: structuredClone(SEED_VOCABULARIES),
  // Per-surface visible-field selections. Empty = each surface uses its
  // catalog defaults (src/config/displayFields.js). Admins edit these from
  // the System Settings tab; they persist via /system/settings/display-fields.
  display_fields: {},
  // Per-surface column-label overrides: { surface: { field_key: label } }.
  // Empty = each surface uses its catalog default labels. Admins edit these
  // from the System Settings tab; they persist via /settings/display-labels.
  display_labels: {},
  // Per-surface active filter selections. Empty = each surface uses its
  // catalog defaults (src/config/filterFields.js). Admins edit these from
  // the System Settings tab; they persist via /system/settings/filter-fields.
  filter_fields: {},
  // Whether an admin has stored a MongoDB URL via PUT /settings/mongo-url.
  // The URL itself is never held in the frontend — only this boolean flag.
  mongo_configured: false,
  applies_on_restart: true,
};
