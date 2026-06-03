/**
 * taskAdapter — boundary enrichment for PipelineTaskResponse rows.
 *
 * Verifies:
 *   - enrichTask attaches client_name from clientRegistry by integer root_entity_id.
 *   - enrichTaskList runs enrichment over every item, including null-safety.
 *   - Unknown root_entity_id values fall back to the registry's default mapping.
 *   - Null/undefined task input does not throw (defensive shape from JSON).
 */

import { describe, it, expect } from 'vitest';

import { enrichTask, enrichTaskList } from '../../src/api/adapters/taskAdapter';
import { getClientName } from '../../src/config/clientRegistry';


describe('enrichTask', () => {
  it('attaches client_name resolved from clientRegistry', () => {
    const task = {
      id: 1, phone_id: 2, task_type: 'approval_required',
      status: 'pending', requested_by: 'op', root_entity_id: 1,
    };
    const enriched = enrichTask(task);
    expect(enriched.client_name).toBe(getClientName(1));
    // Every other field is preserved verbatim.
    expect(enriched.id).toBe(1);
    expect(enriched.phone_id).toBe(2);
    expect(enriched.task_type).toBe('approval_required');
  });

  it('does not mutate the input task', () => {
    const task = { id: 1, root_entity_id: 2 };
    const enriched = enrichTask(task);
    expect('client_name' in task).toBe(false);
    expect(enriched).not.toBe(task);
  });

  it('returns null/undefined unchanged (defensive)', () => {
    expect(enrichTask(null)).toBeNull();
    expect(enrichTask(undefined)).toBeUndefined();
  });

  it('falls back to the registry default for unknown root_entity_id', () => {
    const enriched = enrichTask({ id: 99, root_entity_id: 9999 });
    // getClientName returns a fallback string for unknown ids — assert it
    // matches whatever clientRegistry produces, not a hardcoded value.
    expect(enriched.client_name).toBe(getClientName(9999));
  });

  it('handles null root_entity_id without throwing', () => {
    const enriched = enrichTask({ id: 5, root_entity_id: null });
    expect(enriched.client_name).toBe(getClientName(null));
  });
});


describe('enrichTaskList', () => {
  it('enriches each item in the list', () => {
    const items = [
      { id: 1, root_entity_id: 1 },
      { id: 2, root_entity_id: 2 },
      { id: 3, root_entity_id: 3 },
    ];
    const enriched = enrichTaskList(items);
    expect(enriched).toHaveLength(3);
    enriched.forEach((t, i) => {
      expect(t.client_name).toBe(getClientName(items[i].root_entity_id));
    });
  });

  it('returns [] for null/undefined input', () => {
    expect(enrichTaskList(null)).toEqual([]);
    expect(enrichTaskList(undefined)).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(enrichTaskList([])).toEqual([]);
  });
});
