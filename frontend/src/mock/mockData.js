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
  // ===== Client Alpha — root id 1 + envelope (ids 1-8, 88) =====
  { id: 'ent-1',  entity_type: 'target',          target_entity_id: null, extra_data: { first_name: 'Client Alpha',  region: 'north' } },
  { id: 'ent-2',  entity_type: 'family',          target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 1', region: 'north' } },
  { id: 'ent-3',  entity_type: 'friend',          target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 2', region: 'south' } },
  { id: 'ent-4',  entity_type: 'colleague',       target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 3', region: 'east'  } },
  { id: 'ent-5',  entity_type: 'spouse',          target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 4', region: 'west'  } },
  { id: 'ent-6',  entity_type: 'family',          target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 5', region: 'north' } },
  { id: 'ent-7',  entity_type: 'friend',          target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 6', region: 'south' } },
  { id: 'ent-8',  entity_type: 'colleague',       target_entity_id: 'ent-1',    extra_data: { first_name: 'Alpha Relative 7', region: 'east'  } },
  // ===== Client Beta — root id 9 + envelope (ids 9-16, 91) =====
  { id: 'ent-9',  entity_type: 'target',          target_entity_id: null, extra_data: { first_name: 'Client Beta',   region: 'west'  } },
  { id: 'ent-10', entity_type: 'family',          target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 1',  region: 'north' } },
  { id: 'ent-11', entity_type: 'friend',          target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 2',  region: 'east'  } },
  { id: 'ent-12', entity_type: 'colleague',       target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 3',  region: 'south' } },
  { id: 'ent-13', entity_type: 'spouse',          target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 4',  region: 'north' } },
  { id: 'ent-14', entity_type: 'family',          target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 5',  region: 'west'  } },
  { id: 'ent-15', entity_type: 'friend',          target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 6',  region: 'east'  } },
  { id: 'ent-16', entity_type: 'colleague',       target_entity_id: 'ent-9',    extra_data: { first_name: 'Beta Relative 7',  region: 'south' } },
  // ===== Client Gamma — root id 17 (ids 17-23) =====
  { id: 'ent-17', entity_type: 'target',          target_entity_id: null, extra_data: { first_name: 'Client Gamma',  region: 'north' } },
  { id: 'ent-18', entity_type: 'family',          target_entity_id: 'ent-17',   extra_data: { first_name: 'Gamma Relative 1', region: 'east'  } },
  { id: 'ent-19', entity_type: 'friend',          target_entity_id: 'ent-17',   extra_data: { first_name: 'Gamma Relative 2', region: 'west'  } },
  { id: 'ent-20', entity_type: 'colleague',       target_entity_id: 'ent-17',   extra_data: { first_name: 'Gamma Relative 3', region: 'south' } },
  { id: 'ent-21', entity_type: 'spouse',          target_entity_id: 'ent-17',   extra_data: { first_name: 'Gamma Relative 4', region: 'north' } },
  { id: 'ent-22', entity_type: 'family',          target_entity_id: 'ent-17',   extra_data: { first_name: 'Gamma Relative 5', region: 'east'  } },
  { id: 'ent-23', entity_type: 'friend',          target_entity_id: 'ent-17',   extra_data: { first_name: 'Gamma Relative 6', region: 'west'  } },
  // ===== Client Delta — root id 24 (ids 24-32) =====
  { id: 'ent-24', entity_type: 'target',          target_entity_id: null, extra_data: { first_name: 'Client Delta',  region: 'south' } },
  { id: 'ent-25', entity_type: 'family',          target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 1', region: 'north' } },
  { id: 'ent-26', entity_type: 'friend',          target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 2', region: 'east'  } },
  { id: 'ent-27', entity_type: 'colleague',       target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 3', region: 'west'  } },
  { id: 'ent-28', entity_type: 'spouse',          target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 4', region: 'south' } },
  { id: 'ent-29', entity_type: 'family',          target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 5', region: 'north' } },
  { id: 'ent-30', entity_type: 'friend',          target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 6', region: 'east'  } },
  { id: 'ent-31', entity_type: 'colleague',       target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 7', region: 'west'  } },
  { id: 'ent-32', entity_type: 'spouse',          target_entity_id: 'ent-24',   extra_data: { first_name: 'Delta Relative 8', region: 'south' } },
  // ===== Client Epsilon — root id 33 (ids 33-40) =====
  { id: 'ent-33', entity_type: 'target',          target_entity_id: null, extra_data: { first_name: 'Client Epsilon', region: 'north' } },
  { id: 'ent-34', entity_type: 'family',          target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 1', region: 'east'  } },
  { id: 'ent-35', entity_type: 'friend',          target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 2', region: 'west'  } },
  { id: 'ent-36', entity_type: 'colleague',       target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 3', region: 'south' } },
  { id: 'ent-37', entity_type: 'spouse',          target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 4', region: 'north' } },
  { id: 'ent-38', entity_type: 'family',          target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 5', region: 'east'  } },
  { id: 'ent-39', entity_type: 'friend',          target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 6', region: 'west'  } },
  { id: 'ent-40', entity_type: 'colleague',       target_entity_id: 'ent-33',   extra_data: { first_name: 'Epsilon Relative 7', region: 'south' } },

  // Phase DY-4 — social_envelope entities (Vector B). target_entity_id
  // points at the owning root so the row sits inside that client's
  // queue. Identity unknown at ingest; the operator's audit either
  // confirms placement, identifies the owner, or refutes the surfacing.
  { id: 'ent-88', entity_type: 'social_envelope',
    target_entity_id: 'ent-1',
    extra_data: { envelope_id: 'EP-088', scrape_source: 'social_cluster_alpha' } },
  { id: 'ent-91', entity_type: 'social_envelope',
    target_entity_id: 'ent-9',
    extra_data: { envelope_id: 'EP-091', scrape_source: 'co_occurrence_beta' } },
];

// ---------------------------------------------------------------------------
// Phones — ~40 records with varied statuses and classification types
// ---------------------------------------------------------------------------

export const SEED_PHONES = [
  // --- Alpha phones (entity_ids 1-8) ---
  {
    id: 'ph-1',  entity_id: 'ent-1',  phone_number: '+15550000001',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(10),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Confirmed via operator review',
    verified_at: _daysAgo(8), created_at: _daysAgo(10), updated_at: _daysAgo(8),
    extra_data: { priority: 'high', campaign: 'Q2-2026' },
  },
  {
    id: 'ph-2',  entity_id: 'ent-2',  phone_number: '+15550000002',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(9),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(9), updated_at: _daysAgo(9),
    extra_data: { priority: 'medium', notes: 'Awaiting first contact' },
  },
  {
    id: 'ph-3',  entity_id: 'ent-3',  phone_number: '+15550000003',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(8),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Number disconnected',
    verified_at: _daysAgo(6), created_at: _daysAgo(8), updated_at: _daysAgo(6),
    extra_data: { priority: 'low', notes: 'Disconnected number confirmed' },
  },
  {
    id: 'ph-4',  entity_id: 'ent-4',  phone_number: '+15550000004',
    classification_type: 'type_a', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(7),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(7), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', batch: 'import-2026-05-10' },
  },
  {
    id: 'ph-5',  entity_id: 'ent-5',  phone_number: '+15550000005',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(6),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Verified by senior operator',
    verified_at: _daysAgo(5), created_at: _daysAgo(6), updated_at: _daysAgo(5),
    extra_data: { priority: 'high', partner: 'partner-01' },
  },
  {
    id: 'ph-6',  entity_id: 'ent-6',  phone_number: '+15550000006',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(5),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(5), updated_at: _daysAgo(5),
    extra_data: { priority: 'medium' },
  },
  {
    id: 'ph-7',  entity_id: 'ent-7',  phone_number: '+15550000007',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(4),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Passed automated quality check',
    verified_at: _daysAgo(3), created_at: _daysAgo(4), updated_at: _daysAgo(3),
    extra_data: { priority: 'low', campaign: 'Q2-2026' },
  },
  {
    id: 'ph-8',  entity_id: 'ent-8',  phone_number: '+15550000008',
    classification_type: 'type_a', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(3),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(3), updated_at: _daysAgo(3),
    extra_data: { priority: 'high', batch: 'import-2026-05-14' },
  },
  // --- Beta phones (entity_ids 9-16) ---
  {
    id: 'ph-9',  entity_id: 'ent-9',  phone_number: '+15550000009',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(12),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Operator confirmed contact',
    verified_at: _daysAgo(10), created_at: _daysAgo(12), updated_at: _daysAgo(10),
    extra_data: { priority: 'medium', campaign: 'Q1-2026' },
  },
  {
    id: 'ph-10', entity_id: 'ent-10', phone_number: '+15550000010',
    classification_type: 'type_a', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(11),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(11), updated_at: _daysAgo(11),
    extra_data: { priority: 'high' },
  },
  {
    id: 'ph-11', entity_id: 'ent-11', phone_number: '+15550000011',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(10),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Failed quality threshold',
    verified_at: _daysAgo(8), created_at: _daysAgo(10), updated_at: _daysAgo(8),
    extra_data: { priority: 'low', failure_code: 'QC-403' },
  },
  {
    id: 'ph-12', entity_id: 'ent-12', phone_number: '+15550000012',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(9),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(9), updated_at: _daysAgo(9),
    extra_data: { priority: 'medium', batch: 'import-2026-05-08' },
  },
  {
    id: 'ph-13', entity_id: 'ent-13', phone_number: '+15550000013',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(8),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Verified clean number',
    verified_at: _daysAgo(7), created_at: _daysAgo(8), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', partner: 'partner-02' },
  },
  {
    id: 'ph-14', entity_id: 'ent-14', phone_number: '+15550000014',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(6),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(6), updated_at: _daysAgo(6),
    extra_data: { priority: 'low' },
  },
  {
    id: 'ph-15', entity_id: 'ent-15', phone_number: '+15550000015',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(4),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Automated pass — score 0.92',
    verified_at: _daysAgo(3), created_at: _daysAgo(4), updated_at: _daysAgo(3),
    extra_data: { priority: 'medium', campaign: 'Q2-2026', score: 0.92 },
  },
  {
    id: 'ph-16', entity_id: 'ent-16', phone_number: '+15550000016',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(2),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(2), updated_at: _daysAgo(2),
    extra_data: { priority: 'medium', batch: 'import-2026-05-15' },
  },
  // --- Gamma phones (entity_ids 17-23) ---
  {
    id: 'ph-17', entity_id: 'ent-17', phone_number: '+15550000017',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(14),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Confirmed by team lead',
    verified_at: _daysAgo(12), created_at: _daysAgo(14), updated_at: _daysAgo(12),
    extra_data: { priority: 'high', campaign: 'Q1-2026' },
  },
  {
    id: 'ph-18', entity_id: 'ent-18', phone_number: '+15550000018',
    classification_type: 'type_a', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(13),
    verification_status: 'verified_bad', verification_source: 'manual',
    verification_reason: 'Invalid number format',
    verified_at: _daysAgo(11), created_at: _daysAgo(13), updated_at: _daysAgo(11),
    extra_data: { priority: 'low', failure_reason: 'invalid_format' },
  },
  {
    id: 'ph-19', entity_id: 'ent-19', phone_number: '+15550000019',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(11),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(11), updated_at: _daysAgo(11),
    extra_data: { priority: 'medium' },
  },
  {
    id: 'ph-20', entity_id: 'ent-20', phone_number: '+15550000020',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(9),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'High confidence score',
    verified_at: _daysAgo(8), created_at: _daysAgo(9), updated_at: _daysAgo(8),
    extra_data: { priority: 'high', score: 0.97, batch: 'import-2026-05-08' },
  },
  {
    id: 'ph-21', entity_id: 'ent-21', phone_number: '+15550000021',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(7),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(7), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', partner: 'partner-03' },
  },
  {
    id: 'ph-22', entity_id: 'ent-22', phone_number: '+15550000022',
    classification_type: 'type_c', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(5),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(5), updated_at: _daysAgo(5),
    extra_data: { priority: 'low' },
  },
  {
    id: 'ph-23', entity_id: 'ent-23', phone_number: '+15550000023',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(3),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Manual review passed',
    verified_at: _daysAgo(2), created_at: _daysAgo(3), updated_at: _daysAgo(2),
    extra_data: { priority: 'medium', campaign: 'Q2-2026' },
  },
  // --- Delta phones (entity_ids 24-32) ---
  {
    id: 'ph-24', entity_id: 'ent-24', phone_number: '+15550000024',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(15),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Cleared by auditor',
    verified_at: _daysAgo(13), created_at: _daysAgo(15), updated_at: _daysAgo(13),
    extra_data: { priority: 'high', campaign: 'Q1-2026' },
  },
  {
    id: 'ph-25', entity_id: 'ent-25', phone_number: '+15550000025',
    classification_type: 'type_a', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(14),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(14), updated_at: _daysAgo(14),
    extra_data: { priority: 'medium', batch: 'import-2026-05-03' },
  },
  {
    id: 'ph-26', entity_id: 'ent-26', phone_number: '+15550000026',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(12),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Number on suppression list',
    verified_at: _daysAgo(10), created_at: _daysAgo(12), updated_at: _daysAgo(10),
    extra_data: { priority: 'low', suppression_code: 'SUP-007' },
  },
  {
    id: 'ph-27', entity_id: 'ent-27', phone_number: '+15550000027',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(10),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(10), updated_at: _daysAgo(10),
    extra_data: { priority: 'medium' },
  },
  {
    id: 'ph-28', entity_id: 'ent-28', phone_number: '+15550000028',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(8),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Passed manual spot check',
    verified_at: _daysAgo(7), created_at: _daysAgo(8), updated_at: _daysAgo(7),
    extra_data: { priority: 'high', batch: 'import-2026-05-09' },
  },
  {
    id: 'ph-29', entity_id: 'ent-29', phone_number: '+15550000029',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(6),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(6), updated_at: _daysAgo(6),
    extra_data: { priority: 'low', partner: 'partner-01' },
  },
  {
    id: 'ph-30', entity_id: 'ent-30', phone_number: '+15550000030',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(4),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(4), updated_at: _daysAgo(4),
    extra_data: { priority: 'medium' },
  },
  {
    id: 'ph-31', entity_id: 'ent-31', phone_number: '+15550000031',
    classification_type: 'type_c', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(2),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Auto-cleared score 0.89',
    verified_at: _daysAgo(1), created_at: _daysAgo(2), updated_at: _daysAgo(1),
    extra_data: { priority: 'high', campaign: 'Q2-2026', score: 0.89 },
  },
  {
    id: 'ph-32', entity_id: 'ent-32', phone_number: '+15550000032',
    classification_type: 'type_d', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(1),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(1), updated_at: _daysAgo(1),
    extra_data: { priority: 'low', batch: 'import-2026-05-16' },
  },
  // --- Epsilon phones (entity_ids 33-40) ---
  {
    id: 'ph-33', entity_id: 'ent-33', phone_number: '+15550000033',
    classification_type: 'type_a', ingestion_source: 'api',
    ingestion_reason: 'campaign_signup', ingested_at: _daysAgo(16),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Cleared by compliance team',
    verified_at: _daysAgo(14), created_at: _daysAgo(16), updated_at: _daysAgo(14),
    extra_data: { priority: 'high', campaign: 'Q1-2026' },
  },
  {
    id: 'ph-34', entity_id: 'ent-34', phone_number: '+15550000034',
    classification_type: 'type_b', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(15),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(15), updated_at: _daysAgo(15),
    extra_data: { priority: 'medium' },
  },
  {
    id: 'ph-35', entity_id: 'ent-35', phone_number: '+15550000035',
    classification_type: 'type_c', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(13),
    verification_status: 'verified_bad', verification_source: 'automated',
    verification_reason: 'Score below minimum threshold',
    verified_at: _daysAgo(11), created_at: _daysAgo(13), updated_at: _daysAgo(11),
    extra_data: { priority: 'low', score: 0.31, batch: 'import-2026-05-04' },
  },
  {
    id: 'ph-36', entity_id: 'ent-36', phone_number: '+15550000036',
    classification_type: 'type_d', ingestion_source: 'api',
    ingestion_reason: 'referral', ingested_at: _daysAgo(11),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(11), updated_at: _daysAgo(11),
    extra_data: { priority: 'high' },
  },
  {
    id: 'ph-37', entity_id: 'ent-37', phone_number: '+15550000037',
    classification_type: 'type_a', ingestion_source: 'manual',
    ingestion_reason: 'direct_entry', ingested_at: _daysAgo(9),
    verification_status: 'verified_good', verification_source: 'manual',
    verification_reason: 'Direct verification call made',
    verified_at: _daysAgo(8), created_at: _daysAgo(9), updated_at: _daysAgo(8),
    extra_data: { priority: 'medium' },
  },
  {
    id: 'ph-38', entity_id: 'ent-38', phone_number: '+15550000038',
    classification_type: 'type_b', ingestion_source: 'api',
    ingestion_reason: 'partner_feed', ingested_at: _daysAgo(7),
    verification_status: 'pending', verification_source: null,
    verification_reason: null, verified_at: null,
    created_at: _daysAgo(7), updated_at: _daysAgo(7),
    extra_data: { priority: 'low', partner: 'partner-02' },
  },
  {
    id: 'ph-39', entity_id: 'ent-39', phone_number: '+15550000039',
    classification_type: 'type_c', ingestion_source: 'import',
    ingestion_reason: 'bulk_import', ingested_at: _daysAgo(5),
    verification_status: 'verified_good', verification_source: 'automated',
    verification_reason: 'Batch auto-cleared',
    verified_at: _daysAgo(4), created_at: _daysAgo(5), updated_at: _daysAgo(4),
    extra_data: { priority: 'high', score: 0.94, batch: 'import-2026-05-12' },
  },
  {
    id: 'ph-40', entity_id: 'ent-40', phone_number: '+15550000040',
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
  //
  // Domain invariant: every phone carries a classification_type (the
  // source / algorithm is proprietary, out of scope for the open repo).
  // We pick generic CLASSIFICATION_TYPES tokens to honour the invariant.

  // EP-088 — raw envelope, untouched. Demonstrates "📡 ◌ 🔍 ◇".
  {
    id: 'ph-88', entity_id: 'ent-88', phone_number: '+15559000088',
    classification_type: 'type_b', ingestion_source: 'automated',
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
    id: 'ph-91', entity_id: 'ent-91', phone_number: '+15559000091',
    classification_type: 'type_a', ingestion_source: 'automated',
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
    id: 'log-1',  phone_id: 'ph-1',  action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(10), executed_at: _daysAgo(10),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01', result: 'delivered' },
  },
  // Phone 2 — pending, action queued
  {
    id: 'log-2',  phone_id: 'ph-2',  action_type: 'outreach_b', status: 'scheduled_retry',
    requested_at: _daysAgo(9), executed_at: null,
    retry_count: 1, retry_after: _daysAgo(-1),
    extra_data: { operator_id: 'mock_operator_01', error_detail: 'Temporary timeout on first attempt' },
  },
  // Phone 3 — failed
  {
    id: 'log-3',  phone_id: 'ph-3',  action_type: 'outreach_a', status: 'failed',
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
    id: 'log-4',  phone_id: 'ph-4',  action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(7), executed_at: _daysAgo(7),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 5 — two logs: first failed, retry succeeded
  {
    id: 'log-5',  phone_id: 'ph-5',  action_type: 'outreach_b', status: 'failed',
    requested_at: _daysAgo(6), executed_at: _daysAgo(6),
    retry_count: 1, retry_after: null,
    extra_data: {
      operator_id: 'mock_operator_01',
      error_detail: 'Connection refused',
      stack_trace: 'ConnectionError: refused\n  at handler.execute (dispatcher.py:77)',
    },
  },
  {
    id: 'log-6',  phone_id: 'ph-5',  action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(5), executed_at: _daysAgo(5),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 7 — sent
  {
    id: 'log-7',  phone_id: 'ph-7',  action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(4), executed_at: _daysAgo(4),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 9 — Beta, sent
  {
    id: 'log-8',  phone_id: 'ph-9',  action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(12), executed_at: _daysAgo(12),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 10 — Beta, failed
  {
    id: 'log-9',  phone_id: 'ph-10', action_type: 'outreach_a', status: 'failed',
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
    id: 'log-10', phone_id: 'ph-11', action_type: 'outreach_b', status: 'failed',
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
    id: 'log-11', phone_id: 'ph-13', action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(8), executed_at: _daysAgo(8),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 15 — Beta, sent
  {
    id: 'log-12', phone_id: 'ph-15', action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(4), executed_at: _daysAgo(4),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 17 — Gamma, sent
  {
    id: 'log-13', phone_id: 'ph-17', action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(14), executed_at: _daysAgo(14),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 19 — Gamma, scheduled_retry
  {
    id: 'log-14', phone_id: 'ph-19', action_type: 'outreach_c', status: 'scheduled_retry',
    requested_at: _daysAgo(11), executed_at: null,
    retry_count: 2, retry_after: _daysAgo(-2),
    extra_data: { operator_id: 'mock_operator_01', error_detail: 'Rate limit hit — backing off' },
  },
  // Phone 20 — Gamma, sent
  {
    id: 'log-15', phone_id: 'ph-20', action_type: 'outreach_a', status: 'sent',
    requested_at: _daysAgo(9), executed_at: _daysAgo(9),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 24 — Delta, sent
  {
    id: 'log-16', phone_id: 'ph-24', action_type: 'outreach_d', status: 'sent',
    requested_at: _daysAgo(15), executed_at: _daysAgo(15),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 26 — Delta, failed
  {
    id: 'log-17', phone_id: 'ph-26', action_type: 'outreach_a', status: 'failed',
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
    id: 'log-18', phone_id: 'ph-28', action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(8), executed_at: _daysAgo(8),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 31 — Delta, sent
  {
    id: 'log-19', phone_id: 'ph-31', action_type: 'outreach_c', status: 'sent',
    requested_at: _daysAgo(2), executed_at: _daysAgo(2),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 33 — Epsilon, sent
  {
    id: 'log-20', phone_id: 'ph-33', action_type: 'outreach_d', status: 'sent',
    requested_at: _daysAgo(16), executed_at: _daysAgo(16),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 35 — Epsilon, failed
  {
    id: 'log-21', phone_id: 'ph-35', action_type: 'outreach_a', status: 'failed',
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
    id: 'log-22', phone_id: 'ph-37', action_type: 'outreach_b', status: 'sent',
    requested_at: _daysAgo(9), executed_at: _daysAgo(9),
    retry_count: 0, retry_after: null,
    extra_data: { operator_id: 'mock_operator_01' },
  },
  // Phone 39 — Epsilon, sent
  {
    id: 'log-23', phone_id: 'ph-39', action_type: 'outreach_c', status: 'sent',
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
    phone_id: 'ph-2',
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
    entity_id:    'ent-2',
    entity_type:  'family',
    client_id:    'ent-1',
  },
  {
    id: 'task-2',
    phone_id: 'ph-9',
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
    entity_id:    'ent-9',
    entity_type:  'target',
    client_id:    'ent-9',
  },
  {
    id: 'task-3',
    phone_id: 'ph-17',
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
    entity_id:    'ent-17',
    entity_type:  'target',
    client_id:    'ent-17',
  },
  {
    id: 'task-4',
    phone_id: 'ph-25',
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
    entity_id:    'ent-25',
    entity_type:  'family',
    client_id:    'ent-24',
  },
  {
    id: 'task-5',
    phone_id: 'ph-33',
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
    entity_id:    'ent-33',
    entity_type:  'target',
    client_id:    'ent-33',
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
    // Mock mode: resolve via entity lookup. client_id is derived
    // (target_entity_id ?? id) in case raw SEED_ENTITIES are passed.
    const entity = entities.find((e) => e.id === p.entity_id);
    if (!entity) return false;
    const eClientId = entity.client_id ?? entity.target_entity_id ?? entity.id;
    return String(eClientId) === String(clientId);
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
  applies_on_restart: true,
};


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
