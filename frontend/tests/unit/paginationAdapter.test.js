/**
 * paginationAdapter — envelope stripper for list endpoints.
 *
 * Backbone of every /phones, /actions/logs, /tasks GET list call.
 * Verifies the contract: out comes `items` + a camelCase `meta` block;
 * malformed responses raise ApiShapeError.
 */

import { describe, it, expect } from 'vitest';

import {
  unwrapPage,
  ApiShapeError,
} from '../../src/api/adapters/paginationAdapter';


describe('unwrapPage', () => {
  it('returns items + meta on a well-formed envelope', () => {
    const response = {
      items: [{ id: 1 }, { id: 2 }],
      total: 47,
      page: 3,
      page_size: 20,
    };
    const { items, meta } = unwrapPage(response);
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(meta).toEqual({ total: 47, page: 3, pageSize: 20 });
  });

  it('camelCases page_size → pageSize at the boundary', () => {
    const { meta } = unwrapPage({ items: [], total: 0, page: 1, page_size: 500 });
    expect(meta.pageSize).toBe(500);
    expect(meta).not.toHaveProperty('page_size');
  });

  it('defaults missing meta fields gracefully', () => {
    const { meta } = unwrapPage({ items: [{}, {}, {}] });
    expect(meta).toEqual({ total: 0, page: 1, pageSize: 3 });
  });

  it.each([
    ['null response',       null],
    ['undefined response',  undefined],
    ['empty object',        {}],
    ['items not an array',  { items: 'not-an-array' }],
    ['items is null',       { items: null }],
    ['items missing',       { total: 0, page: 1 }],
  ])('throws ApiShapeError when %s', (_label, bad) => {
    expect(() => unwrapPage(bad)).toThrow(ApiShapeError);
  });

  it('ApiShapeError has the named class identity (catchable)', () => {
    try {
      unwrapPage(null);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiShapeError);
      expect(e.name).toBe('ApiShapeError');
    }
  });
});
