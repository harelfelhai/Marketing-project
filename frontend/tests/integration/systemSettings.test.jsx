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


describe('System Settings — external API backend', () => {
  it('shows the API editor only after the api backend is selected', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/system', as: 'admin' });
    const page = await screen.findByTestId('system-settings-page');

    // Default backend is sql → neither the API nor the Mongo editor is shown.
    expect(screen.queryByTestId('api-backend-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mongo-url-editor')).not.toBeInTheDocument();

    // Selecting 'api' reveals ITS editor (and not the Mongo one).
    const apiRadio = within(within(page).getByTestId('backend-option-api')).getByRole('radio');
    expect(apiRadio).not.toBeDisabled();
    await user.click(apiRadio);

    const editor = await screen.findByTestId('api-backend-editor');
    expect(screen.queryByTestId('mongo-url-editor')).not.toBeInTheDocument();

    // An editor per aggregate, and our column names are listed for mapping.
    expect(within(editor).getByTestId('api-table-entity')).toBeInTheDocument();
    expect(within(editor).getByTestId('api-table-notification_delivery')).toBeInTheDocument();
    // Per-column mapping rows expose OUR column names (e.g. phone_number.score).
    expect(within(editor).getByTestId('api-map-phone_number-score')).toBeInTheDocument();
    expect(within(editor).getByTestId('api-map-entity-full_name')).toBeInTheDocument();

    // Switching to mongo swaps the panel.
    const mongoRadio = within(within(page).getByTestId('backend-option-mongo')).getByRole('radio');
    await user.click(mongoRadio);
    await waitFor(() => expect(screen.queryByTestId('api-backend-editor')).not.toBeInTheDocument());
    expect(screen.getByTestId('mongo-url-editor')).toBeInTheDocument();
  });

  it('saving an API config flips it to configured (mock mode, no network)', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/system', as: 'admin' });
    const page = await screen.findByTestId('system-settings-page');

    await user.click(within(within(page).getByTestId('backend-option-api')).getByRole('radio'));
    const editor = await screen.findByTestId('api-backend-editor');

    // Starts unconfigured.
    expect(within(editor).getByText('לא מוגדר')).toBeInTheDocument();

    await user.type(within(editor).getByTestId('api-base-url-input'), 'https://api.example.com/v1');
    await user.type(within(editor).getByTestId('api-token-input'), 'Bearer SECRET');
    await user.click(within(editor).getByTestId('api-config-save'));

    // The mock mutator flips api_configured without any network call: the
    // "not configured" label disappears and the keep-token hint appears.
    await waitFor(() =>
      expect(within(editor).queryByText('לא מוגדר')).not.toBeInTheDocument(),
    );
    expect(
      within(editor).getByText('השאר ריק כדי לשמור את הטוקן הקיים.'),
    ).toBeInTheDocument();
  });

  it('renders a live request preview per table that reflects the config', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/system', as: 'admin' });
    const page = await screen.findByTestId('system-settings-page');

    await user.click(within(within(page).getByTestId('backend-option-api')).getByRole('radio'));
    const editor = await screen.findByTestId('api-backend-editor');

    await user.type(within(editor).getByTestId('api-base-url-input'), 'https://api.acme.com/v1');

    // The entity preview shows the real URLs + default methods.
    const preview = within(editor).getByTestId('api-preview-entity');
    expect(preview.textContent).toContain('https://api.acme.com/v1/entity');
    expect(preview.textContent).toContain('POST');   // create default

    // Editing the table path flows straight into the preview.
    const pathInput = within(editor).getByTestId('api-table-path-entity');
    await user.clear(pathInput);
    await user.type(pathInput, 'people');
    expect(within(editor).getByTestId('api-preview-entity').textContent).toContain('/people');
  });
});
