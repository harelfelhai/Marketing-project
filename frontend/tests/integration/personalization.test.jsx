/**
 * Phase AUTH-C — global personalization toggle integration tests.
 *
 * Covers:
 *   - Toggle is visible only for authenticated users with managed clients
 *     (hidden for guest, hidden for admins without managed clients)
 *   - Toggling narrows the Client Hub grid (visible card count changes)
 *   - localStorage persistence is written on toggle
 *
 * Note on filter granularity: the applyFilters unit tests assert the
 * actual narrowing logic (PhoneTable/TaskTable) deterministically.
 * This file focuses on the UX wiring — that the header chip drives
 * a visible state change on screen.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom edge */ }
});


describe('Phase AUTH-C — toggle visibility', () => {
  it('hides the toggle in guest mode', async () => {
    renderApp({ route: '/', as: 'guest' });
    // Wait for the operator chip area (guest badge) to render.
    await screen.findByTestId('auth-guest-badge');
    expect(screen.queryByTestId('personalization-toggle')).not.toBeInTheDocument();
  });

  it('hides the toggle for admins without managed clients', async () => {
    renderApp({ route: '/', as: 'admin' });
    await screen.findByTestId('auth-logout-btn');
    expect(screen.queryByTestId('personalization-toggle')).not.toBeInTheDocument();
  });

  it('shows the toggle for regular users with managed clients', async () => {
    renderApp({ route: '/', as: 'regular' });
    expect(await screen.findByTestId('personalization-toggle')).toBeInTheDocument();
  });
});


describe('Phase AUTH-C — Client Hub narrowing', () => {
  it('toggling the chip changes the number of rendered client cards', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/', as: 'regular' });
    const toggle = await screen.findByTestId('personalization-toggle');

    // Make sure we start in the OFF state for a deterministic baseline.
    if (toggle.getAttribute('aria-pressed') === 'true') {
      await user.click(toggle);
    }

    // Count client card headings rendered. ClientCard puts the name in
    // an <h3>. Off → full registry; On → narrowed (often to zero in the
    // test seed since managed_client_ids may not match seed ids; the
    // point is just that the count is strictly smaller).
    const headingsOff = screen.getAllByRole('heading', { level: 3 });
    const offCount = headingsOff.length;
    expect(offCount).toBeGreaterThan(0);

    await user.click(toggle);
    await waitFor(() => {
      const headingsOn = screen.queryAllByRole('heading', { level: 3 });
      expect(headingsOn.length).toBeLessThan(offCount);
    });
  });
});


describe('Phase AUTH-C — toggle persistence', () => {
  it('writes the toggled flag to localStorage', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/', as: 'regular' });
    const toggle = await screen.findByTestId('personalization-toggle');
    const initial = toggle.getAttribute('aria-pressed');
    await user.click(toggle);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-pressed')).not.toBe(initial);
    });
    expect(localStorage.getItem('auth:personalizationActive:v1')).toBeTruthy();
  });
});
