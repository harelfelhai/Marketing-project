/**
 * customFilters — the admin-defined filter resolver, param builder, and the
 * client-side matcher (mirrors backend services/generic_filters.py).
 *
 * These three functions are the single seam every surface uses for custom
 * filters, so their normalization / build / match semantics are pinned here.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCustomFilters, buildCustomFilterParam, rowMatchesCustom,
} from '../../src/config/customFilters';


describe('resolveCustomFilters', () => {
  it('returns [] for an unknown / empty surface', () => {
    expect(resolveCustomFilters('phones', null)).toEqual([]);
    expect(resolveCustomFilters('phones', {})).toEqual([]);
    expect(resolveCustomFilters('phones', { phones: 'nope' })).toEqual([]);
  });

  it('drops entries missing key or field', () => {
    const out = resolveCustomFilters('phones', {
      phones: [
        { key: 'ok', field: 'extra_data.region' },
        { key: 'no-field' },
        { field: 'no-key' },
        'garbage',
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].field).toBe('extra_data.region');
  });

  it('defaults label to key and widget to text', () => {
    const [d] = resolveCustomFilters('phones', {
      phones: [{ key: 'region', field: 'extra_data.region' }],
    });
    expect(d.label).toBe('region');
    expect(d.widget).toBe('text');
    expect(d.options).toEqual([]);
  });

  it('keeps select widgets and well-formed options', () => {
    const [d] = resolveCustomFilters('phones', {
      phones: [{
        key: 'tier', label: 'דרגה', field: 'extra_data.tier', widget: 'select',
        options: [{ value: 'gold', label: 'זהב' }, { bad: 'drop me' }],
      }],
    });
    expect(d.widget).toBe('select');
    expect(d.options).toEqual([{ value: 'gold', label: 'זהב' }]);
  });
});


describe('buildCustomFilterParam', () => {
  const descriptors = [
    { key: 'region', field: 'extra_data.region', widget: 'text' },
    { key: 'tier',   field: 'extra_data.tier',   widget: 'select' },
  ];

  it('skips blank values', () => {
    expect(buildCustomFilterParam(descriptors, {})).toEqual({});
    expect(buildCustomFilterParam(descriptors, { region: '' })).toEqual({});
  });

  it('text → contains, select → equality, keyed by backend field', () => {
    const out = buildCustomFilterParam(descriptors, { region: 'north', tier: 'gold' });
    expect(out).toEqual({
      'extra_data.region': { contains: 'north' },
      'extra_data.tier': 'gold',
    });
  });
});


describe('rowMatchesCustom', () => {
  const descriptors = [
    { key: 'region', field: 'extra_data.region', widget: 'text' },
    { key: 'tier',   field: 'extra_data.tier',   widget: 'select' },
    { key: 'ptype',  field: 'phone_type',        widget: 'select' },
  ];

  it('matches everything when no values set', () => {
    expect(rowMatchesCustom({ extra_data: {} }, descriptors, {})).toBe(true);
  });

  it('text widget does case-insensitive substring on extra_data', () => {
    const row = { extra_data: { region: 'North-District' } };
    expect(rowMatchesCustom(row, descriptors, { region: 'north' })).toBe(true);
    expect(rowMatchesCustom(row, descriptors, { region: 'south' })).toBe(false);
  });

  it('select widget does string equality', () => {
    const row = { extra_data: { tier: 'gold' } };
    expect(rowMatchesCustom(row, descriptors, { tier: 'gold' })).toBe(true);
    expect(rowMatchesCustom(row, descriptors, { tier: 'silver' })).toBe(false);
  });

  it('reads plain columns too, not just extra_data', () => {
    const row = { phone_type: 'mobile', extra_data: {} };
    expect(rowMatchesCustom(row, descriptors, { ptype: 'mobile' })).toBe(true);
    expect(rowMatchesCustom(row, descriptors, { ptype: 'landline' })).toBe(false);
  });

  it('missing key / null bucket never matches a set value', () => {
    expect(rowMatchesCustom({ extra_data: {} }, descriptors, { region: 'north' })).toBe(false);
    expect(rowMatchesCustom({ extra_data: null }, descriptors, { region: 'north' })).toBe(false);
    expect(rowMatchesCustom({}, descriptors, { region: 'north' })).toBe(false);
  });

  it('ANDs multiple active filters', () => {
    const row = { extra_data: { region: 'north', tier: 'gold' } };
    expect(rowMatchesCustom(row, descriptors, { region: 'north', tier: 'gold' })).toBe(true);
    expect(rowMatchesCustom(row, descriptors, { region: 'north', tier: 'silver' })).toBe(false);
  });
});
