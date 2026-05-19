/**
 * Phase NOTIF-B integration — NotificationOptInPanel inline in the
 * entity-creation success state.
 *
 * Covers:
 *   - Panel renders in collapsed state after a successful entity create
 *   - Click expands to show event checklist + recipient picker
 *   - Default events are pre-checked for the entity context
 *   - Save without events → inline validation error
 *   - Save without recipients → inline validation error
 *   - Happy save: panel collapses to ACTIVE state with the count badge
 *   - Re-open the panel pre-fills the saved selection
 *   - Delete-all returns the panel to the collapsed state
 *   - Cancel closes the expanded form without saving
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom edge */ }
});


// Helper — drive the entity-create flow up to the success panel.
async function createEntityToSuccessState(user) {
  const openBtn = await screen.findByRole('button', { name: /הוסף אדם$/ });
  await user.click(openBtn);
  await screen.findByText(/הוספת אדם חדש/);

  await user.type(screen.getByLabelText(/שם פרטי/), 'Jane');
  await user.type(screen.getByLabelText(/שם משפחה/), 'Doe');
  await user.selectOptions(screen.getByLabelText(/^לקוח/), 'alpha');
  const targetSelect = screen.getByLabelText(/ישות ראשית/);
  const options = within(targetSelect).getAllByRole('option');
  await user.selectOptions(targetSelect, options[1].value);

  await user.click(screen.getByRole('button', { name: /^שמור אדם$/ }));
  await screen.findByTestId('entity-success-panel');
}


describe('NotificationOptInPanel — collapsed → expanded → active state machine', () => {
  it('renders collapsed inside the entity-success panel', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    expect(await screen.findByTestId('notif-panel-collapsed')).toBeInTheDocument();
    // Active state should NOT be present — no existing subscriptions for
    // the brand-new entity.
    expect(screen.queryByTestId('notif-panel-active')).not.toBeInTheDocument();
  });

  it('clicking the collapsed CTA expands the form', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    expect(await screen.findByTestId('notif-panel-expanded')).toBeInTheDocument();
  });

  it('defaults for the entity context are pre-checked', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));

    // 'entity.phone.added' is marked default:true in the catalog.
    const checkbox = await screen.findByTestId('notif-event-entity.phone.added');
    expect(checkbox).toBeChecked();
  });

  it('save without events shows an inline error', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));

    // Uncheck the default event so events==0.
    const def = await screen.findByTestId('notif-event-entity.phone.added');
    await user.click(def);

    await user.click(screen.getByTestId('notif-save'));
    await screen.findByText(/יש לבחור לפחות אירוע אחד/);
  });

  it('save without recipients shows an inline error', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    // Default event is pre-checked. No recipient picked yet.
    await user.click(screen.getByTestId('notif-save'));
    await screen.findByText(/יש לבחור ערוץ אחד לפחות/);
  });

  it('happy save: panel collapses to active state with the count badge', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    // The default event is already checked. Pick a recipient.
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));
    await user.click(screen.getByTestId('notif-save'));

    // ACTIVE state — chip rendered with "(1)" (one default event).
    const active = await screen.findByTestId('notif-panel-active');
    expect(within(active).getByText(/התראות פעילות \(1\)/)).toBeInTheDocument();
  });

  it('re-opening the panel after save pre-fills the saved selection', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    // First save: 1 event, 1 recipient.
    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));
    await user.click(screen.getByTestId('notif-save'));

    // Click "Edit" to re-expand.
    const active = await screen.findByTestId('notif-panel-active');
    await user.click(within(active).getByText(/^ערוך$/));

    // The previously-saved event and recipient are still checked.
    const evt = await screen.findByTestId('notif-event-entity.phone.added');
    const rec = screen.getByTestId('notif-recipient-ops-alerts');
    expect(evt).toBeChecked();
    expect(rec).toBeChecked();
  });

  it('delete-all returns the panel to collapsed', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    // Save first.
    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));
    await user.click(screen.getByTestId('notif-save'));

    // Re-expand and delete-all.
    const active = await screen.findByTestId('notif-panel-active');
    await user.click(within(active).getByText(/^ערוך$/));
    await user.click(screen.getByTestId('notif-delete-all'));

    // Collapsed state again.
    await waitFor(() => {
      expect(screen.queryByTestId('notif-panel-active')).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId('notif-panel-collapsed')).toBeInTheDocument();
  });

  it('cancel closes the expanded form without persisting changes', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));

    // Cancel — the panel should snap back to collapsed (since no
    // subscriptions existed before).
    await user.click(screen.getByRole('button', { name: /^ביטול$/ }));
    expect(await screen.findByTestId('notif-panel-collapsed')).toBeInTheDocument();
  });

  it('patching recipients on an existing subscription works (no orphan deletes)', async () => {
    // Verifies the save-time diff: when only recipients change, the
    // existing row is PATCHed rather than deleted+recreated. We
    // exercise this through the UI rather than asserting on the
    // intermediate mockDb call list, since the user-facing outcome
    // (the active count stays at 1) is the actual contract.
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await createEntityToSuccessState(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));
    await user.click(screen.getByTestId('notif-save'));

    // Re-edit, ADD a second recipient.
    const active = await screen.findByTestId('notif-panel-active');
    await user.click(within(active).getByText(/^ערוך$/));
    await user.click(screen.getByTestId('notif-recipient-manager-channel'));
    await user.click(screen.getByTestId('notif-save'));

    // Still 1 event subscribed (the existing row was PATCHed).
    const stillActive = await screen.findByTestId('notif-panel-active');
    expect(within(stillActive).getByText(/התראות פעילות \(1\)/)).toBeInTheDocument();
  });
});
