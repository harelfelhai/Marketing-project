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
