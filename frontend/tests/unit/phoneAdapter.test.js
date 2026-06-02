/**
 * phoneAdapter — pre-Phase-DX adapter; covered here for symmetry with
 * taskAdapter and because nothing else in the test suite currently
 * exercises enrichPhoneDetail.
 */

import { describe, it, expect } from 'vitest';

import { enrichPhone, enrichPhoneDetail } from '../../src/api/adapters/phoneAdapter';
import { getClientName } from '../../src/config/clientRegistry';


describe('enrichPhone', () => {
  it('attaches client_name to a PhoneSummary', () => {
    const phone = { id: 1, root_entity_id: 2, phone_number: '+1-x' };
    const result = enrichPhone(phone);
    expect(result.client_name).toBe(getClientName(2));
    expect(result.phone_number).toBe('+1-x');
  });

  it('does not mutate the input', () => {
    const phone = { id: 1, root_entity_id: 1 };
    enrichPhone(phone);
    expect('client_name' in phone).toBe(false);
  });
});


describe('enrichPhoneDetail', () => {
  it('attaches client_name to the nested entity block', () => {
    const detail = {
      id: 1,
      phone_number: '+1-x',
      entity: { id: 5, entity_type: 'target', root_entity_id: 3 },
      action_timeline: [],
    };
    const result = enrichPhoneDetail(detail);
    expect(result.entity.client_name).toBe(getClientName(3));
    // Top-level shape is preserved (timeline still there).
    expect(result.action_timeline).toEqual([]);
  });

  it('returns null/undefined unchanged', () => {
    expect(enrichPhoneDetail(null)).toBeNull();
    expect(enrichPhoneDetail(undefined)).toBeUndefined();
  });

  it('passes through a detail with no nested entity (defensive)', () => {
    const detail = { id: 1, phone_number: '+1-x' };
    const result = enrichPhoneDetail(detail);
    expect(result.entity).toBeUndefined();
  });
});
