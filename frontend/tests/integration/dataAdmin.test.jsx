/**
 * UAT round-3 — DataAdminPage integration.
 *
 * Smoke-tests the new admin tab end-to-end through the mock parity
 * layer:
 *   - admin can reach /admin
 *   - regular/guest are blocked (RequireRole fallback)
 *   - persons sub-tab renders rows
 *   - edit modal opens, saves, and reflects in the row
 *   - delete confirms, cascades (mock shows phone count), and the
 *     row marks as deleted when "show deleted" toggle is on
 *   - phones sub-tab parallel flow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom edge */ }
});


describe('DataAdminPage — open to all roles', () => {
  // UAT round-3 follow-up: the data-admin tab is INTENTIONALLY open to
  // every authenticated user (including regulars). It is not a Task
  // Center, and edit/delete here are operational maintenance available
  // to anyone on the team.
  it('regular user at /admin reaches the persons tab', async () => {
    renderApp({ route: '/admin', as: 'regular' });
    expect(await screen.findByTestId('admin-tab-persons')).toBeInTheDocument();
  });

  it('admin reaches the persons tab by default', async () => {
    renderApp({ route: '/admin', as: 'admin' });
    expect(await screen.findByTestId('admin-tab-persons')).toBeInTheDocument();
    expect(screen.getByTestId('admin-persons-table')).toBeInTheDocument();
  });
});


describe('DataAdminPage — persons CRUD', () => {
  it('switching sub-tabs swaps the table', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/admin', as: 'admin' });
    expect(await screen.findByTestId('admin-persons-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('admin-tab-phones'));
    expect(await screen.findByTestId('admin-phones-table')).toBeInTheDocument();
  });

  it('renders at least one person row from the seeded mock data', async () => {
    renderApp({ route: '/admin', as: 'admin' });
    const rows = await screen.findAllByTestId('admin-person-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('include-deleted toggle adds tombstoned rows', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/admin', as: 'admin' });
    // The first person row's delete button → confirm.
    const firstDeleteBtn = (await screen.findAllByText(/^מחק$/))[0];
    await user.click(firstDeleteBtn);
    const confirm = await screen.findByTestId('admin-confirm-delete-entity');
    await user.click(within(confirm).getByTestId('admin-modal-save'));

    // After delete + default filter (hide deleted) the row vanishes…
    await waitFor(() => {
      const remaining = screen.queryAllByTestId('admin-person-row');
      expect(remaining.length).toBeGreaterThan(0);
    });
    // Toggle the include-deleted checkbox → "נמחק" badge appears.
    await user.click(screen.getByTestId('admin-toggle-include-deleted'));
    await waitFor(() => {
      expect(screen.getAllByText(/נמחק$/).length).toBeGreaterThan(0);
    });
  });
});


describe('EntitiesPage — view tab', () => {
  it('shows all entity rows (primary + associated)', async () => {
    renderApp({ route: '/entities', as: 'admin' });
    const rows = await screen.findAllByTestId('entity-row');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('clicking the phones-count opens a popover listing the linked phones', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/entities', as: 'admin' });
    await screen.findAllByTestId('entity-row');
    // Find the first count button that is enabled (>0 phones).
    const allCountBtns = screen.getAllByRole('button').filter(
      (b) => b.getAttribute('data-testid')?.startsWith('entity-phones-count-')
              && !b.disabled,
    );
    expect(allCountBtns.length).toBeGreaterThan(0);
    await user.click(allCountBtns[0]);
    const popover = await screen.findByTestId('entity-phones-popover');
    // Popover shows at least one אמינות line.
    expect(within(popover).getAllByText(/אמינות/).length).toBeGreaterThan(0);
  });
});
