/**
 * phonesApi — Phase DY mock-mode behaviour (sort, JOIN flattening).
 *
 * Real-mode HTTP paths are exercised by the backend pytest suite. These
 * tests pin the mock-mode invariants that the integration suite assumes
 * (priority-default ordering with id tiebreaker; customer_tier flattened
 * onto each row from the owning entity).
 */

import { describe, it, expect } from 'vitest';

import { listPhones, getPhoneDetail } from '../../src/api/phonesApi';


function makeMockDb(phones, entities = []) {
  return {
    phones,
    entities,
    clients:    [{ id: 'alpha', name: 'Client Alpha' }],
    actionLogs: [],
  };
}

const ENTITIES = [
  { id: 1, entity_type: 'target', root_entity_id: 'alpha',
    extra_data: { customer_tier: 1 } },
  { id: 2, entity_type: 'target', root_entity_id: 'alpha',
    extra_data: { customer_tier: 3 } },
  { id: 3, entity_type: 'target', root_entity_id: 'alpha',
    extra_data: { customer_tier: 2 } },
  { id: 4, entity_type: 'target', root_entity_id: 'alpha',
    extra_data: {} },                         // missing tier
];

const PHONES = [
  { id: 10, entity_id: 1, phone_number: '+1-aaa', ingested_at: '2026-05-01',
    classification_type: 'type_a', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: 80, confidence_score: 80 },
  { id: 20, entity_id: 2, phone_number: '+1-bbb', ingested_at: '2026-05-02',
    classification_type: 'type_b', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: 25, confidence_score: 50 },
  { id: 30, entity_id: 3, phone_number: '+1-ccc', ingested_at: '2026-05-03',
    classification_type: 'type_c', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: 55, confidence_score: 70 },
  { id: 40, entity_id: 4, phone_number: '+1-ddd', ingested_at: '2026-05-04',
    classification_type: 'type_d', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: null, confidence_score: 60 },
];


describe('listPhones — Phase DY sort_by', () => {
  it('defaults to priority DESC with NULLS LAST', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    const rows = await listPhones({}, db);
    // Expected order: 10 (priority 80), 30 (55), 20 (25), 40 (null).
    expect(rows.map((p) => p.id)).toEqual([10, 30, 20, 40]);
  });

  it('explicit sortBy=priority matches default', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    const rows = await listPhones({ sortBy: 'priority' }, db);
    expect(rows.map((p) => p.id)).toEqual([10, 30, 20, 40]);
  });

  it('sortBy=ingested_at orders by timestamp DESC', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    const rows = await listPhones({ sortBy: 'ingested_at' }, db);
    // 40 (May 4), 30 (May 3), 20 (May 2), 10 (May 1).
    expect(rows.map((p) => p.id)).toEqual([40, 30, 20, 10]);
  });

  it('priority tiebreaker uses id DESC', async () => {
    const tied = [
      { ...PHONES[0], id: 100, priority_score: 50 },
      { ...PHONES[1], id: 200, priority_score: 50, entity_id: 2 },
      { ...PHONES[2], id: 150, priority_score: 50, entity_id: 3 },
    ];
    const db = makeMockDb(tied, ENTITIES);
    const rows = await listPhones({}, db);
    expect(rows.map((p) => p.id)).toEqual([200, 150, 100]);
  });
});


describe('listPhones — customer_tier flattened from owning entity', () => {
  it('every row carries the tier extracted from its entity', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    const rows = await listPhones({}, db);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[10].customer_tier).toBe(1);  // entity 1
    expect(byId[20].customer_tier).toBe(3);  // entity 2
    expect(byId[30].customer_tier).toBe(2);  // entity 3
    expect(byId[40].customer_tier).toBeNull(); // entity 4 — no tier key
  });
});


describe('getPhoneDetail — Phase DY enrichment', () => {
  it('flattens customer_tier onto the top-level detail object', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    const detail = await getPhoneDetail(10, db);
    expect(detail.customer_tier).toBe(1);
    expect(detail.entity.client_name).toBe('Client Alpha');
  });

  it('null customer_tier when entity has no tier hint', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    const detail = await getPhoneDetail(40, db);
    expect(detail.customer_tier).toBeNull();
  });

  it('throws for unknown phone id', async () => {
    const db = makeMockDb(PHONES, ENTITIES);
    await expect(getPhoneDetail(9999, db)).rejects.toThrow(/not found/);
  });
});
