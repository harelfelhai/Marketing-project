/**
 * PhoneTable.applyFilters — sort + filter matrix for the phone grid (DY-3).
 *
 * Pins the priority-default sort, the ingested_at fallback, and the
 * NULLS-LAST + id-DESC tiebreaker semantics that match the backend
 * ORDER BY. Filter semantics are already exercised by integration
 * tests; this file focuses on the sort behavior introduced by DY-3.
 */

import { describe, it, expect } from 'vitest';

import { applyFilters } from '../../src/components/phones/PhoneTable';


function makeRow(phone) {
  return {
    phone,
    entity: { id: phone.entity_id, entity_type: 'target', client_id: 'alpha' },
    client: { id: 'alpha', name: 'Client Alpha' },
    logs:   [],
  };
}

const PHONES = [
  { id: 10, entity_id: 1, phone_number: '+1-aaa', ingested_at: '2026-05-01',
    classification_type: 'type_a', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: 80 },
  { id: 20, entity_id: 1, phone_number: '+1-bbb', ingested_at: '2026-05-02',
    classification_type: 'type_b', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: 25 },
  { id: 30, entity_id: 1, phone_number: '+1-ccc', ingested_at: '2026-05-03',
    classification_type: 'type_c', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: 55 },
  { id: 40, entity_id: 1, phone_number: '+1-ddd', ingested_at: '2026-05-04',
    classification_type: 'type_d', verification_status: 'pending',
    ingestion_source: 'manual', priority_score: null },
];

const ENTITIES = [{ id: 1, entity_type: 'target', client_id: 'alpha' }];
const CLIENTS  = [{ id: 'alpha', name: 'Client Alpha' }];
const LOGS     = [];

const NO_FILTERS = {
  clientId:           '',
  verificationStatus: '',
  ingestionSource:    '',
  classificationType: '',
  search:             '',
  sortBy:             'priority',
};


describe('applyFilters — Phase DY sortBy', () => {
  it('defaults to priority DESC with NULLS LAST', () => {
    const rows = applyFilters(PHONES, ENTITIES, CLIENTS, LOGS, NO_FILTERS);
    expect(rows.map((r) => r.phone.id)).toEqual([10, 30, 20, 40]);
  });

  it('explicit sortBy=priority matches default', () => {
    const rows = applyFilters(PHONES, ENTITIES, CLIENTS, LOGS,
                              { ...NO_FILTERS, sortBy: 'priority' });
    expect(rows.map((r) => r.phone.id)).toEqual([10, 30, 20, 40]);
  });

  it('sortBy=ingested_at orders by ingested_at DESC', () => {
    const rows = applyFilters(PHONES, ENTITIES, CLIENTS, LOGS,
                              { ...NO_FILTERS, sortBy: 'ingested_at' });
    // Newest first: May 4 → May 1.
    expect(rows.map((r) => r.phone.id)).toEqual([40, 30, 20, 10]);
  });

  it('priority tiebreaker uses id DESC', () => {
    const tied = [
      { ...PHONES[0], id: 100, priority_score: 50 },
      { ...PHONES[1], id: 200, priority_score: 50 },
      { ...PHONES[2], id: 150, priority_score: 50 },
    ];
    const rows = applyFilters(tied, ENTITIES, CLIENTS, LOGS, NO_FILTERS);
    expect(rows.map((r) => r.phone.id)).toEqual([200, 150, 100]);
  });

  it('missing sortBy falls back to priority', () => {
    const rows = applyFilters(PHONES, ENTITIES, CLIENTS, LOGS,
                              { ...NO_FILTERS, sortBy: undefined });
    // Same as default (priority DESC NULLS LAST).
    expect(rows.map((r) => r.phone.id)).toEqual([10, 30, 20, 40]);
  });

  it('filters + sort compose correctly', () => {
    // Filter to verification_status=pending (all four match) then
    // ingested_at sort. Filtering should run FIRST, then sort applies.
    const rows = applyFilters(PHONES, ENTITIES, CLIENTS, LOGS, {
      ...NO_FILTERS,
      verificationStatus: 'pending',
      sortBy: 'ingested_at',
    });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.phone.id)).toEqual([40, 30, 20, 10]);
  });
});


