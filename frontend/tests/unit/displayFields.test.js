/**
 * displayFields — the configurable-columns resolver.
 *
 * resolveVisibleColumns is the single seam every surface uses to decide which
 * columns to render, so its selection/default/drift semantics are pinned here.
 */

import { describe, it, expect } from 'vitest';
import {
  DISPLAY_SURFACES, defaultFieldKeys, resolveVisibleColumns,
} from '../../src/config/displayFields';


describe('defaultFieldKeys', () => {
  it('returns the catalog default keys in order', () => {
    const keys = defaultFieldKeys('entities');
    expect(keys[0]).toBe('id');
    expect(keys).toContain('client');
    expect(keys.length).toBe(DISPLAY_SURFACES.entities.columns.length);
  });

  it('is empty for an unknown surface', () => {
    expect(defaultFieldKeys('nope')).toEqual([]);
  });
});


describe('resolveVisibleColumns', () => {
  it('falls back to defaults when no selection is stored', () => {
    const cols = resolveVisibleColumns('entities', {});
    expect(cols.map((c) => c.key)).toEqual(defaultFieldKeys('entities'));
  });

  it('falls back to defaults when display_fields is null/undefined', () => {
    expect(resolveVisibleColumns('entities', null).length).toBeGreaterThan(0);
    expect(resolveVisibleColumns('entities', undefined).length).toBeGreaterThan(0);
  });

  it('honours a stored selection and its order', () => {
    const cols = resolveVisibleColumns('entities', { entities: ['name', 'id'] });
    expect(cols.map((c) => c.key)).toEqual(['name', 'id']);
  });

  it('drops stored keys the catalog no longer knows (graceful drift)', () => {
    const cols = resolveVisibleColumns('entities', { entities: ['name', 'ghost', 'id'] });
    expect(cols.map((c) => c.key)).toEqual(['name', 'id']);
  });

  it('falls back to defaults when the stored selection filters to nothing', () => {
    const cols = resolveVisibleColumns('entities', { entities: ['ghost-only'] });
    expect(cols.map((c) => c.key)).toEqual(defaultFieldKeys('entities'));
  });

  it('every resolved column carries a label', () => {
    for (const c of resolveVisibleColumns('entities', {})) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});
