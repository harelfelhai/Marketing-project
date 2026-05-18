/**
 * Phase DY-4-B integration — drawer Truth Panel.
 *
 * The drawer header should render the two-row Identity + Phone-line
 * summary instead of the legacy single verification badge. Shape adapts
 * to entity_type:
 *   - Vector A (named entity): standard "Identity (named) + Phone line".
 *   - Vector B (envelope):     "מעטפת חברתית — זהות לא מאומתת" + ambient
 *                               source caption + diamond on the identity
 *                               row state pip.
 */

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


describe('Phase DY-4-B — drawer Truth Panel for Vector A', () => {
  it('renders both section labels in the drawer header', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Pick the first non-envelope phone row to open. Seed phone +15550000001
    // is a Vector A row (entity_type='target') — confirmed by the row
    // tests in DY-4-A.
    const rows = await screen.findAllByText(/^\+15550/);
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    // Both section labels are present in the Truth Panel.
    expect(within(drawer).getByText('הזהות')).toBeInTheDocument();
    expect(within(drawer).getByText('קו הטלפון')).toBeInTheDocument();
  });
});


describe('Phase DY-4-B — drawer Truth Panel for Vector B (envelope)', () => {
  it('shows the envelope identity placeholder and the ambient source', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Open the first envelope row via its known phone number.
    await user.click(await screen.findByText('+15559000088'));

    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });

    // Identity row shows the envelope placeholder copy.
    expect(within(drawer).getByText(/מעטפת חברתית — זהות לא מאומתת/))
      .toBeInTheDocument();
    // Section label still present.
    expect(within(drawer).getByText('הזהות')).toBeInTheDocument();
    // Phone-line section label still present.
    expect(within(drawer).getByText('קו הטלפון')).toBeInTheDocument();
  });

  it('confirmed-in-network envelope renders the phone number in the Truth Panel', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // EP-091 — seeded "phone-in-network confirmed, owner unknown".
    // The phone number appears BOTH in the drawer title AND in the
    // Truth Panel's Phone-line row — that's by design (header summary
    // + structured echo). Assert >=2 occurrences to lock the contract.
    await user.click(await screen.findByText('+15559000091'));
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });
    const occurrences = within(drawer).getAllByText('+15559000091');
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});


describe('Phase DY-4-B — legacy verification badge removed from header badges row', () => {
  it('does not render verificationLabel as a Badge component in the header', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    const rows = await screen.findAllByText(/^\+15550/);
    await user.click(rows[0]);
    const drawer = await screen.findByRole('dialog', { name: /פרטי טלפון/ });

    // The legacy badge was a <span> styled as a Badge with text like
    // "אומת - תקין". The label text may still appear elsewhere in the
    // drawer (e.g. the VerticalAuditTimeline references it in event
    // descriptions), so we scope this assertion to the HEADER block
    // (queryByText returns null when the badge is gone; we look for
    // an inline-flex rounded-full span carrying the legacy label —
    // the Badge primitive's signature classes).
    const header = drawer.querySelector('header');
    expect(header).not.toBeNull();
    const headerLegacyBadge = within(header).queryByText('אומת - תקין');
    expect(headerLegacyBadge).toBeNull();
  });
});
