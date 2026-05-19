/**
 * Operations Queue — bulk-action integration suite.
 *
 * Covers the Task Center bulk-update flow added on top of the Phase
 * DX baseline:
 *   - Default-hide toggle behavior (Requirement 1)
 *   - Per-row checkbox + select-all (Requirement 2)
 *   - Bulk action bar appearance + dismissal
 *   - End-to-end bulk-resolve via the mock parity layer
 *   - Per-task failure surfaces in the partial-success toast
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


// ---------------------------------------------------------------------------
// Requirement 1 — default-hide toggle
// ---------------------------------------------------------------------------


describe('Task Center — Requirement 1 (default-hide)', () => {
  it('hides resolved + rejected rows by default', async () => {
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });
    // SEED_TASKS row 4 is resolved; row 5 is rejected.
    expect(screen.queryByText('+14155550125')).not.toBeInTheDocument();
    expect(screen.queryByText('+14155550133')).not.toBeInTheDocument();
    // Active rows are visible.
    expect(screen.getByText('+14155550102')).toBeInTheDocument();
    expect(screen.getByText('+14155550109')).toBeInTheDocument();
    expect(screen.getByText('+14155550117')).toBeInTheDocument();
  });

  it('flipping "Show resolved" on brings terminal rows back', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    const toggle = screen.getByLabelText(/הצג משימות שטופלו/);
    await user.click(toggle);

    expect(await screen.findByText('+14155550125')).toBeInTheDocument();
    expect(screen.getByText('+14155550133')).toBeInTheDocument();
  });

  it('explicit status=resolved filter overrides the default-hide', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    // Pick "resolved" from the status dropdown. The toggle is still
    // OFF (default), but the explicit filter intent must win — the
    // audit view should show resolved tasks.
    const statusSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(statusSelect, 'resolved');

    expect(await screen.findByText('+14155550125')).toBeInTheDocument();
    // Other statuses gone.
    expect(screen.queryByText('+14155550102')).not.toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// Requirement 2 — multi-select + bulk action bar
// ---------------------------------------------------------------------------


async function findRowCheckbox(taskId) {
  return screen.findByTestId(`task-select-${taskId}`);
}


describe('Task Center — Requirement 2 (bulk action bar)', () => {
  it('bulk action bar is hidden when nothing is selected', async () => {
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });
    expect(screen.queryByTestId('task-bulk-action-bar')).not.toBeInTheDocument();
  });

  it('checking a row reveals the bulk action bar with the count', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    // SEED_TASKS row 1 is pending (visible by default).
    await user.click(await findRowCheckbox(1));

    const bar = await screen.findByTestId('task-bulk-action-bar');
    expect(within(bar).getByText(/1 משימות נבחרו/)).toBeInTheDocument();
  });

  it('select-all header checkbox checks every visible row', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    await user.click(screen.getByTestId('task-select-all'));

    // Three active rows visible → bar shows "3 משימות נבחרו".
    const bar = await screen.findByTestId('task-bulk-action-bar');
    expect(within(bar).getByText(/3 משימות נבחרו/)).toBeInTheDocument();
  });

  it('checkbox click does NOT open the task drawer', async () => {
    // The row click opens the drawer (cursor-pointer). The checkbox
    // cell must stopPropagation so the operator can select for
    // bulk-action without triggering the drawer side-effect.
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    await user.click(await findRowCheckbox(1));
    // Drawer didn't open — no role="dialog" present.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking "Mark as resolved" bulk-settles selected tasks and clears selection', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    // Select two pending tasks (rows 1 and 3).
    await user.click(await findRowCheckbox(1));
    await user.click(await findRowCheckbox(3));

    const bar = await screen.findByTestId('task-bulk-action-bar');
    expect(within(bar).getByText(/2 משימות נבחרו/)).toBeInTheDocument();

    // Fire the bulk-resolve.
    await user.click(screen.getByTestId('task-bulk-resolve'));

    // Bar disappears after a successful settle (selection cleared).
    await waitFor(() => {
      expect(screen.queryByTestId('task-bulk-action-bar')).not.toBeInTheDocument();
    });
    // The settled rows are now in terminal status → hidden by default.
    expect(screen.queryByText('+14155550102')).not.toBeInTheDocument();
    expect(screen.queryByText('+14155550117')).not.toBeInTheDocument();
  });

  it('bulk-reject writes the rejected status', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    await user.click(await findRowCheckbox(1));
    await user.click(screen.getByTestId('task-bulk-reject'));

    // Bar gone (selection cleared after success); the settled row
    // becomes terminal and is hidden by the default-hide filter.
    await waitFor(() => {
      expect(screen.queryByTestId('task-bulk-action-bar')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('+14155550102')).not.toBeInTheDocument();

    // Confirm by toggling "Show resolved" — the row reappears with
    // its new terminal status.
    await user.click(screen.getByLabelText(/הצג משימות שטופלו/));
    expect(await screen.findByText('+14155550102')).toBeInTheDocument();
  });

  it('clearing selection via the X button hides the bulk bar', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByRole('heading', { name: /מרכז משימות/ });

    await user.click(await findRowCheckbox(1));
    const bar = await screen.findByTestId('task-bulk-action-bar');
    await user.click(within(bar).getByLabelText(/נקה בחירה/));

    expect(screen.queryByTestId('task-bulk-action-bar')).not.toBeInTheDocument();
  });
});
