/**
 * renderApp — shared test helper for integration tests (DX-T3).
 *
 * Mounts the full app under MemoryRouter at the requested initial route,
 * wrapped in the three production context providers (MockAuth, MockData,
 * UI) in the same order as main.jsx.
 *
 * MemoryRouter (not BrowserRouter) keeps each test hermetic — no DOM
 * history sharing across tests.
 *
 * Returns the result of @testing-library/react's render() plus a handle
 * to interact with the navigation history if needed.
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';

import App from '../../src/App';
import { MockAuthProvider } from '../../src/contexts/MockAuthContext';
import { MockDataProvider } from '../../src/contexts/MockDataContext';
import { UIProvider }       from '../../src/contexts/UIContext';

export function renderApp({ route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <MockAuthProvider>
        <MockDataProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </MockDataProvider>
      </MockAuthProvider>
    </MemoryRouter>,
  );
}
