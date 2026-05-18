/**
 * classifyStatus — Phase DY score classification helpers.
 *
 * Pin the cutoff vocabulary so visual treatments stay stable when the
 * scoring strategy evolves. These helpers are direction-only — they map
 * a numeric score onto the existing Badge variant taxonomy.
 */

import { describe, it, expect } from 'vitest';

import {
  priorityVariant,
  confidenceVariant,
  tierVariant,
} from '../../src/utils/classifyStatus';


describe('priorityVariant', () => {
  it.each([
    [100, 'good'],
    [80,  'good'],
    [60,  'good'],
    [59,  'pending'],
    [45,  'pending'],
    [30,  'pending'],
    [29,  'failed'],
    [0,   'failed'],
  ])('priority=%s → %s', (score, expected) => {
    expect(priorityVariant(score)).toBe(expected);
  });

  it.each([
    [null,      'gray'],
    [undefined, 'gray'],
    [NaN,       'gray'],
  ])('missing/NaN priority=%s → gray', (score, expected) => {
    expect(priorityVariant(score)).toBe(expected);
  });
});


describe('confidenceVariant', () => {
  it.each([
    [100, 'good'],
    [75,  'good'],
    [60,  'pending'],
    [40,  'pending'],
    [39,  'failed'],
    [0,   'failed'],
  ])('confidence=%s → %s', (score, expected) => {
    expect(confidenceVariant(score)).toBe(expected);
  });

  it('null → gray', () => {
    expect(confidenceVariant(null)).toBe('gray');
  });
});


describe('tierVariant', () => {
  it.each([
    [1, 'good'],
    [2, 'pending'],
    [3, 'info'],
    [4, 'info'],   // unknown tiers fall through to neutral 'info'
  ])('tier=%s → %s', (tier, expected) => {
    expect(tierVariant(tier)).toBe(expected);
  });

  it('null → gray', () => {
    expect(tierVariant(null)).toBe('gray');
  });
});
