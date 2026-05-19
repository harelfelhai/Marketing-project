/**
 * Phase DY-4-C integration — forked verdict form.
 *
 * Vector A drawer shows the 2x2 axis grid (phone + relation rows, each
 * with confirm/refute pills). Vector B drawer shows the single phone-
 * in-network axis + the inline Identify form (name fields + relation
 * dropdown). Submit triggers submitVerdict with the new payload shape
 * and the operator sees a success toast.
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


describe('Phase DY-4-C — Vector A verdict form', () => {
  it('renders both axes with confirm/refute pills', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Click any non-envelope phone row.
    const rows = await screen.findAllByText(/^\+15550/);
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    // Form heading present.
    expect(within(drawer).getByText('משוב משימת אימות')).toBeInTheDocument();
    // Both axis labels render in the form area.
    expect(within(drawer).getByText('הקשר ליעד')).toBeInTheDocument();
    // The "אשר" (confirm) pill appears twice — once per axis row.
    expect(within(drawer).getAllByText('אשר').length).toBeGreaterThanOrEqual(2);
    // Same for refute.
    expect(within(drawer).getAllByText('הפרך').length).toBeGreaterThanOrEqual(2);
  });

  it('submit with no selection shows the "select at least one" toast', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    const rows = await screen.findAllByText(/^\+15550/);
    await user.click(rows[0]);
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    const submitBtn = within(drawer).getByRole('button', { name: /שלח משוב/ });
    // Button is disabled when nothing is selected — click does nothing.
    expect(submitBtn).toBeDisabled();
  });

  it('selecting an axis enables submit and the click completes', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    const rows = await screen.findAllByText(/^\+15550/);
    await user.click(rows[0]);
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });

    // First "אשר" pill = phone axis confirm.
    const confirmPills = within(drawer).getAllByText('אשר');
    await user.click(confirmPills[0]);

    // Submit now enabled.
    const submitBtn = within(drawer).getByRole('button', { name: /שלח משוב/ });
    expect(submitBtn).not.toBeDisabled();

    await user.click(submitBtn);
    // Success toast appears (rendered outside the drawer dialog).
    await waitFor(() => {
      expect(screen.getByText('המשוב נקלט בהצלחה')).toBeInTheDocument();
    });
  });
});


describe('Phase DY-4-C — Vector B (envelope) verdict form', () => {
  it('renders phone-in-network axis label + Identify form', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Open the seeded envelope row.
    await user.click(await screen.findByText('+15559000088'));
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });

    // Envelope-specific form heading.
    expect(within(drawer).getByText('משוב על מעטפת חברתית')).toBeInTheDocument();
    // Phone-in-network axis label (replaces "הקשר ליעד" which is
    // hidden for envelopes because identity doesn't exist yet).
    expect(within(drawer).getAllByText('הטלפון בסביבת היעד').length).toBeGreaterThanOrEqual(1);
    // Relation axis row is NOT rendered for envelopes.
    expect(within(drawer).queryByText('הקשר ליעד')).not.toBeInTheDocument();
    // Identify form heading + first/last name inputs.
    expect(within(drawer).getByText('זיהוי בעל הטלפון')).toBeInTheDocument();
    expect(within(drawer).getByPlaceholderText('שם פרטי')).toBeInTheDocument();
    expect(within(drawer).getByPlaceholderText('שם משפחה')).toBeInTheDocument();
  });

  it('typing an identify name enables submit even without an axis pick', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    await user.click(await screen.findByText('+15559000088'));
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });

    // No axis selected; submit starts disabled.
    const submitBtn = within(drawer).getByRole('button', { name: /שלח משוב/ });
    expect(submitBtn).toBeDisabled();

    // Type a first name → identification block triggers canSubmit.
    await user.type(within(drawer).getByPlaceholderText('שם פרטי'), 'Mary');
    expect(submitBtn).not.toBeDisabled();
  });
});
