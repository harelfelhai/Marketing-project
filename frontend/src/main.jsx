/**
 * main.jsx — React 18 entry point.
 *
 * Mounts the app, wraps the tree in <BrowserRouter>, and stacks the three
 * global context providers:
 *
 *   1. MockDataProvider   — in-memory db (no provider deps).
 *                            Outermost since AuthProvider consumes
 *                            useMockData() for mock-mode parity, so
 *                            it must nest INSIDE MockDataProvider.
 *   2. AuthProvider       — Phase AUTH identity + session state.
 *   3. UIProvider         — modal / toast / filter state.
 *
 * Note: AuthProvider is still exported under the legacy name
 * `MockAuthProvider` from contexts/MockAuthContext.jsx so unaffected
 * import sites don't churn during the Phase AUTH migration.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './contexts/MockAuthContext';
import { MockDataProvider } from './contexts/MockDataContext';
import { UIProvider } from './contexts/UIContext';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <MockDataProvider>
        <AuthProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </AuthProvider>
      </MockDataProvider>
    </BrowserRouter>
  </React.StrictMode>
);
