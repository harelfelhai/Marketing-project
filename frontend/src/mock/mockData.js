/**
 * mockData.js — Single source of truth for all in-memory seed data.
 *
 * Consolidated per design mandate: no scatter across multiple seed files.
 * All baseline arrays, static structures, and derivation helpers live here.
 *
 * Swap point: when real APIs are wired, MockDataContext stops importing
 * buildInitialDb() and fetches from the backend instead. This file becomes
 * test fixtures only.
 */

// ---------------------------------------------------------------------------
// Clients  (generic names — // HOOK FOR ENTERPRISE LABELS)
//
// Two-level model: a client IS a root entity (target_entity_id IS NULL).
// There is no separate client_id field — client_id is DERIVED as
// `target_entity_id ?? id`. The ids below are therefore the ids of the root
// entities that head each client's family/social envelope (see SEED_ENTITIES).
// ---------------------------------------------------------------------------

export const SEED_CLIENTS = [
  { id: 'ent-1',  name: 'Client Alpha',   sla_hours: 6,  sla_threshold_pct: 85 },
  { id: 'ent-9',  name: 'Client Beta',    sla_hours: 8,  sla_threshold_pct: 90 },
  { id: 'ent-17', name: 'Client Gamma',   sla_hours: 4,  sla_threshold_pct: 80 },
  { id: 'ent-24', name: 'Client Delta',   sla_hours: 12, sla_threshold_pct: 75 },
  { id: 'ent-33', name: 'Client Epsilon', sla_hours: 6,  sla_threshold_pct: 88 },
];

// ---------------------------------------------------------------------------
// Phase DY — customer_tier mapping (mock parity with backend seed_db.py).
// Keyed by the derived client_id (= the heading root entity's id). Lives here
// rather than in clientRegistry because mock-mode tests need it without
// touching the registry seam. In real mode, customer_tier is read from the
// backend response (server-side JOIN); this map is mock-only.
// ---------------------------------------------------------------------------

export const CLIENT_TIER_MAP = {
  'ent-1':  1,   // Alpha
  'ent-9':  2,   // Beta
  'ent-17': 1,   // Gamma
  'ent-24': 3,   // Delta
  'ent-33': 2,   // Epsilon
};

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
// Entities — two-level model.
//
//   * A ROOT entity (target_entity_id == null, entity_type 'target') IS a
//     client. Its derived client_id == its own id. Its display name lives in
//     extra_data.first_name (parity with backend seed_db.py).
//   * A MEMBER entity points at its root via target_entity_id; its derived
//     client_id == that root id. Members are the campaign target's family /
//     social envelope (family / friend / colleague / spouse / social_envelope).
//
// There is no stored client_id column — buildInitialDb() materialises the
// derived value (target_entity_id ?? id) onto each entity and phone so the
// rest of the app keeps reading a string client_id unchanged.
// ---------------------------------------------------------------------------

const _now = new Date('2026-05-17T10:00:00Z');
const _daysAgo = (d) => new Date(_now - d * 86400000).toISOString();

