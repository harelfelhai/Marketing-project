/**
 * renderApp — shared test helper.
 *
 * Mounts the full app under MemoryRouter at the requested initial route,
 * wrapped in the three production context providers in the same order
 * as main.jsx (Phase AUTH order: MockData → Auth → UI).
 *
 * AUTH PRE-SEEDING
 * ----------------
 * Pass `as: 'admin' | 'regular' | 'guest' | 'anonymous'` (default
 * 'admin') to control the AuthProvider's initial state. Existing
 * tests that depend on the pre-AUTH behavior (admin everywhere)
 * get it for free since 'admin' is the default.
 *
 * MemoryRouter (not BrowserRouter) keeps each test hermetic — no
 * DOM history sharing across tests.
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';

import App from '../../src/App';
import { AuthProvider } from '../../src/contexts/MockAuthContext';
import { MockDataProvider } from '../../src/contexts/MockDataContext';
import { UIProvider }       from '../../src/contexts/UIContext';


function _initialAuthState(as) {
  if (as === 'guest')         return { status: 'guest',           user: null };
  if (as === 'anonymous')     return { status: 'unauthenticated', user: null };
  if (as === 'regular') {
    return {
      status: 'authenticated',
      user: {
        id: 1, username: 'test_regular', role: 'regular',
        managed_client_ids: [1, 2],
        display_name: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    };
  }
  // Default — pre-AUTH behavior: 'admin' so existing tests keep
  // hitting Task Center surfaces without per-test setup.
  return {
    status: 'authenticated',
    user: {
      id: 1, username: 'test_admin', role: 'admin',
      managed_client_ids: [],
      display_name: null,
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}


export function renderApp({ route = '/', as = 'admin' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <MockDataProvider>
        <AuthProvider initialState={_initialAuthState(as)}>
          <UIProvider>
            <App />
          </UIProvider>
        </AuthProvider>
      </MockDataProvider>
    </MemoryRouter>,
  );
}
