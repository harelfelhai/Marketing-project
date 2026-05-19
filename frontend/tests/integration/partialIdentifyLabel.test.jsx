/**
 * Phase DY-4-D — partial identification renders a meaningful label.
 *
 * When the operator names an envelope owner without picking a relation,
 * the entity gets entity_type='identified_envelope'. The Truth Panel
 * must render that state as a Hebrew "partial identification" label,
 * NOT echo the raw token (which was the user-reported bug from DY-4-C).
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


describe('Phase DY-4-D — partial identify label in Truth Panel', () => {
  it('renders "אדם מזוהה · זיהוי חלקי" after a name-only identify submit', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Open the raw envelope row.
    await user.click(await screen.findByText('+15559000088'));
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });

    // Confirm starting state — envelope label visible in the Truth Panel.
    expect(within(drawer).getByText(/מעטפת חברתית — זהות לא מאומתת/))
      .toBeInTheDocument();

    // Type a name in the identify form, leave relation untouched.
    await user.type(within(drawer).getByPlaceholderText('שם פרטי'), 'Mary');

    // Submit.
    const submitBtn = within(drawer).getByRole('button', { name: /שלח משוב/ });
    await user.click(submitBtn);

    // Wait for the optimistic local update.
    await waitFor(() => {
      expect(screen.getByText('המשוב נקלט בהצלחה')).toBeInTheDocument();
    });

    // The drawer Truth Panel now renders the partial-identify label,
    // NOT the raw "identified_envelope" token.
    const refreshedDrawer = screen.getByRole('dialog', { name: /פרטי טלפון/ });
    expect(within(refreshedDrawer).getByText('אדם מזוהה · זיהוי חלקי'))
      .toBeInTheDocument();
    // The raw token must NOT appear anywhere in the drawer.
    expect(within(refreshedDrawer).queryByText(/identified_envelope/))
      .not.toBeInTheDocument();
  });
});
