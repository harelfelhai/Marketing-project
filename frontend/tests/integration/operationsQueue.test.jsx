/**
 * Operations Queue — integration suite (DX-T3).
 *
 * Mounts the full app and exercises:
 *   1. The /operations route renders the 5 seeded mock tasks (MOCK_MODE
 *      uses SEED_TASKS).
 *   2. Filter dropdowns narrow the table.
 *   3. Clicking a row opens the drawer with the correct task details.
 *   4. The resolve flow: open drawer → resolve button → modal → empty-note
 *      validation → submit → drawer reflects terminal state.
 *
 * Note: these tests run in MOCK_MODE (forced by vitest.config.js
 * VITE_USE_REAL_API='false'), so axios is never touched.
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';
import { SEED_TASKS } from '../../src/mock/mockData';


describe('Operations Queue — page render', () => {
  it('renders the page title and all seed tasks', async () => {
    renderApp({ route: '/operations' });
    expect(await screen.findByRole('heading', { name: /מרכז משימות/ })).toBeInTheDocument();
    // Five rows — the SEED_TASKS count.
    expect(SEED_TASKS.length).toBe(5);
    // Phone numbers from the seed should all appear in the rendered table.
    SEED_TASKS.forEach((t) => {
      expect(screen.getByText(t.phone_number)).toBeInTheDocument();
    });
  });

  it('shows the filter bar with three controls', () => {
    renderApp({ route: '/operations' });
    expect(screen.getByPlaceholderText(/חיפוש/)).toBeInTheDocument();
    // Two dropdowns (status + task_type).
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
  });
});


describe('Operations Queue — filter behavior', () => {
  it('narrows the table when status is filtered', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });

    // Task 1 (pending) and 3 (pending) are visible at start.
    expect(await screen.findByText('+14155550102')).toBeInTheDocument();
    expect(screen.getByText('+14155550117')).toBeInTheDocument();

    const statusSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(statusSelect, 'pending');

    // After filter: resolved task #4 (+14155550125) is gone, but pending
    // task #3 (+14155550117) remains.
    await waitFor(() => {
      expect(screen.queryByText('+14155550125')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('+14155550117')).toBeInTheDocument();
  });
});


describe('Operations Queue — drawer + resolve flow', () => {
  it('opens the drawer on row click and shows task details', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });

    // SEED_TASKS[0] is task #1, pending, phone +14155550102.
    await user.click(await screen.findByText('+14155550102'));

    // Drawer header shows the task type label.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/תיקון כשל/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ממתין לטיפול/)).toBeInTheDocument();

    // Resolve / Reject buttons render (admin role from mock).
    expect(within(dialog).getByRole('button', { name: /אישור וטיפול/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /דחייה/ })).toBeInTheDocument();
  });

  it('blocks resolve submit with empty note (inline validation)', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });

    await user.click(await screen.findByText('+14155550102'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /אישור וטיפול/ }));

    // Modal opens — find the textarea + submit button.
    // ResolveTaskModal renders via portal so it's at document.body, not
    // inside the drawer's role="dialog" node.
    const textarea = await screen.findByPlaceholderText(/הסבר קצר על ההחלטה/);
    // Find the modal's confirm button (the second one labeled "אישור וטיפול").
    const confirmButtons = screen.getAllByRole('button', { name: /אישור וטיפול/ });
    const modalConfirm = confirmButtons[confirmButtons.length - 1];

    await user.click(modalConfirm);

    // Inline error appears beneath the textarea; modal stays open.
    expect(screen.getByText(/יש להזין הערת טיפול/)).toBeInTheDocument();
    expect(textarea).toBeInTheDocument();
  });

  it('completes the resolve loop and transitions the task to terminal state', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });

    // Open task #1 drawer.
    await user.click(await screen.findByText('+14155550102'));
    const dialog = await screen.findByRole('dialog');

    // Click Resolve → modal opens.
    await user.click(within(dialog).getByRole('button', { name: /אישור וטיפול/ }));
    const textarea = await screen.findByPlaceholderText(/הסבר קצר על ההחלטה/);
    await user.type(textarea, 'integration test resolution');

    // Submit (last "אישור וטיפול" — the modal's footer button).
    const confirmButtons = screen.getAllByRole('button', { name: /אישור וטיפול/ });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    // The drawer footer replaces the verdict buttons with a terminal notice.
    await waitFor(() => {
      expect(screen.getByText(/לא ניתן לחזור עליה/)).toBeInTheDocument();
    });

    // Verdict buttons gone.
    expect(screen.queryByRole('button', { name: /^דחייה$/ })).not.toBeInTheDocument();
  });
});
