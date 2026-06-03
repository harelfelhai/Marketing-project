/**
 * RequireRole — auth-gate primitive (Phase AUTH activates the swap).
 *
 * The gate now reads from a real-ish AuthContext (the file is still
 * named MockAuthContext for minimal-churn migration). Tests pre-seed
 * an authenticated admin via the `initialState` prop on AuthProvider
 * so the gate has a known role to compare against.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import RequireRole from '../../src/components/primitives/RequireRole';
import { AuthProvider } from '../../src/contexts/MockAuthContext';
import { MockDataProvider } from '../../src/contexts/MockDataContext';


function renderAsAdmin(ui) {
  // Pre-seed an authenticated admin via initialState so the gate has
  // a deterministic operatorRole. MockDataProvider is required because
  // AuthProvider consumes useMockData() for mock-mode parity.
  const adminState = {
    status: 'authenticated',
    user: {
      id: 1, username: 'test_admin', role: 'admin',
      managed_client_ids: [], display_name: null,
      created_at: '2026-01-01T00:00:00Z',
    },
  };
  return render(
    <MockDataProvider>
      <AuthProvider initialState={adminState}>{ui}</AuthProvider>
    </MockDataProvider>,
  );
}


describe('RequireRole', () => {
  it('renders children when the operator role matches', () => {
    renderAsAdmin(
      <RequireRole role="admin">
        <span data-testid="gated">visible</span>
      </RequireRole>,
    );
    expect(screen.getByTestId('gated')).toBeInTheDocument();
  });

  it('renders nothing (default null) when the role does not match', () => {
    renderAsAdmin(
      <RequireRole role="superadmin">
        <span data-testid="gated">should-not-render</span>
      </RequireRole>,
    );
    expect(screen.queryByTestId('gated')).not.toBeInTheDocument();
  });

  it('renders fallback element when the role does not match', () => {
    renderAsAdmin(
      <RequireRole role="superadmin" fallback={<span data-testid="fallback">nope</span>}>
        <span data-testid="gated">should-not-render</span>
      </RequireRole>,
    );
    expect(screen.queryByTestId('gated')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });
});
