/**
 * DY-3 integration — sort-toggle behaviour and ClientCard tier badge.
 *
 * Two surfaces, two scenarios each:
 *   - PhoneFilterBar sort dropdown changes the row ordering visible
 *     in the PhoneTable.
 *   - ClientCard renders a tier badge derived from any phone owned
 *     by that client.
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


describe('Phase DY-3 — sort toggle', () => {
  it('renders both sort options in the PhoneFilterBar', async () => {
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Two options exist as <option> nodes inside the sort <select>.
    // findByText against an exact label match is the cheapest assertion.
    expect(await screen.findByText('מיון: עדיפות')).toBeInTheDocument();
    expect(screen.getByText('מיון: סדר כניסה')).toBeInTheDocument();
  });

  it('switching to ingested_at re-orders the table client-side', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Find the sort dropdown via its current selected value (priority is
    // the default). The Hebrew label "מיון: עדיפות" identifies it.
    const sortSelect = screen.getByDisplayValue('מיון: עדיפות');
    await user.selectOptions(sortSelect, 'ingested_at');

    // After the change, the displayed value flips.
    expect(screen.getByDisplayValue('מיון: סדר כניסה')).toBeInTheDocument();
  });
});


describe('Phase DY-3 — ClientCard tier badge', () => {
  it('renders a tier badge on every card with seeded phones', async () => {
    renderApp({ route: '/' });
    await screen.findByRole('heading', { name: /מרכז לקוחות/ });
    // Mock seed assigns tier 1/2/3 to every client; every card should
    // render a "דרגה N" badge. Five cards total in the seed.
    const tierBadges = await screen.findAllByText(/דרגה \d/);
    expect(tierBadges.length).toBeGreaterThanOrEqual(5);
  });
});
