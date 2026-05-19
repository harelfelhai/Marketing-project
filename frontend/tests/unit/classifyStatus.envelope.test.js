/**
 * classifyStatus — Phase DY-4 two-axis truth + envelope detection.
 *
 * Pin the contracts that PhoneRow's visual rendering depends on:
 *   isEnvelope            — entity_type === 'social_envelope'
 *   phoneAxisState        — confidence cutoffs that drive the dot colour
 *   identityAxisState     — envelopes always 'pending'; named entities
 *                            map from verification_status.
 */

import { describe, it, expect } from 'vitest';

import {
  isEnvelope,
  phoneAxisState,
  identityAxisState,
} from '../../src/utils/classifyStatus';


describe('isEnvelope', () => {
  it.each([
    ['social_envelope', true],
    ['target',          false],
    ['family',          false],
    ['friend',          false],
    ['colleague',       false],
    [null,              false],
    [undefined,         false],
  ])('entity_type=%s → %s', (input, expected) => {
    expect(isEnvelope(input)).toBe(expected);
  });
});


describe('phoneAxisState', () => {
  it.each([
    [100, 'good'],
    [80,  'good'],
    [79,  'pending'],
    [50,  'pending'],
    [11,  'pending'],
    [10,  'failed'],
    [0,   'failed'],
  ])('confidence=%s → %s', (confidence, expected) => {
    expect(phoneAxisState(confidence)).toBe(expected);
  });

  it('null confidence → pending (not failed; absence ≠ disproof)', () => {
    expect(phoneAxisState(null)).toBe('pending');
    expect(phoneAxisState(undefined)).toBe('pending');
  });
});


describe('identityAxisState', () => {
  it('envelope is always pending regardless of verification_status', () => {
    // Envelope = identity unknown by definition. Even if some other code
    // path set verification_status, the identity axis is the diamond
    // state until promotion.
    expect(identityAxisState('social_envelope', 'verified_good')).toBe('pending');
    expect(identityAxisState('social_envelope', 'verified_bad')).toBe('pending');
    expect(identityAxisState('social_envelope', 'pending')).toBe('pending');
  });

  it.each([
    ['target',    'verified_good', 'good'],
    ['family',    'verified_good', 'good'],
    ['friend',    'verified_bad',  'failed'],
    ['colleague', 'pending',       'pending'],
    ['family',    null,            'pending'],
    [null,        'verified_good', 'good'],
  ])('entity_type=%s status=%s → %s', (entityType, status, expected) => {
    expect(identityAxisState(entityType, status)).toBe(expected);
  });
});
