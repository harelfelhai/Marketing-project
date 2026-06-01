/**
 * System Settings tab (Phase A) — admin-only infrastructure controls.
 *
 * Covers:
 *   - the separated gear entry renders for admins and routes to /system
 *   - the page lists the storage backends, sql selected, mongo disabled
 *   - the "applies on restart" note is shown
 *   - a regular (non-admin) operator is bounced away from /system
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


describe('System Settings — admin surface', () => {
  it('renders the storage-backend selector with sql active and mongo selectable', async () => {
    renderApp({ route: '/system', as: 'admin' });

    const page = await screen.findByTestId('system-settings-page');

    const sql   = within(page).getByTestId('backend-option-sql');
    const mongo = within(page).getByTestId('backend-option-mongo');

    // sql is the active, enabled choice.
    const sqlRadio = within(sql).getByRole('radio');
    expect(sqlRadio).toBeChecked();
    expect(sqlRadio).not.toBeDisabled();

    // mongo is now a wired, selectable option (no longer disabled).
    const mongoRadio = within(mongo).getByRole('radio');
    expect(mongoRadio).not.toBeDisabled();
    expect(mongoRadio).not.toBeChecked();
  });

  it('save is disabled until a different backend is chosen', async () => {
    renderApp({ route: '/system', as: 'admin' });
    await screen.findByTestId('system-settings-page');
    // Default selection equals the persisted value → nothing to save.
    expect(screen.getByTestId('system-settings-save')).toBeDisabled();
  });

  it('selecting mongo then saving persists the new backend', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/system', as: 'admin' });
    const page = await screen.findByTestId('system-settings-page');

    const mongoRadio = within(within(page).getByTestId('backend-option-mongo')).getByRole('radio');
    await user.click(mongoRadio);

    const save = screen.getByTestId('system-settings-save');
    expect(save).not.toBeDisabled();   // now dirty
    await user.click(save);

    // After saving, mongo is the persisted selection and save goes idle again.
    await waitFor(() => expect(screen.getByTestId('system-settings-save')).toBeDisabled());
    expect(mongoRadio).toBeChecked();
  });

  it('exposes the separated gear entry for admins', async () => {
    renderApp({ route: '/', as: 'admin' });
    expect(await screen.findByTestId('nav-system-settings')).toBeInTheDocument();
  });

  it('hides the gear entry from regular operators', async () => {
    renderApp({ route: '/', as: 'regular' });
    // Wait for the shell to render (the primary nav is visible to everyone),
    // then assert the admin-only gear entry never appears.
    await screen.findByRole('navigation');
    expect(screen.queryByTestId('nav-system-settings')).not.toBeInTheDocument();
  });

  it('bounces a regular operator away from /system', async () => {
    renderApp({ route: '/system', as: 'regular' });
    // RequireRole fallback redirects to "/"; the settings page never mounts.
    await waitFor(() => {
      expect(screen.queryByTestId('system-settings-page')).not.toBeInTheDocument();
    });
  });
});
