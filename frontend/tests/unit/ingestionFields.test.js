/**
 * ingestionFields — admin-defined dynamic ingestion field resolver + the
 * extra_data collector used by the add-person / add-number forms.
 */

import { describe, it, expect } from 'vitest';
import { resolveIngestionFields, buildExtraData } from '../../src/config/ingestionFields';


describe('resolveIngestionFields', () => {
  it('returns [] for an unknown / empty surface', () => {
    expect(resolveIngestionFields('entity', null)).toEqual([]);
    expect(resolveIngestionFields('entity', {})).toEqual([]);
    expect(resolveIngestionFields('entity', { entity: 'nope' })).toEqual([]);
  });

  it('drops entries without a key and defaults label/widget', () => {
    const out = resolveIngestionFields('phone', {
      phone: [{ key: 'carrier' }, { label: 'no key' }, 'garbage'],
    });
    expect(out).toEqual([{ key: 'carrier', label: 'carrier', widget: 'text', options: [] }]);
  });

  it('keeps select widgets + well-formed options', () => {
    const [d] = resolveIngestionFields('entity', {
      entity: [{
        key: 'tier', label: 'דרגה', widget: 'select',
        options: [{ value: 'gold', label: 'זהב' }, { bad: 'x' }],
      }],
    });
    expect(d.widget).toBe('select');
    expect(d.options).toEqual([{ value: 'gold', label: 'זהב' }]);
  });
});


describe('buildExtraData', () => {
  const descriptors = [
    { key: 'region', widget: 'text' },
    { key: 'tier',   widget: 'select' },
  ];

  it('returns undefined when nothing is filled (caller omits extra_data)', () => {
    expect(buildExtraData(descriptors, {})).toBeUndefined();
    expect(buildExtraData(descriptors, { region: '' })).toBeUndefined();
  });

  it('collects only filled values keyed by the extra_data key', () => {
    expect(buildExtraData(descriptors, { region: 'north', tier: '' }))
      .toEqual({ region: 'north' });
    expect(buildExtraData(descriptors, { region: 'north', tier: 'gold' }))
      .toEqual({ region: 'north', tier: 'gold' });
  });
});
