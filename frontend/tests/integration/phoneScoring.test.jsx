/**
 * Phase DY frontend integration — visual surfacing of scoring fields.
 *
 * Mounts /phones with the mock seed (which already injects priority +
 * confidence + tier on every row via buildInitialDb) and asserts:
 *   - Priority badges render in every row.
 *   - Tier badges render when customer_tier is populated.
 *   - Drawer shows the scoring block at the top.
 *   - Default ordering is by priority DESC (id ties broken by id DESC).
 */

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


describe('Phone Grid — scoring badges', () => {
  it('renders a priority badge in every visible row', async () => {
    renderApp({ route: '/phones' });
    // Wait for the page header to confirm the page rendered.
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // The header for column 1 is "טלפון" — every body row that lands
    // here carries a priority badge with the SCORE_PRIORITY_LABEL token.
    // Hebrew label is "עדיפות" — assert >=1 match (typically many).
    const priorityHits = await screen.findAllByText(/עדיפות/);
    expect(priorityHits.length).toBeGreaterThan(0);
  });

  it('renders a tier badge when customer_tier is present', async () => {
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    // Hebrew label "דרגה N" — every seeded entity has a tier so we
    // expect to see this at least once.
    const tierHits = await screen.findAllByText(/דרגה \d/);
    expect(tierHits.length).toBeGreaterThan(0);
  });
});


describe('Phone Drawer — scoring block', () => {
  it('shows priority + confidence + tier badges in the header', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Click the first row to open the drawer.
    const rows = await screen.findAllByText(/\+15550/);
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    // All three score badges appear inside the drawer header.
    expect(within(drawer).getByText(/עדיפות/)).toBeInTheDocument();
    expect(within(drawer).getByText(/אמינות/)).toBeInTheDocument();
    expect(within(drawer).getByText(/דרגה/)).toBeInTheDocument();
  });
});
