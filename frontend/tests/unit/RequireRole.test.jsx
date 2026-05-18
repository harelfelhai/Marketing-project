/**
 * RequireRole — auth-gate primitive (the Phase G swap point).
 *
 * Today the mock auth context always returns operatorRole='admin', but
 * the component still has to honour the gate when given a non-matching
 * role token — that's the contract Phase G will swap into.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import RequireRole from '../../src/components/primitives/RequireRole';
import {
  MockAuthProvider,
} from '../../src/contexts/MockAuthContext';


function renderWithAuth(ui) {
  return render(<MockAuthProvider>{ui}</MockAuthProvider>);
}


describe('RequireRole', () => {
  it('renders children when the operator role matches', () => {
    renderWithAuth(
      <RequireRole role="admin">
        <span data-testid="gated">visible</span>
      </RequireRole>,
    );
    expect(screen.getByTestId('gated')).toBeInTheDocument();
  });

  it('renders nothing (default null) when the role does not match', () => {
    renderWithAuth(
      <RequireRole role="superadmin">
        <span data-testid="gated">should-not-render</span>
      </RequireRole>,
    );
    expect(screen.queryByTestId('gated')).not.toBeInTheDocument();
  });

  it('renders fallback element when the role does not match', () => {
    renderWithAuth(
      <RequireRole role="superadmin" fallback={<span data-testid="fallback">nope</span>}>
        <span data-testid="gated">should-not-render</span>
      </RequireRole>,
    );
    expect(screen.queryByTestId('gated')).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });
});
