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
// ---------------------------------------------------------------------------

export const SEED_CLIENTS = [
  { id: 'alpha',   name: 'Client Alpha',   sla_hours: 6,  sla_threshold_pct: 85 },
  { id: 'beta',    name: 'Client Beta',    sla_hours: 8,  sla_threshold_pct: 90 },
  { id: 'gamma',   name: 'Client Gamma',   sla_hours: 4,  sla_threshold_pct: 80 },
  { id: 'delta',   name: 'Client Delta',   sla_hours: 12, sla_threshold_pct: 75 },
  { id: 'epsilon', name: 'Client Epsilon', sla_hours: 6,  sla_threshold_pct: 88 },
];

// ---------------------------------------------------------------------------
// Phase DY — customer_tier mapping (mock parity with backend seed_db.py).
// Lives here rather than in clientRegistry because mock-mode tests need it
// without touching the registry seam. In real mode, customer_tier is read
// from the backend response (server-side JOIN); this map is mock-only.
// ---------------------------------------------------------------------------

export const CLIENT_TIER_MAP = {
  alpha:   1,
  beta:    2,
  gamma:   1,
  delta:   3,
  epsilon: 2,
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

// ---------------------------------------------------------------------------
// Entities — one Entity per target individual, linked to a client via extra_data
// ---------------------------------------------------------------------------

const _now = new Date('2026-05-17T10:00:00Z');
const _daysAgo = (d) => new Date(_now - d * 86400000).toISOString();

export const SEED_ENTITIES = [
  // Alpha — 8 entities (ids 1-8)
  { id: 1,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'north' } },
  { id: 2,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'north' } },
  { id: 3,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'south' } },
  { id: 4,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'east'  } },
  { id: 5,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'west'  } },
  { id: 6,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'north' } },
  { id: 7,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'south' } },
  { id: 8,  entity_type: 'target', client_id: 'alpha',   extra_data: { region: 'east'  } },
  // Beta — 8 entities (ids 9-16)
  { id: 9,  entity_type: 'target', client_id: 'beta',    extra_data: { region: 'west'  } },
  { id: 10, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'north' } },
  { id: 11, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'east'  } },
  { id: 12, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'south' } },
  { id: 13, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'north' } },
  { id: 14, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'west'  } },
  { id: 15, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'east'  } },
  { id: 16, entity_type: 'target', client_id: 'beta',    extra_data: { region: 'south' } },
  // Gamma — 7 entities (ids 17-23)
  { id: 17, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'north' } },
  { id: 18, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'east'  } },
  { id: 19, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'west'  } },
  { id: 20, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'south' } },
  { id: 21, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'north' } },
  { id: 22, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'east'  } },
  { id: 23, entity_type: 'target', client_id: 'gamma',   extra_data: { region: 'west'  } },
  // Delta — 9 entities (ids 24-32)
  { id: 24, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'south' } },
  { id: 25, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'north' } },
  { id: 26, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'east'  } },
  { id: 27, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'west'  } },
  { id: 28, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'south' } },
  { id: 29, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'north' } },
  { id: 30, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'east'  } },
  { id: 31, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'west'  } },
  { id: 32, entity_type: 'target', client_id: 'delta',   extra_data: { region: 'south' } },
  // Epsilon — 8 entities (ids 33-40)
  { id: 33, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'north' } },
  { id: 34, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'east'  } },
  { id: 35, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'west'  } },
  { id: 36, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'south' } },
  { id: 37, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'north' } },
  { id: 38, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'east'  } },
  { id: 39, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'west'  } },
  { id: 40, entity_type: 'target', client_id: 'epsilon', extra_data: { region: 'south' } },

  // Phase DY-4 — social_envelope entities (Vector B). target_entity_id
  // points at the owning primary so the row sits inside that client's
  // queue. Identity unknown at ingest; the operator's audit either
  // confirms placement, identifies the owner, or refutes the surfacing.
  { id: 88, entity_type: 'social_envelope', client_id: 'alpha',
    target_entity_id: 1,
    extra_data: { envelope_id: 'EP-088', scrape_source: 'social_cluster_alpha' } },
  { id: 91, entity_type: 'social_envelope', client_id: 'beta',
    target_entity_id: 9,
    extra_data: { envelope_id: 'EP-091', scrape_source: 'co_occurrence_beta' } },
];

