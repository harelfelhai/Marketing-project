/**
 * Configurable display fields — end-to-end (System Settings → Entities table).
 *
 * Proves the feature wires through: an admin toggles a column off in the
 * System Settings tab, saves, and the Entities table stops rendering that
 * column — with no code change. Default (unconfigured) state renders every
 * catalog column, so there is no regression.
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';
import {
  ENTITIES_COL_CLIENT, ENTITIES_COL_NAME, NAV_ENTITIES,
  SYSSET_FIELDS_TOAST_SAVED,
} from '../../src/config/strings.he';


describe('Configurable display fields', () => {
  it('Entities table shows all catalog columns by default', async () => {
    renderApp({ route: '/entities', as: 'admin' });
    // The default selection includes every column, e.g. Name + Client.
    expect(await screen.findByText(ENTITIES_COL_NAME)).toBeInTheDocument();
    expect(screen.getByText(ENTITIES_COL_CLIENT)).toBeInTheDocument();
  });

  it('the System Settings editor lists the entities columns with toggles', async () => {
    renderApp({ route: '/system', as: 'admin' });
    const editor = await screen.findByTestId('display-fields-entities');
    // One toggle per catalog column (id, name, client, …).
    expect(within(editor).getByTestId('field-toggle-entities-client')).toBeInTheDocument();
    expect(within(editor).getByTestId('field-toggle-entities-name')).toBeInTheDocument();
  });

  it('toggling a column off + saving hides it from the Entities table', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/system', as: 'admin' });

    const editor = await screen.findByTestId('display-fields-entities');
    // Turn OFF the "client" column, then save.
    await user.click(within(editor).getByTestId('field-toggle-entities-client'));
    await user.click(screen.getByTestId('display-fields-save-entities'));
    // Wait for the save to persist (async mock delay) before navigating.
    await screen.findByText(SYSSET_FIELDS_TOAST_SAVED);

    // Navigate to the Entities tab (same app instance → shared mock state).
    await user.click(screen.getByRole('link', { name: new RegExp(NAV_ENTITIES) }));

    // The Entities table loads its configured columns asynchronously, so
    // wait for the Client column to disappear; the Name column stays.
    await waitFor(() =>
      expect(screen.queryByText(ENTITIES_COL_CLIENT)).not.toBeInTheDocument()
    );
    expect(screen.getByText(ENTITIES_COL_NAME)).toBeInTheDocument();
  });
});
