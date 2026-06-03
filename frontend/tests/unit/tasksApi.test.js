/**
 * tasksApi — Phase DX Operations Task Queue client.
 *
 * Mock-mode covers the in-memory mockDb path. Real-mode is exercised via
 * the integration suite (DX-T3) because it needs axios + a stubbed HTTP
 * server; unit tests here would just be re-asserting axios mock behavior.
 *
 * The mockDb shape we hand in mirrors the actual MockDataContext value,
 * but reduced to the fields each function reads/writes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  listTasks,
  getTaskDetail,
  openTask,
  resolveTask,
} from '../../src/api/tasksApi';


function makeMockDb(initialTasks = []) {
  // Minimal mockDb stand-in — only the slots tasksApi touches in mock mode.
  return {
    tasks: [...initialTasks],
    phones: [
      { id: 1, entity_id: 1, phone_number: '+15551111111' },
      { id: 2, entity_id: 2, phone_number: '+15552222222' },
    ],
    entities: [
      { id: 1, entity_type: 'target', root_entity_id: 1 },
      { id: 2, entity_type: 'target', root_entity_id: 2 },
    ],
    applyOpenTask: vi.fn(function (payload) {
      const nextId = Math.max(0, ...this.tasks.map((t) => t.id)) + 1;
      const now = new Date().toISOString();
      const phone  = this.phones.find((p) => p.id === payload.phone_id);
      const entity = phone ? this.entities.find((e) => e.id === phone.entity_id) : null;
      this.tasks.push({
        id: nextId,
        phone_id: payload.phone_id,
        task_type: payload.task_type,
        status: 'pending',
        requested_by: payload.requested_by,
        resolved_by: null,
        source_action_log_id: payload.source_action_log_id ?? null,
        extra_data: payload.extra_data ?? null,
        created_at: now,
        updated_at: now,
        resolved_at: null,
        phone_number: phone?.phone_number ?? null,
        entity_id:    phone?.entity_id    ?? null,
        entity_type:  entity?.entity_type ?? null,
        root_entity_id:    entity?.root_entity_id   ?? null,
      });
    }),
    applyResolveTask: vi.fn(function (id, body) {
      const t = this.tasks.find((t) => t.id === id);
      if (!t) return;
      t.status      = body.outcome;
      t.resolved_by = body.operator_id;
      t.resolved_at = new Date().toISOString();
      t.extra_data  = {
        ...(t.extra_data || {}),
        resolution_outcome: body.outcome,
        resolved_by:        body.operator_id,
        ...(body.resolution_note ? { resolution_note: body.resolution_note } : {}),
      };
    }),
  };
}


// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe('listTasks (mock mode)', () => {
  let db;
  beforeEach(() => {
    db = makeMockDb([
      { id: 1, status: 'pending',  task_type: 'remediation_failure', phone_id: 1, root_entity_id: 1, created_at: '2026-05-01T00:00:00Z' },
      { id: 2, status: 'resolved', task_type: 'approval_required',   phone_id: 1, root_entity_id: 1, created_at: '2026-05-02T00:00:00Z' },
      { id: 3, status: 'rejected', task_type: 'approval_required',   phone_id: 2, root_entity_id: 2, created_at: '2026-05-03T00:00:00Z' },
    ]);
  });

  it('returns all tasks with no filters', async () => {
    const result = await listTasks({}, db);
    expect(result).toHaveLength(3);
  });

  it('filters by status', async () => {
    const result = await listTasks({ status: 'pending' }, db);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('filters by taskType', async () => {
    const result = await listTasks({ taskType: 'approval_required' }, db);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id).sort()).toEqual([2, 3]);
  });

  it('filters by phoneId', async () => {
    const result = await listTasks({ phoneId: 2 }, db);
    expect(result).toHaveLength(1);
    expect(result[0].phone_id).toBe(2);
  });

  it('orders most-recent-first', async () => {
    const result = await listTasks({}, db);
    expect(result.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it('enriches every row with client_name (adapter ran)', async () => {
    const result = await listTasks({}, db);
    result.forEach((t) => expect(t).toHaveProperty('client_name'));
  });
});


// ---------------------------------------------------------------------------
// getTaskDetail
// ---------------------------------------------------------------------------

describe('getTaskDetail (mock mode)', () => {
  it('returns the enriched task by id', async () => {
    const db = makeMockDb([
      { id: 42, root_entity_id: 1, status: 'pending', task_type: 'approval_required' },
    ]);
    const result = await getTaskDetail(42, db);
    expect(result.id).toBe(42);
    expect(result).toHaveProperty('client_name');
  });

  it('throws when id is not found', async () => {
    const db = makeMockDb([]);
    await expect(getTaskDetail(999, db)).rejects.toThrow(/not found/);
  });
});


// ---------------------------------------------------------------------------
// openTask
// ---------------------------------------------------------------------------

describe('openTask (mock mode)', () => {
  it('calls applyOpenTask and returns the new (enriched) task', async () => {
    const db = makeMockDb([]);
    const result = await openTask(
      {
        phone_id: 1,
        task_type: 'approval_required',
        requested_by: 'mock_operator_02',
        extra_data: { note: 'hi' },
      },
      db,
    );
    expect(db.applyOpenTask).toHaveBeenCalledOnce();
    expect(result.id).toBe(1);
    expect(result.task_type).toBe('approval_required');
    expect(result.status).toBe('pending');
    expect(result.requested_by).toBe('mock_operator_02');
    expect(result.extra_data).toEqual({ note: 'hi' });
    // Adapter ran:
    expect(result).toHaveProperty('client_name');
  });

  it('synthesises JOIN convenience fields from the local phones cache', async () => {
    const db = makeMockDb([]);
    const result = await openTask(
      { phone_id: 2, task_type: 'remediation_failure', requested_by: 'op' },
      db,
    );
    expect(result.phone_number).toBe('+15552222222');
    expect(result.entity_id).toBe(2);
    expect(result.entity_type).toBe('target');
    expect(result.root_entity_id).toBe(2);
  });
});


// ---------------------------------------------------------------------------
// resolveTask
// ---------------------------------------------------------------------------

describe('resolveTask (mock mode)', () => {
  it('writes terminal state and merges resolution_note into extra_data', async () => {
    const db = makeMockDb([
      { id: 5, status: 'pending', extra_data: { failure_category: 'timeout' } },
    ]);
    const result = await resolveTask(
      5,
      { operator_id: 'mock_admin_01', outcome: 'resolved', resolution_note: 'fixed' },
      db,
    );
    expect(result.status).toBe('resolved');
    expect(result.resolved_by).toBe('mock_admin_01');
    expect(result.resolved_at).toBeTruthy();
    // Merge — not replace:
    expect(result.extra_data.failure_category).toBe('timeout');
    expect(result.extra_data.resolution_outcome).toBe('resolved');
    expect(result.extra_data.resolution_note).toBe('fixed');
  });

  it.each(['resolved', 'rejected'])('accepts outcome=%s', async (outcome) => {
    const db = makeMockDb([{ id: 1, status: 'pending', extra_data: {} }]);
    const result = await resolveTask(1, { operator_id: 'op', outcome }, db);
    expect(result.status).toBe(outcome);
  });

  it('omits resolution_note from extra_data when not provided', async () => {
    const db = makeMockDb([{ id: 1, status: 'pending', extra_data: {} }]);
    const result = await resolveTask(1, { operator_id: 'op', outcome: 'rejected' }, db);
    expect('resolution_note' in result.extra_data).toBe(false);
  });
});