describe('applyFilters — clientId string/number coercion', () => {
  // UAT regression: the filter dropdown's e.target.value is always a
  // string, but real-mode entity.client_id is an integer. applyFilters
  // must compare both sides as strings or the table goes empty.
  const NUM_ENTITIES = [
    { id: 1, entity_type: 'target', client_id: 1 },
    { id: 2, entity_type: 'target', client_id: 2 },
  ];
  const NUM_CLIENTS = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const NUM_PHONES  = [
    { id: 100, entity_id: 1, phone_number: '+a', ingested_at: '2026-05-01',
      verification_status: 'pending', priority_score: 10 },
    { id: 200, entity_id: 2, phone_number: '+b', ingested_at: '2026-05-02',
      verification_status: 'pending', priority_score: 20 },
  ];

  it('string filter value matches integer client_id (dropdown emits string)', () => {
    const rows = applyFilters(NUM_PHONES, NUM_ENTITIES, NUM_CLIENTS, [],
                              { ...NO_FILTERS, clientId: '1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].phone.id).toBe(100);
  });

  it('integer filter value matches integer client_id (cross-link case)', () => {
    const rows = applyFilters(NUM_PHONES, NUM_ENTITIES, NUM_CLIENTS, [],
                              { ...NO_FILTERS, clientId: 1 });
    expect(rows).toHaveLength(1);
  });
});


describe('applyFilters — Phase AUTH-C clientIds personalization', () => {
  const MIXED_ENTITIES = [
    { id: 1, entity_type: 'target', client_id: 1 },
    { id: 2, entity_type: 'target', client_id: 2 },
    { id: 3, entity_type: 'target', client_id: 3 },
  ];
  const MIXED_CLIENTS = [
    { id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' },
  ];
  const MIXED_PHONES = [
    { id: 100, entity_id: 1, phone_number: '+a', ingested_at: '2026-05-01',
      verification_status: 'pending', priority_score: 10 },
    { id: 200, entity_id: 2, phone_number: '+b', ingested_at: '2026-05-02',
      verification_status: 'pending', priority_score: 20 },
    { id: 300, entity_id: 3, phone_number: '+c', ingested_at: '2026-05-03',
      verification_status: 'pending', priority_score: 30 },
  ];

  it('omits clientIds → no narrowing applied', () => {
    const rows = applyFilters(MIXED_PHONES, MIXED_ENTITIES, MIXED_CLIENTS, [], NO_FILTERS);
    expect(rows.map((r) => r.phone.id).sort()).toEqual([100, 200, 300]);
  });

  it('clientIds=[1,3] narrows to entities owned by those clients', () => {
    const rows = applyFilters(MIXED_PHONES, MIXED_ENTITIES, MIXED_CLIENTS, [],
                              { ...NO_FILTERS, clientIds: [1, 3] });
    expect(rows.map((r) => r.phone.id).sort()).toEqual([100, 300]);
  });

  it('empty clientIds array is treated as no filter (toggle off)', () => {
    const rows = applyFilters(MIXED_PHONES, MIXED_ENTITIES, MIXED_CLIENTS, [],
                              { ...NO_FILTERS, clientIds: [] });
    expect(rows).toHaveLength(3);
  });

  it('clientIds compose with other filters via AND', () => {
    const onePending = [
      ...MIXED_PHONES.slice(0, 2),
      { ...MIXED_PHONES[2], verification_status: 'verified' },
    ];
    const rows = applyFilters(onePending, MIXED_ENTITIES, MIXED_CLIENTS, [], {
      ...NO_FILTERS,
      clientIds: [1, 3],
      verificationStatus: 'pending',
    });
    // id=300 is now 'verified', so only id=100 (client 1, pending) survives.
    expect(rows.map((r) => r.phone.id)).toEqual([100]);
  });
});
