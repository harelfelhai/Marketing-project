/**
 * paginationAdapter — strips the {items, total, page, page_size} envelope
 * returned by every list endpoint into a flat items array + meta object.
 *
 * All list endpoints in the backend return this same envelope shape, so a
 * single adapter function covers all of them. Components never see the raw
 * paginated response — they receive the unwrapped items array.
 */

export class ApiShapeError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'ApiShapeError';
  }
}

/**
 * Unwrap a paginated backend response.
 *
 * @param {object} response - Raw response body from the backend.
 * @returns {{ items: any[], meta: { total: number, page: number, pageSize: number } }}
 * @throws {ApiShapeError} If `items` is absent or not an array.
 */
export function unwrapPage(response) {
  if (!response || !Array.isArray(response.items)) {
    throw new ApiShapeError(
      `Expected paginated envelope with 'items' array; received: ${JSON.stringify(response)}`
    );
  }
  return {
    items: response.items,
    meta: {
      total:    response.total    ?? 0,
      page:     response.page     ?? 1,
      pageSize: response.page_size ?? response.items.length,
    },
  };
}