// ---------------------------------------------------------------------------
// Phones — ~40 records with varied statuses and classification types
// ---------------------------------------------------------------------------

export const SEED_PHONES = [
  // --- Alpha phones (entity_ids 1-8) ---
  {
    id: 1,  entity_id: 1,  phone_number: '+15550000001',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(10),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Confirmed via operator review',
    verified_at: _daysAgo(8), created_at: _daysAgo(10), updated_at: _daysAgo(8),
    extra_data: { priority: 'high', campaign: 'Q2-2026' },
  },
  {
    id: 2,  entity_id: 2,  phone_number: '+15550000002',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(9),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(9), updated_at: _daysAgo(9),
    extra_data: { priority: 'medium', notes: 'Awaiting first contact' },
  },
  {
    id: 3,  entity_id: 3,  phone_number: '+15550000003',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(8),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Number disconnected',
    verified_at: _daysAgo(6), created_at: _daysAgo(8), updated_at: _daysAgo(6),
    extra_data: { priority: 'low', notes: 'Disconnected number confirmed' },
  },
  {
    id: 4,  entity_id: 4,  phone_number: '+15550000004',
    classification_type: 'type_a', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(7),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(7), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', batch: 'import-2026-05-10' },
  },
  {
    id: 5,  entity_id: 5,  phone_number: '+15550000005',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(6),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Verified by senior operator',
    verified_at: _daysAgo(5), created_at: _daysAgo(6), updated_at: _daysAgo(5),
    extra_data: { priority: 'high', partner: 'partner-01' },
  },
  {
    id: 6,  entity_id: 6,  phone_number: '+15550000006',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(5),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(5), updated_at: _daysAgo(5),
    extra_data: { priority: 'medium' },
  },
  {
    id: 7,  entity_id: 7,  phone_number: '+15550000007',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(4),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Passed automated quality check',
    verified_at: _daysAgo(3), created_at: _daysAgo(4), updated_at: _daysAgo(3),
    extra_data: { priority: 'low', campaign: 'Q2-2026' },
  },
  {
    id: 8,  entity_id: 8,  phone_number: '+15550000008',
    classification_type: 'type_a', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(3),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(3), updated_at: _daysAgo(3),
    extra_data: { priority: 'high', batch: 'import-2026-05-14' },
  },
  // --- Beta phones (entity_ids 9-16) ---
  {
    id: 9,  entity_id: 9,  phone_number: '+15550000009',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(12),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Operator confirmed contact',
    verified_at: _daysAgo(10), created_at: _daysAgo(12), updated_at: _daysAgo(10),
    extra_data: { priority: 'medium', campaign: 'Q1-2026' },
  },
  {
    id: 10, entity_id: 10, phone_number: '+15550000010',
    classification_type: 'type_a', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(11),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(11), updated_at: _daysAgo(11),
    extra_data: { priority: 'high' },
  },
  {
    id: 11, entity_id: 11, phone_number: '+15550000011',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(10),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Failed quality threshold',
    verified_at: _daysAgo(8), created_at: _daysAgo(10), updated_at: _daysAgo(8),
    extra_data: { priority: 'low', failure_code: 'QC-403' },
  },
  {
    id: 12, entity_id: 12, phone_number: '+15550000012',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(9),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(9), updated_at: _daysAgo(9),
    extra_data: { priority: 'medium', batch: 'import-2026-05-08' },
  },
  {
    id: 13, entity_id: 13, phone_number: '+15550000013',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(8),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Verified clean number',
    verified_at: _daysAgo(7), created_at: _daysAgo(8), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', partner: 'partner-02' },
  },
  {
    id: 14, entity_id: 14, phone_number: '+15550000014',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(6),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(6), updated_at: _daysAgo(6),
    extra_data: { priority: 'low' },
  },
  {
    id: 15, entity_id: 15, phone_number: '+15550000015',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(4),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Automated pass — score 0.92',
    verified_at: _daysAgo(3), created_at: _daysAgo(4), updated_at: _daysAgo(3),
    extra_data: { priority: 'medium', campaign: 'Q2-2026', score: 0.92 },
  },
  {
    id: 16, entity_id: 16, phone_number: '+15550000016',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(2),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(2), updated_at: _daysAgo(2),
    extra_data: { priority: 'medium', batch: 'import-2026-05-15' },
  },
  // --- Gamma phones (entity_ids 17-23) ---
  {
    id: 17, entity_id: 17, phone_number: '+15550000017',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(14),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Confirmed by team lead',
    verified_at: _daysAgo(12), created_at: _daysAgo(14), updated_at: _daysAgo(12),
    extra_data: { priority: 'high', campaign: 'Q1-2026' },
  },
  {
    id: 18, entity_id: 18, phone_number: '+15550000018',
    classification_type: 'type_a', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(13),
    verification_status: 'verified_bad', verification_source: 'manual',
    verification_reason: 'Invalid number format',
    verified_at: _daysAgo(11), created_at: _daysAgo(13), updated_at: _daysAgo(11),
    extra_data: { priority: 'low', failure_reason: 'invalid_format' },
  },
  {
    id: 19, entity_id: 19, phone_number: '+15550000019',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(11),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(11), updated_at: _daysAgo(11),
    extra_data: { priority: 'medium' },
  },
  {
    id: 20, entity_id: 20, phone_number: '+15550000020',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(9),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'High confidence score',
    verified_at: _daysAgo(8), created_at: _daysAgo(9), updated_at: _daysAgo(8),
    extra_data: { priority: 'high', score: 0.97, batch: 'import-2026-05-08' },
  },
  {
    id: 21, entity_id: 21, phone_number: '+15550000021',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(7),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(7), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', partner: 'partner-03' },
  },
  {
    id: 22, entity_id: 22, phone_number: '+15550000022',
    classification_type: 'type_c', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(5),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(5), updated_at: _daysAgo(5),
    extra_data: { priority: 'low' },
  },
  {
    id: 23, entity_id: 23, phone_number: '+15550000023',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(3),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Manual review passed',
    verified_at: _daysAgo(2), created_at: _daysAgo(3), updated_at: _daysAgo(2),
    extra_data: { priority: 'medium', campaign: 'Q2-2026' },
  },
  // --- Delta phones (entity_ids 24-32) ---
  {
    id: 24, entity_id: 24, phone_number: '+15550000024',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(15),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Cleared by auditor',
    verified_at: _daysAgo(13), created_at: _daysAgo(15), updated_at: _daysAgo(13),
    extra_data: { priority: 'high', campaign: 'Q1-2026' },
  },
  {
    id: 25, entity_id: 25, phone_number: '+15550000025',
    classification_type: 'type_a', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(14),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(14), updated_at: _daysAgo(14),
    extra_data: { priority: 'medium', batch: 'import-2026-05-03' },
  },
  {
    id: 26, entity_id: 26, phone_number: '+15550000026',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(12),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Number on suppression list',
    verified_at: _daysAgo(10), created_at: _daysAgo(12), updated_at: _daysAgo(10),
    extra_data: { priority: 'low', suppression_code: 'SUP-007' },
  },
  {
    id: 27, entity_id: 27, phone_number: '+15550000027',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(10),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(10), updated_at: _daysAgo(10),
    extra_data: { priority: 'medium' },
  },
  {
    id: 28, entity_id: 28, phone_number: '+15550000028',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(8),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Passed manual spot check',
    verified_at: _daysAgo(7), created_at: _daysAgo(8), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', batch: 'import-2026-05-09' },
  },
  {
    id: 29, entity_id: 29, phone_number: '+15550000029',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(6),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(6), updated_at: _daysAgo(6),
    extra_data: { priority: 'low', partner: 'partner-01' },
  },
  {
    id: 30, entity_id: 30, phone_number: '+15550000030',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(4),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(4), updated_at: _daysAgo(4),
    extra_data: { priority: 'medium' },
  },
  {
    id: 31, entity_id: 31, phone_number: '+15550000031',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(2),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Auto-cleared score 0.89',
    verified_at: _daysAgo(1), created_at: _daysAgo(2), updated_at: _daysAgo(1),
    extra_data: { priority: 'high', campaign: 'Q2-2026', score: 0.89 },
  },
  {
    id: 32, entity_id: 32, phone_number: '+15550000032',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(1),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(1), updated_at: _daysAgo(1),
    extra_data: { priority: 'low', batch: 'import-2026-05-16' },
  },
  // --- Epsilon phones (entity_ids 33-40) ---
  {
    id: 33, entity_id: 33, phone_number: '+15550000033',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(16),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Cleared by compliance team',
    verified_at: _daysAgo(14), created_at: _daysAgo(16), updated_at: _daysAgo(14),
    extra_data: { priority: 'high', campaign: 'Q1-2026' },
  },
  {
    id: 34, entity_id: 34, phone_number: '+15550000034',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(15),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(15), updated_at: _daysAgo(15),
    extra_data: { priority: 'medium' },
  },
  {
    id: 35, entity_id: 35, phone_number: '+15550000035',
    classification_type: 'type_c', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(13),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Score below minimum threshold',
    verified_at: _daysAgo(11), created_at: _daysAgo(13), updated_at: _daysAgo(11),
    extra_data: { priority: 'low', score: 0.31, batch: 'import-2026-05-04' },
  },
  {
    id: 36, entity_id: 36, phone_number: '+15550000036',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(11),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(11), updated_at: _daysAgo(11),
    extra_data: { priority: 'high' },
  },
  {
    id: 37, entity_id: 37, phone_number: '+15550000037',
    classification_type: 'type_a', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(9),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Direct verification call made',
    verified_at: _daysAgo(8), created_at: _daysAgo(9), updated_at: _daysAgo(8),
    extra_data: { priority: 'medium' },
  },
  {
    id: 38, entity_id: 38, phone_number: '+15550000038',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(7),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(7), updated_at: _daysAgo(7),
    extra_data: { priority: 'low', partner: 'partner-02' },
  },
  {
    id: 39, entity_id: 39, phone_number: '+15550000039',
    classification_type: 'type_c', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(5),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Batch auto-cleared',
    verified_at: _daysAgo(4), created_at: _daysAgo(5), updated_at: _daysAgo(4),
    extra_data: { priority: 'high', score: 0.94, batch: 'import-2026-05-12' },
  },
  {
    id: 40, entity_id: 40, phone_number: '+15550000040',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(2),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(2), updated_at: _daysAgo(2),
    extra_data: { priority: 'medium', campaign: 'Q2-2026' },
  },

  // Phase DY-4 — Vector B envelope phones. Identity unknown; the
  // owning entity is a 'social_envelope' placeholder. buildInitialDb()
  // injects customer_tier + priority_score via the same path as named
  // entities, so these rows participate in the priority sort normally.

  // EP-088 — raw envelope, untouched. Demonstrates "📡 ◌ 🔍 ◇".
  {
    id: 88, entity_id: 88, phone_number: '+15559000088',
    classification_type: null, ingestion_source: 'automated',
    ingestion_reason: 'Surfaced via social-cluster scrape.',
    ingested_at: _daysAgo(6),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(6), updated_at: _daysAgo(6),
    extra_data: { source_cluster: 'cluster-44' },
    // confidence omitted → uses _seededConfidence() default
  },
  // EP-091 — phone-in-network confirmed but owner unknown.
  // Demonstrates "📡 ● 🔍 ◇" — your specific scenario.
  {
    id: 91, entity_id: 91, phone_number: '+15559000091',
    classification_type: null, ingestion_source: 'automated',
    ingestion_reason: 'Surfaced via co-occurrence cluster.',
    ingested_at: _daysAgo(5),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(5), updated_at: _daysAgo(4),
    extra_data: { source_cluster: 'cluster-71', operator_note: 'Confirmed phone is in target network; identity pending.' },
    confidence_score: 100,   // operator-confirmed envelope placement
    confidence_updated_at: _daysAgo(4),
  },
];