export const SEED_ENTITIES = [
  // ===== Client Alpha — root id 1 + envelope (ids 1-8) =====
  { id: 'ent-1',  relation_type: 'primary',   target_entity_id: null,       full_name: 'Client Alpha',       extra_data: { region: 'north' } },
  { id: 'ent-2',  relation_type: 'family',    target_entity_id: 'ent-1',    full_name: 'Alpha Relative 1',   extra_data: { region: 'north' } },
  { id: 'ent-3',  relation_type: 'friend',    target_entity_id: 'ent-1',    full_name: 'Alpha Relative 2',   extra_data: { region: 'south' } },
  { id: 'ent-4',  relation_type: 'colleague', target_entity_id: 'ent-1',    full_name: 'Alpha Relative 3',   extra_data: { region: 'east'  } },
  { id: 'ent-5',  relation_type: 'family',    target_entity_id: 'ent-1',    full_name: 'Alpha Relative 4',   extra_data: { region: 'west'  } },
  { id: 'ent-6',  relation_type: 'family',    target_entity_id: 'ent-1',    full_name: 'Alpha Relative 5',   extra_data: { region: 'north' } },
  { id: 'ent-7',  relation_type: 'friend',    target_entity_id: 'ent-1',    full_name: 'Alpha Relative 6',   extra_data: { region: 'south' } },
  { id: 'ent-8',  relation_type: 'colleague', target_entity_id: 'ent-1',    full_name: 'Alpha Relative 7',   extra_data: { region: 'east'  } },
  // ===== Client Beta — root id 9 (ids 9-16) =====
  { id: 'ent-9',  relation_type: 'primary',   target_entity_id: null,       full_name: 'Client Beta',        extra_data: { region: 'west'  } },
  { id: 'ent-10', relation_type: 'family',    target_entity_id: 'ent-9',    full_name: 'Beta Relative 1',    extra_data: { region: 'north' } },
  { id: 'ent-11', relation_type: 'friend',    target_entity_id: 'ent-9',    full_name: 'Beta Relative 2',    extra_data: { region: 'east'  } },
  { id: 'ent-12', relation_type: 'colleague', target_entity_id: 'ent-9',    full_name: 'Beta Relative 3',    extra_data: { region: 'south' } },
  { id: 'ent-13', relation_type: 'family',    target_entity_id: 'ent-9',    full_name: 'Beta Relative 4',    extra_data: { region: 'north' } },
  { id: 'ent-14', relation_type: 'family',    target_entity_id: 'ent-9',    full_name: 'Beta Relative 5',    extra_data: { region: 'west'  } },
  { id: 'ent-15', relation_type: 'friend',    target_entity_id: 'ent-9',    full_name: 'Beta Relative 6',    extra_data: { region: 'east'  } },
  { id: 'ent-16', relation_type: 'colleague', target_entity_id: 'ent-9',    full_name: 'Beta Relative 7',    extra_data: { region: 'south' } },
  // ===== Client Gamma — root id 17 (ids 17-23) =====
  { id: 'ent-17', relation_type: 'primary',   target_entity_id: null,       full_name: 'Client Gamma',       extra_data: { region: 'north' } },
  { id: 'ent-18', relation_type: 'family',    target_entity_id: 'ent-17',   full_name: 'Gamma Relative 1',   extra_data: { region: 'east'  } },
  { id: 'ent-19', relation_type: 'friend',    target_entity_id: 'ent-17',   full_name: 'Gamma Relative 2',   extra_data: { region: 'west'  } },
  { id: 'ent-20', relation_type: 'colleague', target_entity_id: 'ent-17',   full_name: 'Gamma Relative 3',   extra_data: { region: 'south' } },
  { id: 'ent-21', relation_type: 'family',    target_entity_id: 'ent-17',   full_name: 'Gamma Relative 4',   extra_data: { region: 'north' } },
  { id: 'ent-22', relation_type: 'family',    target_entity_id: 'ent-17',   full_name: 'Gamma Relative 5',   extra_data: { region: 'east'  } },
  { id: 'ent-23', relation_type: 'friend',    target_entity_id: 'ent-17',   full_name: 'Gamma Relative 6',   extra_data: { region: 'west'  } },
  // ===== Client Delta — root id 24 (ids 24-32) =====
  { id: 'ent-24', relation_type: 'primary',   target_entity_id: null,       full_name: 'Client Delta',       extra_data: { region: 'south' } },
  { id: 'ent-25', relation_type: 'family',    target_entity_id: 'ent-24',   full_name: 'Delta Relative 1',   extra_data: { region: 'north' } },
  { id: 'ent-26', relation_type: 'friend',    target_entity_id: 'ent-24',   full_name: 'Delta Relative 2',   extra_data: { region: 'east'  } },
  { id: 'ent-27', relation_type: 'colleague', target_entity_id: 'ent-24',   full_name: 'Delta Relative 3',   extra_data: { region: 'west'  } },
  { id: 'ent-28', relation_type: 'family',    target_entity_id: 'ent-24',   full_name: 'Delta Relative 4',   extra_data: { region: 'south' } },
  { id: 'ent-29', relation_type: 'family',    target_entity_id: 'ent-24',   full_name: 'Delta Relative 5',   extra_data: { region: 'north' } },
  { id: 'ent-30', relation_type: 'friend',    target_entity_id: 'ent-24',   full_name: 'Delta Relative 6',   extra_data: { region: 'east'  } },
  { id: 'ent-31', relation_type: 'colleague', target_entity_id: 'ent-24',   full_name: 'Delta Relative 7',   extra_data: { region: 'west'  } },
  { id: 'ent-32', relation_type: 'family',    target_entity_id: 'ent-24',   full_name: 'Delta Relative 8',   extra_data: { region: 'south' } },
  // ===== Client Epsilon — root id 33 (ids 33-40) =====
  { id: 'ent-33', relation_type: 'primary',   target_entity_id: null,       full_name: 'Client Epsilon',     extra_data: { region: 'north' } },
  { id: 'ent-34', relation_type: 'family',    target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 1', extra_data: { region: 'east'  } },
  { id: 'ent-35', relation_type: 'friend',    target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 2', extra_data: { region: 'west'  } },
  { id: 'ent-36', relation_type: 'colleague', target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 3', extra_data: { region: 'south' } },
  { id: 'ent-37', relation_type: 'family',    target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 4', extra_data: { region: 'north' } },
  { id: 'ent-38', relation_type: 'family',    target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 5', extra_data: { region: 'east'  } },
  { id: 'ent-39', relation_type: 'friend',    target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 6', extra_data: { region: 'west'  } },
  { id: 'ent-40', relation_type: 'colleague', target_entity_id: 'ent-33',   full_name: 'Epsilon Relative 7', extra_data: { region: 'south' } },
  { id: 'ent-88', relation_type: 'friend',    target_entity_id: 'ent-1',    full_name: null,                 extra_data: { envelope_id: 'EP-088' } },
  { id: 'ent-91', relation_type: 'friend',    target_entity_id: 'ent-9',    full_name: null,                 extra_data: { envelope_id: 'EP-091' } },
];

// ---------------------------------------------------------------------------
// Phones — ~40 records with varied statuses and classification types
// ---------------------------------------------------------------------------

export const SEED_PHONES = [
  // --- Alpha phones (entity_ids 1-8) ---
  {
    id: 'ph-1',  entity_id: 'ent-1',  phone_number: '+15550000001',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.92,
    extra_data: { campaign: 'Q2-2026' },
  },
  {
    id: 'ph-2',  entity_id: 'ent-2',  phone_number: '+15550000002',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.45,
    extra_data: { notes: 'Awaiting first contact' },
  },
  {
    id: 'ph-3',  entity_id: 'ent-3',  phone_number: '+15550000003',
    phone_type: 'work', ingestion_source: 'api',
    verification_status: 'rejected', score: 0.12,
    extra_data: { notes: 'Disconnected number confirmed' },
  },
  {
    id: 'ph-4',  entity_id: 'ent-4',  phone_number: '+15550000004',
    phone_type: 'mobile', ingestion_source: 'import',
    verification_status: 'pending', score: 0.60,
    extra_data: { batch: 'import-2026-05-10' },
  },
  {
    id: 'ph-5',  entity_id: 'ent-5',  phone_number: '+15550000005',
    phone_type: 'home', ingestion_source: 'api',
    verification_status: 'verified', score: 0.88,
    extra_data: { partner: 'partner-01' },
  },
  {
    id: 'ph-6',  entity_id: 'ent-6',  phone_number: '+15550000006',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.50,
    extra_data: {},
  },
  {
    id: 'ph-7',  entity_id: 'ent-7',  phone_number: '+15550000007',
    phone_type: 'work', ingestion_source: 'api',
    verification_status: 'verified', score: 0.75,
    extra_data: { campaign: 'Q2-2026' },
  },
  {
    id: 'ph-8',  entity_id: 'ent-8',  phone_number: '+15550000008',
    phone_type: 'mobile', ingestion_source: 'import',
    verification_status: 'pending', score: 0.55,
    extra_data: { batch: 'import-2026-05-14' },
  },
  // --- Beta phones (entity_ids 9-16) ---
  {
    id: 'ph-9',  entity_id: 'ent-9',  phone_number: '+15550000009',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.78,
    extra_data: { campaign: 'Q1-2026' },
  },
  {
    id: 'ph-10', entity_id: 'ent-10', phone_number: '+15550000010',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.65,
    extra_data: {},
  },
  {
    id: 'ph-11', entity_id: 'ent-11', phone_number: '+15550000011',
    phone_type: 'work', ingestion_source: 'api',
    verification_status: 'rejected', score: 0.20,
    extra_data: { failure_code: 'QC-403' },
  },
  {
    id: 'ph-12', entity_id: 'ent-12', phone_number: '+15550000012',
    phone_type: 'home', ingestion_source: 'import',
    verification_status: 'pending', score: 0.48,
    extra_data: { batch: 'import-2026-05-08' },
  },
  {
    id: 'ph-13', entity_id: 'ent-13', phone_number: '+15550000013',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.85,
    extra_data: { partner: 'partner-02' },
  },
  {
    id: 'ph-14', entity_id: 'ent-14', phone_number: '+15550000014',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.40,
    extra_data: {},
  },
  {
    id: 'ph-15', entity_id: 'ent-15', phone_number: '+15550000015',
    phone_type: 'work', ingestion_source: 'api',
    verification_status: 'verified', score: 0.92,
    extra_data: { campaign: 'Q2-2026' },
  },
  {
    id: 'ph-16', entity_id: 'ent-16', phone_number: '+15550000016',
    phone_type: 'mobile', ingestion_source: 'import',
    verification_status: 'pending', score: 0.42,
    extra_data: { batch: 'import-2026-05-15' },
  },
  // --- Gamma phones (entity_ids 17-23) ---
  {
    id: 'ph-17', entity_id: 'ent-17', phone_number: '+15550000017',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.90,
    extra_data: { campaign: 'Q1-2026' },
  },
  {
    id: 'ph-18', entity_id: 'ent-18', phone_number: '+15550000018',
    phone_type: 'home', ingestion_source: 'manual',
    verification_status: 'rejected', score: 0.15,
    extra_data: { failure_reason: 'invalid_format' },
  },
  {
    id: 'ph-19', entity_id: 'ent-19', phone_number: '+15550000019',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'pending', score: 0.52,
    extra_data: {},
  },
  {
    id: 'ph-20', entity_id: 'ent-20', phone_number: '+15550000020',
    phone_type: 'work', ingestion_source: 'import',
    verification_status: 'verified', score: 0.97,
    extra_data: { batch: 'import-2026-05-08' },
  },
  {
    id: 'ph-21', entity_id: 'ent-21', phone_number: '+15550000021',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'pending', score: 0.68,
    extra_data: { partner: 'partner-03' },
  },
  {
    id: 'ph-22', entity_id: 'ent-22', phone_number: '+15550000022',
    phone_type: 'work', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.35,
    extra_data: {},
  },
  {
    id: 'ph-23', entity_id: 'ent-23', phone_number: '+15550000023',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.80,
    extra_data: { campaign: 'Q2-2026' },
  },
  // --- Delta phones (entity_ids 24-32) ---
  {
    id: 'ph-24', entity_id: 'ent-24', phone_number: '+15550000024',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.88,
    extra_data: { campaign: 'Q1-2026' },
  },
  {
    id: 'ph-25', entity_id: 'ent-25', phone_number: '+15550000025',
    phone_type: 'home', ingestion_source: 'import',
    verification_status: 'pending', score: 0.55,
    extra_data: { batch: 'import-2026-05-03' },
  },
  {
    id: 'ph-26', entity_id: 'ent-26', phone_number: '+15550000026',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'rejected', score: 0.10,
    extra_data: { suppression_code: 'SUP-007' },
  },
  {
    id: 'ph-27', entity_id: 'ent-27', phone_number: '+15550000027',
    phone_type: 'work', ingestion_source: 'api',
    verification_status: 'pending', score: 0.58,
    extra_data: {},
  },
  {
    id: 'ph-28', entity_id: 'ent-28', phone_number: '+15550000028',
    phone_type: 'mobile', ingestion_source: 'import',
    verification_status: 'verified', score: 0.82,
    extra_data: { batch: 'import-2026-05-09' },
  },
  {
    id: 'ph-29', entity_id: 'ent-29', phone_number: '+15550000029',
    phone_type: 'home', ingestion_source: 'api',
    verification_status: 'pending', score: 0.38,
    extra_data: { partner: 'partner-01' },
  },
  {
    id: 'ph-30', entity_id: 'ent-30', phone_number: '+15550000030',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.47,
    extra_data: {},
  },
  {
    id: 'ph-31', entity_id: 'ent-31', phone_number: '+15550000031',
    phone_type: 'work', ingestion_source: 'api',
    verification_status: 'verified', score: 0.89,
    extra_data: { campaign: 'Q2-2026' },
  },
  {
    id: 'ph-32', entity_id: 'ent-32', phone_number: '+15550000032',
    phone_type: 'mobile', ingestion_source: 'import',
    verification_status: 'pending', score: 0.33,
    extra_data: { batch: 'import-2026-05-16' },
  },
  // --- Epsilon phones (entity_ids 33-40) ---
  {
    id: 'ph-33', entity_id: 'ent-33', phone_number: '+15550000033',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'verified', score: 0.91,
    extra_data: { campaign: 'Q1-2026' },
  },
  {
    id: 'ph-34', entity_id: 'ent-34', phone_number: '+15550000034',
    phone_type: 'home', ingestion_source: 'manual',
    verification_status: 'pending', score: 0.44,
    extra_data: {},
  },
  {
    id: 'ph-35', entity_id: 'ent-35', phone_number: '+15550000035',
    phone_type: 'work', ingestion_source: 'import',
    verification_status: 'rejected', score: 0.31,
    extra_data: { batch: 'import-2026-05-04' },
  },
  {
    id: 'ph-36', entity_id: 'ent-36', phone_number: '+15550000036',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'pending', score: 0.62,
    extra_data: {},
  },
  {
    id: 'ph-37', entity_id: 'ent-37', phone_number: '+15550000037',
    phone_type: 'mobile', ingestion_source: 'manual',
    verification_status: 'verified', score: 0.76,
    extra_data: {},
  },
  {
    id: 'ph-38', entity_id: 'ent-38', phone_number: '+15550000038',
    phone_type: 'home', ingestion_source: 'api',
    verification_status: 'pending', score: 0.39,
    extra_data: { partner: 'partner-02' },
  },
  {
    id: 'ph-39', entity_id: 'ent-39', phone_number: '+15550000039',
    phone_type: 'work', ingestion_source: 'import',
    verification_status: 'verified', score: 0.94,
    extra_data: { batch: 'import-2026-05-12' },
  },
  {
    id: 'ph-40', entity_id: 'ent-40', phone_number: '+15550000040',
    phone_type: 'mobile', ingestion_source: 'api',
    verification_status: 'pending', score: 0.50,
    extra_data: { campaign: 'Q2-2026' },
  },
  { id: 'ph-88', entity_id: 'ent-88', phone_number: '+15559000088',
    phone_type: 'mobile', ingestion_source: 'automated',
    verification_status: 'pending', score: 0.45,
    extra_data: { source_cluster: 'cluster-44' },
  },
  { id: 'ph-91', entity_id: 'ent-91', phone_number: '+15559000091',
    phone_type: 'mobile', ingestion_source: 'automated',
    verification_status: 'pending', score: 0.72,
    extra_data: { source_cluster: 'cluster-71' },
  },
];

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
      // Full controlled vocabulary — matches the backend's
      // interfaces/relation_types.py::RelationType enum. Phase E2-C
      // relies on the operator-creatable subset (family / friend /
      // colleague / spouse) being valid here so the friction-free
      // handoff from the entity modal can pre-fill this field.
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
      name: 'client_id',
      label: 'Client',       // HOOK FOR ENTERPRISE LABELS
      type: 'select',
      required: true,
      // Derived client_id == heading root entity id (see SEED_CLIENTS).
      options: ['ent-1', 'ent-9', 'ent-17', 'ent-24', 'ent-33'],
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
// Engine worker state defaults — tracked globally so tab switches don't
// lose spinner state (per UI robustness mandate).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pipeline tasks  (Phase DX — Operations Task Queue mock seed)
//
// Five representative tasks covering all 3 task_types × 4 statuses so the
// OperationsQueue UI has data to render across every filter sub-view in
// mock mode. Shape matches PipelineTaskResponse exactly (snake_case keys
// with JOIN convenience fields client_id / phone_number / entity_id /
// entity_type already inlined).
// ---------------------------------------------------------------------------

export const SEED_TASKS = [
  {
    id: 'task-1',
    phone_id:    'ph-2',
    phone_number: '+15550000002',
    entity_id:   'ent-2',
    task_type:   'remediation_failure',
    status:      'pending',
    client_id:   'ent-1',
    extra_data: {
      failure_category: 'provider_blocked',
      suggested_remediation: 'Escalate to carrier for unblock review.',
    },
  },
  {
    id: 'task-2',
    phone_id:    'ph-9',
    phone_number: '+15550000009',
    entity_id:   'ent-9',
    task_type:   'remediation_failure',
    status:      'pending',
    client_id:   'ent-9',
    extra_data: {
      failure_category: 'quota_exceeded',
      suggested_remediation: 'Retry tomorrow after quota reset.',
    },
  },
  {
    id: 'task-3',
    phone_id:    'ph-17',
    phone_number: '+15550000017',
    entity_id:   'ent-17',
    task_type:   'approval_required',
    status:      'pending',
    client_id:   'ent-17',
    extra_data: {
      operator_note: 'Customer requested call-back outside of normal cadence.',
    },
  },
  {
    id: 'task-4',
    phone_id:    'ph-25',
    phone_number: '+15550000025',
    entity_id:   'ent-25',
    task_type:   'manual_recommendation',
    status:      'done',
    client_id:   'ent-24',
    extra_data: {
      recommendation: 'Flag for manual quality review.',
      resolution_note: 'Confirmed reachable; marked verified.',
    },
  },
  {
    id: 'task-5',
    phone_id:    'ph-33',
    phone_number: '+15550000033',
    entity_id:   'ent-33',
    task_type:   'approval_required',
    status:      'rejected',
    client_id:   'ent-33',
    extra_data: {
      operator_note: 'One more retry attempt before abandoning.',
      resolution_note: 'Carrier intercept is permanent; do not retry.',
    },
  },
];


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
  clientId,
  phones,
  _actionLogs,
  entities = SEED_ENTITIES,
  tasks    = [],
) {
  const clientPhones = phones.filter((p) => {
    if (p.client_id != null) return String(p.client_id) === String(clientId);
    const entity = entities.find((e) => e.id === p.entity_id);
    if (!entity) return false;
    const eClientId = entity.client_id ?? entity.target_entity_id ?? entity.id;
    return String(eClientId) === String(clientId);
  });

  const total    = clientPhones.length;
  const pending  = clientPhones.filter((p) => p.verification_status === 'pending').length;
  const good     = clientPhones.filter((p) => p.verification_status === 'verified').length;
  const bad      = clientPhones.filter((p) => p.verification_status === 'rejected').length;

  const openTasks = tasks.filter(
    (t) => t.status === 'pending' && String(t.client_id) === String(clientId),
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
    // Two-level model: client_id is DERIVED. A root (target_entity_id null)
    // is its own client; a member's client_id is the root it points at.
    const clientId = e.target_entity_id != null ? e.target_entity_id : e.id;
    return {
      ...e,
      client_id: clientId,
      extra_data: {
        ...(e.extra_data || {}),
        // Tier keyed by the heading root's id — members inherit it.
        customer_tier: CLIENT_TIER_MAP[clientId] ?? null,
      },
    };
  });

  const phones = structuredClone(SEED_PHONES).map((p) => {
    const entity = entities.find((e) => e.id === p.entity_id);
    return {
      ...p,
      client_id:    entity?.client_id ?? null,
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

export const SEED_SYSTEM_SETTINGS = {
  storage_backend: 'sql',
  backends: [
    { id: 'sql',   available: true },
    { id: 'mongo', available: true },
  ],
  // Per-surface visible-field selections. Empty = each surface uses its
  // catalog defaults (src/config/displayFields.js). Admins edit these from
  // the System Settings tab; they persist via /system/settings/display-fields.
  display_fields: {},
  // Per-surface active filter selections. Empty = each surface uses its
  // catalog defaults (src/config/filterFields.js). Admins edit these from
  // the System Settings tab; they persist via /system/settings/filter-fields.
  filter_fields: {},
  // Whether an admin has stored a MongoDB URL via PUT /settings/mongo-url.
  // The URL itself is never held in the frontend — only this boolean flag.
  mongo_configured: false,
  applies_on_restart: true,
};


