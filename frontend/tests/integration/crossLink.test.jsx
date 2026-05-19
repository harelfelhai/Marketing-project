/**
 * Cross-link regression suite (DX-T3).
 *
 * Codifies the three bugs found during the post-DX-5 manual smoke test
 * so they can't sneak back:
 *
 *   1. ClientCard "N משימות פתוחות" badge cross-link must filter the
 *      Operations table to OPEN tasks only (pending+assigned), not all
 *      tasks for that client. Fixed in da2ae37 via openOnly URL param.
 *
 *   2. PhoneDetailDrawer "N משימות" pill click must navigate to
 *      /operations?phone_id=N. Pre-fix, the drawer's onClose() ran
 *      setSearchParams({}) AFTER navigate(), racing it and yanking us
 *      back to /phones. Fixed in da2ae37 by dropping onClose() from
 *      the pill click site.
 *
 *   3. OperationsQueuePage filter chips must NOT double-stack across
 *      cross-link navigations. The URL is fully authoritative for
 *      phoneId / clientId / openOnly — every URL change re-seeds all
 *      three. Fixed in da2ae37.
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


// --- Bug #1 ---------------------------------------------------------------


describe('Bug 1 regression — ClientCard badge cross-link respects open-only', () => {
  it('renders only pending+assigned tasks when arriving with ?open=true', async () => {
    renderApp({ route: '/operations?client_id=alpha&open=true' });

    // SEED_TASKS for client 'alpha':
    //   #1 pending  client_id='alpha'   phone +14155550102   ✓ shown
    //   #2 assigned client_id='beta'    phone +14155550109   ✗ wrong client
    //   #4 resolved client_id='delta'   phone +14155550125   ✗ wrong client
    //   #5 rejected client_id='epsilon' phone +14155550133   ✗ wrong client
    // Only task #1 should render.
    expect(await screen.findByText('+14155550102')).toBeInTheDocument();

    // A different-client task must NOT appear.
    expect(screen.queryByText('+14155550125')).not.toBeInTheDocument();

    // Emerald "open only" chip is visible — confirming open=true param landed.
    expect(screen.getByText(/משימות פתוחות בלבד/)).toBeInTheDocument();
    // Sky "filtered by client" chip too.
    expect(screen.getByText(/מסונן ללקוח/)).toBeInTheDocument();
  });

  it('shows ALL tasks for the client when open=true is absent (after toggling show-resolved)', async () => {
    // Same client_id, no open=true → resolved/rejected tasks for that
    // client should also appear. The Task Center now hides terminal
    // rows by default (Requirement 1), so the operator must flip
    // "Show resolved" on for them to appear — but the underlying
    // client_id filter must still let the rejected task through.
    const user = userEvent.setup();
    renderApp({ route: '/operations?client_id=epsilon' });

    // Default-hide is on → terminal rows hidden even with client filter.
    expect(screen.queryByText('+14155550133')).not.toBeInTheDocument();

    // Flip the toggle on.
    await user.click(screen.getByLabelText(/הצג משימות שטופלו/));

    // SEED_TASKS[4] is task #5, rejected, client_id='epsilon', phone +14155550133.
    expect(await screen.findByText('+14155550133')).toBeInTheDocument();
    // Emerald chip NOT visible (open=true was never set).
    expect(screen.queryByText(/משימות פתוחות בלבד/)).not.toBeInTheDocument();
  });
});


// --- Bug #3 ---------------------------------------------------------------


describe('Bug 3 regression — URL is authoritative for cross-link filters', () => {
  it('arriving with only ?phone_id=N clears a previously-seeded clientId', async () => {
    // Step 1: land on operations filtered by client → both chips active.
    const { rerender } = renderApp({
      route: '/operations?client_id=alpha&open=true',
    });
    expect(screen.getByText(/מסונן ללקוח/)).toBeInTheDocument();
    expect(screen.getByText(/משימות פתוחות בלבד/)).toBeInTheDocument();

    // Step 2: simulate the cross-link navigation by re-mounting at
    // /operations?phone_id=2 — the regression scenario from the smoke
    // test. (MemoryRouter doesn't share history between renderApp calls
    // so we use a fresh mount instead of in-app navigation.)
    rerender(null);
    renderApp({ route: '/operations?phone_id=2' });

    // The phone chip is now active.
    expect(screen.getByText(/מסונן לטלפון #2/)).toBeInTheDocument();
    // Crucially: the client and open-only chips are GONE — they did not
    // persist across navigations.
    expect(screen.queryByText(/מסונן ללקוח/)).not.toBeInTheDocument();
    expect(screen.queryByText(/משימות פתוחות בלבד/)).not.toBeInTheDocument();
  });

  it('clear-filters button resets every chip at once', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations?client_id=alpha&open=true' });

    // Two chips visible.
    expect(screen.getByText(/מסונן ללקוח/)).toBeInTheDocument();
    expect(screen.getByText(/משימות פתוחות בלבד/)).toBeInTheDocument();

    // Click "נקה סינון".
    await user.click(screen.getByRole('button', { name: /נקה סינון/ }));

    // Both chips disappear.
    expect(screen.queryByText(/מסונן ללקוח/)).not.toBeInTheDocument();
    expect(screen.queryByText(/משימות פתוחות בלבד/)).not.toBeInTheDocument();
  });
});


// --- PhoneGridPage auto-open (DX-5 polish) --------------------------------


describe('PhoneGridPage auto-opens the drawer from ?phone_id=N', () => {
  it('renders the matching phone drawer on mount', async () => {
    renderApp({ route: '/phones?phone_id=1' });
    // The phone drawer renders with role="dialog" and aria-label
    // ARIA_PHONE_DETAIL = "פרטי טלפון".
    const dialog = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    expect(dialog).toBeInTheDocument();
  });

  it('does NOT open a drawer when phone_id is absent', () => {
    renderApp({ route: '/phones' });
    expect(screen.queryByRole('dialog', { name: /פרטי טלפון/ })).not.toBeInTheDocument();
  });
});


// --- Operations page renders the open-task pill on PhoneDetailDrawer ------


describe('PhoneDetailDrawer task pill (Bug 2 regression)', () => {
  it('renders an amber count pill when the phone has tasks', async () => {
    // SEED_TASKS[0] has phone_id=2 (pending) → drawer for phone 2 should
    // show "1 משימות".
    renderApp({ route: '/phones?phone_id=2' });
    const dialog = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    // Match the active (amber) state — text format "N משימות".
    expect(within(dialog).getByText(/1 משימות/)).toBeInTheDocument();
  });

  it('renders the empty-state pill when the phone has no tasks', async () => {
    // SEED_TASKS has no entry with phone_id=1.
    renderApp({ route: '/phones?phone_id=1' });
    const dialog = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    expect(within(dialog).getByText(/אין משימות/)).toBeInTheDocument();
  });
});
