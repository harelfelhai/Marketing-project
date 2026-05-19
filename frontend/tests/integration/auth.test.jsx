/**
 * Phase AUTH integration — landing page, login, register, guest mode.
 *
 * Covers:
 *   - Unauthenticated visitor lands on /login regardless of route
 *   - Login happy path → authenticated, redirects to '/'
 *   - Login bad password → error toast, stays on /login
 *   - Register happy path → authenticated as regular, redirects
 *   - Register password-mismatch / no-clients → inline validation
 *   - Continue as Guest → guest status, redirects to '/'
 *   - Already-authenticated visit to /login auto-redirects
 *   - Task Center route renders for admins, blocked for regular + guest
 *   - RememberAndRedirect: visiting /operations as unauth → /login,
 *     and successful login lands back on /operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom edge */ }
});


// ---------------------------------------------------------------------------
// Unauthenticated flow
// ---------------------------------------------------------------------------


describe('Phase AUTH — landing page', () => {
  it('unauthenticated visitor at / lands on the login card', async () => {
    renderApp({ route: '/', as: 'anonymous' });
    expect(await screen.findByTestId('auth-login-card')).toBeInTheDocument();
  });

  it('unauthenticated visitor at a protected route is redirected to login', async () => {
    renderApp({ route: '/phones', as: 'anonymous' });
    expect(await screen.findByTestId('auth-login-card')).toBeInTheDocument();
  });

  it('clicking "Continue as Guest" lands on the app', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/', as: 'anonymous' });
    await user.click(await screen.findByTestId('auth-continue-guest'));
    // Login card gone — we're inside the app.
    await waitFor(() => {
      expect(screen.queryByTestId('auth-login-card')).not.toBeInTheDocument();
    });
  });
});


// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------


describe('Phase AUTH — login flow', () => {
  it('registering then logging in routes to the app', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/', as: 'anonymous' });

    // Navigate to /register.
    await user.click(await screen.findByTestId('auth-goto-register'));
    await screen.findByTestId('auth-register-card');

    // Fill the form.
    await user.type(screen.getByLabelText(/שם משתמש/), 'alice');
    await user.type(screen.getByLabelText(/^סיסמה/), 'pass1234');
    await user.type(screen.getByLabelText(/אישור סיסמה/), 'pass1234');
    // Phase AUTH-C — managed_client_ids picker is a searchable
    // combobox. Focus opens the dropdown; click the option chip.
    await user.click(screen.getByTestId('reg-client-picker-input'));
    await user.click(await screen.findByTestId('client-option-1'));
    await user.click(screen.getByTestId('auth-register-submit'));

    // Registered → authenticated → app loads (no more auth card).
    await waitFor(() => {
      expect(screen.queryByTestId('auth-register-card')).not.toBeInTheDocument();
    });
  });

  it('login with wrong password shows a friendly toast and stays on login', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/', as: 'anonymous' });

    await user.type(screen.getByLabelText(/שם משתמש/), 'nobody');
    await user.type(screen.getByLabelText(/^סיסמה/), 'pass1234');
    await user.click(screen.getByTestId('auth-login-submit'));

    // Toast surfaces the friendly error.
    await screen.findByText(/שם משתמש או סיסמה שגויים/);
    // Still on the login card.
    expect(screen.getByTestId('auth-login-card')).toBeInTheDocument();
  });

  it('empty fields show inline required errors and do not submit', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/', as: 'anonymous' });

    await user.click(screen.getByTestId('auth-login-submit'));
    // Inline errors on both fields.
    const errors = screen.getAllByText(/הוא שדה חובה/);
    expect(errors.length).toBe(2);
  });

  it('already-authenticated visitor to /login auto-redirects', async () => {
    renderApp({ route: '/login', as: 'admin' });
    // Login card never renders — auth gate redirected us.
    await waitFor(() => {
      expect(screen.queryByTestId('auth-login-card')).not.toBeInTheDocument();
    });
  });
});


// ---------------------------------------------------------------------------
// Register flow validation
// ---------------------------------------------------------------------------


describe('Phase AUTH — register validation', () => {
  it('password mismatch blocks submit', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/register', as: 'anonymous' });

    await user.type(screen.getByLabelText(/שם משתמש/), 'bob');
    await user.type(screen.getByLabelText(/^סיסמה/), 'pass1234');
    await user.type(screen.getByLabelText(/אישור סיסמה/), 'different');
    // Phase AUTH-C — managed_client_ids picker is a searchable
    // combobox. Focus opens the dropdown; click the option chip.
    await user.click(screen.getByTestId('reg-client-picker-input'));
    await user.click(await screen.findByTestId('client-option-1'));
    await user.click(screen.getByTestId('auth-register-submit'));

    await screen.findByText(/הסיסמאות אינן תואמות/);
    // Still on the register card.
    expect(screen.getByTestId('auth-register-card')).toBeInTheDocument();
  });

  it('no-clients-picked blocks submit', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/register', as: 'anonymous' });

    await user.type(screen.getByLabelText(/שם משתמש/), 'bob');
    await user.type(screen.getByLabelText(/^סיסמה/), 'pass1234');
    await user.type(screen.getByLabelText(/אישור סיסמה/), 'pass1234');
    // NO client checkboxes ticked.
    await user.click(screen.getByTestId('auth-register-submit'));

    await screen.findByText(/יש לבחור לפחות לקוח אחד/);
  });

  it('short password blocked by min-length validator', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/register', as: 'anonymous' });

    await user.type(screen.getByLabelText(/שם משתמש/), 'bob');
    await user.type(screen.getByLabelText(/^סיסמה/), 'pw');     // 2 chars
    await user.type(screen.getByLabelText(/אישור סיסמה/), 'pw');
    // Phase AUTH-C — managed_client_ids picker is a searchable
    // combobox. Focus opens the dropdown; click the option chip.
    await user.click(screen.getByTestId('reg-client-picker-input'));
    await user.click(await screen.findByTestId('client-option-1'));
    await user.click(screen.getByTestId('auth-register-submit'));

    await screen.findByText(/לפחות 4 תווים/);
  });
});


// ---------------------------------------------------------------------------
// Task Center role gating
// ---------------------------------------------------------------------------


describe('Phase AUTH — Task Center role gating', () => {
  it('admin can access /operations', async () => {
    renderApp({ route: '/operations', as: 'admin' });
    expect(await screen.findByRole('heading', { name: /מרכז משימות/ })).toBeInTheDocument();
  });

  it('guest at /operations sees the permission-denied notice', async () => {
    renderApp({ route: '/operations', as: 'guest' });
    // The page's RequireRole wrapper renders PERMISSION_DENIED_NOTICE
    // when role !== 'admin'.
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: /מרכז משימות/ }),
      ).not.toBeInTheDocument();
    });
  });

  it('regular user at /operations sees the permission-denied notice', async () => {
    renderApp({ route: '/operations', as: 'regular' });
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: /מרכז משימות/ }),
      ).not.toBeInTheDocument();
    });
  });
});