// ---------------------------------------------------------------------------
// Action Logs — mix of sent / failed / scheduled_retry / delivered
// ---------------------------------------------------------------------------

export const SEED_ACTION_LOGS = [
  // Phone 1 — successful pipeline
  {
    id: 1,  phone_id: 1,  action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(10), executed_at: _daysAgo(10),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01', result: 'delivered' },
  },
  // Phone 2 — pending, action queued
  {
    id: 2,  phone_id: 2,  action_type: 'outreach_b', status: 'scheduled_retry',
    requested_at: _daysAgo(9), executed_at: null,
    retry_count: 1, retry_after: _daysAgo(-1),
    extra_data: { operator_id: 'mock_operator_01', error_detail: 'Temporary timeout on first attempt' },
  },
  // Phone 3 — failed
  {
    id: 3,  phone_id: 3,  action_type: 'outreach_a', status: 'failed',
    requested_at: _daysAgo(8), executed_at: _daysAgo(8),
    retry_count: 3, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Max retries exceeded — carrier rejection',
      stack_trace: 'ActionExecutionError: carrier rejected\n  at dispatch (dispatcher.py:112)\n  at RetryEngine.run (retry.py:88)',
    },
  },
  // Phone 4 — sent
  {
    id: 4,  phone_id: 4,  action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(7), executed_at: _daysAgo(7),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 5 — two logs: first failed, retry succeeded
  {
    id: 5,  phone_id: 5,  action_type: 'outreach_b', status: 'failed',
    requested_at: _daysAgo(6), executed_at: _daysAgo(6),
    retry_count: 1, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Connection refused',
      stack_trace: 'ConnectionError: refused\n  at handler.execute (dispatcher.py:77)',
    },
  },
  {
    id: 6,  phone_id: 5,  action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(5), executed_at: _daysAgo(5),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 7 — sent
  {
    id: 7,  phone_id: 7,  action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(4), executed_at: _daysAgo(4),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 9 — Beta, sent
  {
    id: 8,  phone_id: 9,  action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(12), executed_at: _daysAgo(12),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 10 — Beta, failed
  {
    id: 9,  phone_id: 10, action_type: 'outreach_a', status: 'failed',
    requested_at: _daysAgo(11), executed_at: _daysAgo(11),
    retry_count: 2, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Handler returned non-200 status',
      stack_trace: 'HTTPError: 503 Service Unavailable\n  at BaseActionHandler.execute',
    },
  },
  // Phone 11 — Beta, failed
  {
    id: 10, phone_id: 11, action_type: 'outreach_b', status: 'failed',
    requested_at: _daysAgo(10), executed_at: _daysAgo(10),
    retry_count: 3, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Number flagged as invalid',
      stack_trace: 'ValidationError: phone_number invalid\n  at validate (ingestion.py:44)',
    },
  },
  // Phone 13 — Beta, sent
  {
    id: 11, phone_id: 13, action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(8), executed_at: _daysAgo(8),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 15 — Beta, sent
  {
    id: 12, phone_id: 15, action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(4), executed_at: _daysAgo(4),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 17 — Gamma, sent
  {
    id: 13, phone_id: 17, action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(14), executed_at: _daysAgo(14),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 19 — Gamma, scheduled_retry
  {
    id: 14, phone_id: 19, action_type: 'outreach_c', status: 'scheduled_retry',
    requested_at: _daysAgo(11), executed_at: null,
    retry_count: 2, retry_after: _daysAgo(-2),
    extra_data: { operator_id: 'mock_operator_01', error_detail: 'Rate limit hit — backing off' },
  },
  // Phone 20 — Gamma, sent
  {
    id: 15, phone_id: 20, action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(9), executed_at: _daysAgo(9),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 24 — Delta, sent
  {
    id: 16, phone_id: 24, action_type: 'outreach_d', status: 'sent',
    requested_at: _daysAgo(15), executed_at: _daysAgo(15),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 26 — Delta, failed
  {
    id: 17, phone_id: 26, action_type: 'outreach_a', status: 'failed',
    requested_at: _daysAgo(12), executed_at: _daysAgo(12),
    retry_count: 3, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Suppression list match — blocked',
      stack_trace: 'SuppressionError: number blocked\n  at check_suppression (dispatcher.py:55)',
    },
  },
  // Phone 28 — Delta, sent
  {
    id: 18, phone_id: 28, action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(8), executed_at: _daysAgo(8),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 31 — Delta, sent
  {
    id: 19, phone_id: 31, action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(2), executed_at: _daysAgo(2),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 33 — Epsilon, sent
  {
    id: 20, phone_id: 33, action_type: 'outreach_d', status: 'sent',
    requested_at: _daysAgo(16), executed_at: _daysAgo(16),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 35 — Epsilon, failed
  {
    id: 21, phone_id: 35, action_type: 'outreach_a', status: 'failed',
    requested_at: _daysAgo(13), executed_at: _daysAgo(13),
    retry_count: 3, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Quality score too low for dispatch',
      stack_trace: 'QualityGateError: score 0.31 < 0.50\n  at quality_check (verification.py:33)',
    },
  },
  // Phone 37 — Epsilon, sent
  {
    id: 22, phone_id: 37, action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(9), executed_at: _daysAgo(9),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 39 — Epsilon, sent
  {
    id: 23, phone_id: 39, action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(5), executed_at: _daysAgo(5),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
];

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
      options: ['target'],
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
      options: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
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
    id: 1,
    phone_id: 2,
    source_action_log_id: null,
    task_type: 'remediation_failure',
    status: 'pending',
    requested_by: 'automation:retry_engine',
    resolved_by: null,
    created_at: _daysAgo(0.75),
    updated_at: _daysAgo(0.75),
    resolved_at: null,
    extra_data: {
      failure_category: 'provider_blocked',
      suggested_remediation: 'Escalate to carrier for unblock review.',
    },
    // JOIN convenience fields (inlined to match real-mode payload).
    phone_number: '+14155550102',
    entity_id:    2,
    entity_type:  'target',
    client_id:    'alpha',
  },
  {
    id: 2,
    phone_id: 9,
    source_action_log_id: null,
    task_type: 'remediation_failure',
    status: 'assigned',
    requested_by: 'automation:retry_engine',
    resolved_by: null,
    created_at: _daysAgo(0.5),
    updated_at: _daysAgo(0.4),
    resolved_at: null,
    extra_data: {
      failure_category: 'quota_exceeded',
      suggested_remediation: 'Retry tomorrow after quota reset.',
    },
    phone_number: '+14155550109',
    entity_id:    9,
    entity_type:  'target',
    client_id:    'beta',
  },
  {
    id: 3,
    phone_id: 17,
    source_action_log_id: null,
    task_type: 'approval_required',
    status: 'pending',
    requested_by: 'mock_operator_02',
    resolved_by: null,
    created_at: _daysAgo(0.25),
    updated_at: _daysAgo(0.25),
    resolved_at: null,
    extra_data: {
      requested_action_type: 'action_type_b',
      operator_note: 'Customer requested call-back outside of normal cadence.',
    },
    phone_number: '+14155550117',
    entity_id:    17,
    entity_type:  'target',
    client_id:    'gamma',
  },
  {
    id: 4,
    phone_id: 25,
    source_action_log_id: null,
    task_type: 'manual_recommendation',
    status: 'resolved',
    requested_by: 'automation:verification_engine',
    resolved_by: 'mock_admin_01',
    created_at: _daysAgo(0.18),
    updated_at: _daysAgo(0.1),
    resolved_at: _daysAgo(0.1),
    extra_data: {
      recommendation: 'Flag for manual quality review.',
      resolution_outcome: 'resolved',
      resolved_by: 'mock_admin_01',
      resolution_note: 'Confirmed reachable; marked verified_good.',
    },
    phone_number: '+14155550125',
    entity_id:    25,
    entity_type:  'target',
    client_id:    'delta',
  },
  {
    id: 5,
    phone_id: 33,
    source_action_log_id: null,
    task_type: 'approval_required',
    status: 'rejected',
    requested_by: 'mock_operator_02',
    resolved_by: 'mock_admin_01',
    created_at: _daysAgo(0.08),
    updated_at: _daysAgo(0.05),
    resolved_at: _daysAgo(0.05),
    extra_data: {
      requested_action_type: 'action_type_a',
      operator_note: 'One more retry attempt before abandoning.',
      resolution_outcome: 'rejected',
      resolved_by: 'mock_admin_01',
      resolution_note: 'Carrier intercept is permanent; do not retry.',
    },
    phone_number: '+14155550133',
    entity_id:    33,
    entity_type:  'target',
    client_id:    'epsilon',
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
  actionLogs,
  entities = SEED_ENTITIES,
  tasks    = [],
) {
  const clientPhones = phones.filter((p) => {
    // Real-API mode: client_id is embedded directly on the phone (from the JOIN).
    if (p.client_id != null) return String(p.client_id) === String(clientId);
    // Mock mode: resolve via entity lookup.
    const entity = entities.find((e) => e.id === p.entity_id);
    return entity?.client_id === clientId;
  });

  const total     = clientPhones.length;
  const pending   = clientPhones.filter((p) => p.verification_status === 'pending').length;
  const good      = clientPhones.filter((p) => p.verification_status === 'verified_good').length;
  const bad       = clientPhones.filter((p) => p.verification_status === 'verified_bad').length;

  const phoneIds  = new Set(clientPhones.map((p) => p.id));
  const failed    = actionLogs.filter(
    (l) => l.status === 'failed' && phoneIds.has(l.phone_id)
  ).length;

  // Phase DX — open task count for this client (pending + assigned).
  // Each task carries client_id from the backend JOIN so we filter directly
  // without re-resolving through phones/entities — matches the real-mode
  // shape produced by taskAdapter.enrichTask.
  const openTasks = tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'assigned') &&
      String(t.client_id) === String(clientId),
  ).length;

  return { total, pending, good, bad, failed, openTasks };
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
  const entities = structuredClone(SEED_ENTITIES).map((e) => ({
    ...e,
    extra_data: {
      ...(e.extra_data || {}),
      customer_tier: CLIENT_TIER_MAP[e.client_id] ?? null,
    },
  }));

  // Phase DY — inject scoring fields into every phone. Real mode receives
  // these from the backend response (column defaults + scoring service).
  // Mock mode computes a deterministic priority from the row's confidence
  // and the owning entity's tier so the UI's priority sort produces
  // visible, predictable ordering.
  const phones = structuredClone(SEED_PHONES).map((p) => {
    const entity = entities.find((e) => e.id === p.entity_id);
    // For envelopes we walk one hop up to the root for tier; for any
    // entity with no target_entity_id, the entity IS the root.
    const root   = entity?.target_entity_id != null
      ? entities.find((e) => e.id === entity.target_entity_id) || entity
      : entity;
    const tier         = root?.extra_data?.customer_tier ?? null;
    const relationType = entity?.entity_type ?? 'target';
    const confidence   = p.confidence_score ?? _seededConfidence(p.id);
    return {
      ...p,
      // Flat JOIN convenience fields — mock equivalents of the backend's
      // server-side root-entity traversal. Frontend consumers (PhoneRow,
      // PhoneDetailDrawer, ClientCard) read these off the phone row
      // directly without needing to walk the entity graph themselves.
      client_id:             entity?.client_id      ?? null,
      entity_type:           entity?.entity_type    ?? null,
      customer_tier:         tier,
      confidence_score:      confidence,
      confidence_updated_at: p.confidence_updated_at ?? null,
      // Mock priority — mirrors the hybrid formula coefficients from
      // backend modules/mock_scoring.py (α=0.6, β=0.4) for visual parity.
      // Envelope rows get a LOWER relation_weight (0.5 — same as the
      // backend's _MOCK_RELATION_WEIGHTS for social_envelope, see
      // backend/modules/mock_scoring.py) so envelope priorities sit
      // below named-entity priorities all else being equal.
      priority_score:        _mockComputePriority(confidence, relationType, tier),
      priority_updated_at:   p.priority_updated_at ?? _nowIso(),
    };
  });

  return {
    clients:    structuredClone(SEED_CLIENTS),
    entities,
    phones,
    actionLogs: structuredClone(SEED_ACTION_LOGS),
    tasks:      structuredClone(SEED_TASKS),
    engines:    structuredClone(DEFAULT_ENGINE_STATES),
  };
}


// ---------------------------------------------------------------------------
// Phase DY — mock scoring helpers (mirror backend modules/mock_scoring.py).
// Lookup tables here are intentionally a subset of the backend's tables —
// just enough to drive visible mock-mode priority ordering. Internal teams
// running real mode never hit this code path.
// ---------------------------------------------------------------------------

const _MOCK_RELATION_WEIGHTS = {
  target: 1.0, family: 0.7, friend: 0.5, colleague: 0.4,
  // Phase DY-4 — envelope sits below all confirmed relations because
  // it is the algorithm's guess at proximity, not a known link.
  social_envelope: 0.5,
};
const _MOCK_TIER_WEIGHTS     = { 1: 1.0, 2: 0.7, 3: 0.4 };
const _MOCK_ALPHA            = 0.6;
const _MOCK_BETA             = 0.4;
const _MOCK_UNKNOWN_REL      = 0.5;
const _MOCK_UNKNOWN_TIER     = 0.5;

function _mockComputePriority(confidence, relationType, tier) {
  const rel  = relationType != null ? (_MOCK_RELATION_WEIGHTS[relationType] ?? _MOCK_UNKNOWN_REL) : _MOCK_UNKNOWN_REL;
  const tw   = tier != null ? (_MOCK_TIER_WEIGHTS[tier] ?? _MOCK_UNKNOWN_TIER) : _MOCK_UNKNOWN_TIER;
  return Number(confidence) * (_MOCK_ALPHA * rel + _MOCK_BETA * tw);
}

// Deterministic confidence per phone id so the seed produces a stable
// spread across mock loads. Spans 30..95 in 5-point steps cycled mod 14.
function _seededConfidence(phoneId) {
  const STEPS = [85, 70, 60, 90, 45, 95, 30, 80, 55, 65, 75, 40, 50, 35];
  return STEPS[(phoneId - 1) % STEPS.length];
}

function _nowIso() {
  return new Date().toISOString();
}
