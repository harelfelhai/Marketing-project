/**
 * TaskTable.applyFilters — combinatorial filter matrix.
 *
 * This is the highest-value unit test in the DX-T2 batch because
 * applyFilters has the most filter combinations and was the source of
 * two of the three regressions caught in the smoke test:
 *   - clientId comparison string-coercion edge case (fixed in §5.1 pattern)
 *   - openOnly was missing entirely (added in da2ae37)
 */

import { describe, it, expect } from 'vitest';

import { applyFilters } from '../../src/components/ops/TaskTable';


function fixtures() {
  return [
    { id: 1, status: 'pending',  task_type: 'remediation_failure',
      phone_id: 10, client_id: 1, phone_number: '+1-aaa',
      requested_by: 'automation:retry_engine', resolved_by: null,
      client_name: 'Client Alpha' },
    { id: 2, status: 'assigned', task_type: 'remediation_failure',
      phone_id: 20, client_id: 2, phone_number: '+1-bbb',
      requested_by: 'automation:retry_engine', resolved_by: null,
      client_name: 'Client Beta' },
    { id: 3, status: 'pending',  task_type: 'approval_required',
      phone_id: 30, client_id: 1, phone_number: '+1-ccc',
      requested_by: 'mock_operator_02', resolved_by: null,
      client_name: 'Client Alpha' },
    { id: 4, status: 'resolved', task_type: 'manual_recommendation',
      phone_id: 10, client_id: 1, phone_number: '+1-aaa',
      requested_by: 'automation:verification_engine', resolved_by: 'mock_admin_01',
      client_name: 'Client Alpha' },
    { id: 5, status: 'rejected', task_type: 'approval_required',
      phone_id: 40, client_id: 3, phone_number: '+1-ddd',
      requested_by: 'mock_operator_02', resolved_by: 'mock_admin_01',
      client_name: 'Client Gamma' },
  ];
}

const ALL_DEFAULT = {
  status: '', taskType: '', search: '',
  phoneId: null, clientId: null, openOnly: false,
};


describe('applyFilters — no filters', () => {
  it('returns every task when all filters default', () => {
    expect(applyFilters(fixtures(), ALL_DEFAULT)).toHaveLength(5);
  });
});


describe('applyFilters — status', () => {
  it.each([
    ['pending',   [1, 3]],
    ['assigned',  [2]],
    ['resolved',  [4]],
    ['rejected',  [5]],
  ])('status=%s → ids %j', (status, expected) => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, status });
    expect(result.map((t) => t.id).sort()).toEqual(expected);
  });
});


describe('applyFilters — taskType', () => {
  it.each([
    ['remediation_failure',   [1, 2]],
    ['approval_required',     [3, 5]],
    ['manual_recommendation', [4]],
  ])('taskType=%s → ids %j', (taskType, expected) => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, taskType });
    expect(result.map((t) => t.id).sort()).toEqual(expected);
  });
});


describe('applyFilters — phoneId', () => {
  it('integer match', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, phoneId: 10 });
    expect(result.map((t) => t.id).sort()).toEqual([1, 4]);
  });

  it('string param from URL is coerced via String(...) === String(...)', () => {
    // This is the §5.1 regression class: URL params are strings.
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, phoneId: '10' });
    expect(result.map((t) => t.id).sort()).toEqual([1, 4]);
  });

  it('phoneId=null disables the filter', () => {
    expect(applyFilters(fixtures(), { ...ALL_DEFAULT, phoneId: null })).toHaveLength(5);
  });
});


describe('applyFilters — clientId', () => {
  it('filters by integer client_id', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, clientId: 1 });
    expect(result.map((t) => t.id).sort()).toEqual([1, 3, 4]);
  });

  it('string coercion (URL param case)', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, clientId: '3' });
    expect(result.map((t) => t.id)).toEqual([5]);
  });
});


describe('applyFilters — openOnly (the smoke-test bug)', () => {
  it('restricts to pending + assigned (the open-task vocabulary)', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, openOnly: true });
    expect(result.map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });

  it('openOnly=false is a no-op', () => {
    expect(applyFilters(fixtures(), { ...ALL_DEFAULT, openOnly: false })).toHaveLength(5);
  });
});


describe('applyFilters — search (client-side substring)', () => {
  it('matches phone_number', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, search: 'bbb' });
    expect(result.map((t) => t.id)).toEqual([2]);
  });

  it('matches client_name', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, search: 'Gamma' });
    expect(result.map((t) => t.id)).toEqual([5]);
  });

  it('matches requested_by', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, search: 'retry_engine' });
    expect(result.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it('matches resolved_by', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, search: 'mock_admin' });
    expect(result.map((t) => t.id).sort()).toEqual([4, 5]);
  });

  it('case-insensitive', () => {
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, search: 'ALPHA' });
    expect(result.map((t) => t.id).sort()).toEqual([1, 3, 4]);
  });

  it('matches stringified client_id', () => {
    // The hay-stack includes `String(client_id)` so numeric search works.
    const result = applyFilters(fixtures(), { ...ALL_DEFAULT, search: '3' });
    expect(result.map((t) => t.id)).toEqual([5]);
  });

  it('returns empty when no match', () => {
    expect(applyFilters(fixtures(), { ...ALL_DEFAULT, search: 'nonexistent_xyz' })).toEqual([]);
  });
});


describe('applyFilters — combinatorial (all filters together)', () => {
  it('AND-composes every active filter', () => {
    // pending + remediation + client 1 → expect only task #1.
    const result = applyFilters(fixtures(), {
      ...ALL_DEFAULT,
      status:   'pending',
      taskType: 'remediation_failure',
      clientId: 1,
    });
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it('openOnly + clientId narrows to that client pending+assigned', () => {
    // ClientCard cross-link case: ?client_id=1&open=true → ids 1, 3.
    const result = applyFilters(fixtures(), {
      ...ALL_DEFAULT,
      clientId: 1,
      openOnly: true,
    });
    expect(result.map((t) => t.id).sort()).toEqual([1, 3]);
  });

  it('phoneId + openOnly (PhoneDetailDrawer cross-link case)', () => {
    // ?phone_id=10 alone → ids 1, 4.
    // With openOnly added → just id 1.
    const result = applyFilters(fixtures(), {
      ...ALL_DEFAULT,
      phoneId:  10,
      openOnly: true,
    });
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it('returns empty when filters contradict', () => {
    const result = applyFilters(fixtures(), {
      ...ALL_DEFAULT,
      status:   'resolved',  // task 4 only
      clientId: 3,           // task 5 only — disjoint
    });
    expect(result).toEqual([]);
  });
});
