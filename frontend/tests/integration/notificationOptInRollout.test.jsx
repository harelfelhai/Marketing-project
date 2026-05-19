/**
 * Phase NOTIF-C integration — OptInPanel rollout to additional mount
 * points beyond the entity-success state (which is covered by
 * notificationOptIn.test.jsx).
 *
 * Two mount points exercised here:
 *   1. Phone single-ingestion success state (SingleIngestionPanel)
 *   2. Task detail drawer body (TaskDetailDrawer)
 *
 * Smoke-level coverage — the deep panel behavior (save diff,
 * collapse/expand, delete-all, etc.) is already covered against the
 * entity context in notificationOptIn.test.jsx. Here we just verify
 * the panel mounts with the right contextKind/contextId on each
 * mount point and that the basic happy-path save works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom edge */ }
});


// ---------------------------------------------------------------------------
// Mount #1 — Phone single-ingestion success state
// ---------------------------------------------------------------------------


async function submitSinglePhone(user) {
  const openBtn = await screen.findByRole('button', { name: /קליטת מספר חדש/ });
  await user.click(openBtn);

  // Fill the dynamic form. The mock schema's labels are English
  // (Phone Number / Entity Type / Source / etc.); the form is rendered
  // by DynamicField against whatever the schema says.
  const phoneInput = await screen.findByLabelText(/Phone Number/i);
  await user.type(phoneInput, '+15559990777');
  await user.selectOptions(screen.getByLabelText(/Entity Type/i), 'family');
  await user.selectOptions(screen.getByLabelText(/Source/i), 'manual');
  // `client_id` is also marked required in the mock schema; pick the
  // first listed seed client to satisfy the validation gate.
  await user.selectOptions(screen.getByLabelText(/^Client/i), 'alpha');
  await user.click(screen.getByRole('button', { name: /^שלח$/ }));
}


describe('NOTIF-C rollout — phone single-ingestion success state', () => {
  it('replaces the form with a success card carrying the OptInPanel', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await submitSinglePhone(user);

    // Success card present.
    const successCard = await screen.findByTestId('phone-ingest-success-panel');
    expect(successCard).toBeInTheDocument();

    // OptInPanel mounted inside — collapsed state by default.
    expect(await screen.findByTestId('notif-panel-collapsed')).toBeInTheDocument();

    // The submit form is GONE.
    expect(screen.queryByRole('button', { name: /^שלח$/ })).not.toBeInTheDocument();
  });

  it('dismiss button closes the ingestion modal', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await submitSinglePhone(user);

    await screen.findByTestId('phone-ingest-success-panel');
    await user.click(screen.getByTestId('phone-ingest-success-dismiss'));

    // Modal title gone.
    expect(screen.queryByText(/קליטת מספרי טלפון/)).not.toBeInTheDocument();
  });

  it('happy save creates a phone-scoped subscription via the opt-in panel', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await submitSinglePhone(user);

    await screen.findByTestId('phone-ingest-success-panel');
    await user.click(await screen.findByTestId('notif-panel-collapsed'));

    // Default phone events are pre-checked.
    expect(screen.getByTestId('notif-event-phone.verification.changed')).toBeChecked();
    expect(screen.getByTestId('notif-event-phone.action.failed')).toBeChecked();

    // Pick a recipient and save.
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));
    await user.click(screen.getByTestId('notif-save'));

    // Active chip — both default events subscribed.
    const active = await screen.findByTestId('notif-panel-active');
    expect(within(active).getByText(/התראות פעילות \(2\)/)).toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// Mount #2 — TaskDetailDrawer (any task, terminal or not)
// ---------------------------------------------------------------------------


async function openTaskDrawer(user, phoneNumber = '+14155550102') {
  // /operations route shows the task table; default-hide is ON so
  // active tasks are visible. Click a row by its phone number to
  // open the drawer (this is the existing DX-T3 navigation seam).
  const phoneCell = await screen.findByText(phoneNumber);
  await user.click(phoneCell);
  // Drawer renders as role="dialog".
  return screen.findByRole('dialog');
}


describe('NOTIF-C rollout — TaskDetailDrawer mount point', () => {
  it('opt-in panel renders inside the drawer body for a pending task', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });

    await openTaskDrawer(user);
    // The panel mounts directly under the source-log section.
    expect(await screen.findByTestId('notif-panel-collapsed')).toBeInTheDocument();
  });

  it('opt-in panel pre-checks the task-context default events when expanded', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openTaskDrawer(user);

    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    // task.resolved is marked default:true in the catalog.
    expect(await screen.findByTestId('notif-event-task.resolved')).toBeChecked();
  });

  it('opt-in panel is scoped to the task — different tasks get different subscriptions', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });

    // Open task #1 (phone +14155550102), save a subscription.
    await openTaskDrawer(user, '+14155550102');
    await user.click(await screen.findByTestId('notif-panel-collapsed'));
    await user.click(screen.getByTestId('notif-recipient-ops-alerts'));
    await user.click(screen.getByTestId('notif-save'));

    // Active chip on task #1.
    expect(await screen.findByTestId('notif-panel-active')).toBeInTheDocument();

    // Close drawer, open task #3 (phone +14155550117 — another pending).
    await user.keyboard('{Escape}');   // close drawer
    await openTaskDrawer(user, '+14155550117');

    // The panel for task #3 should be COLLAPSED (no subscription yet
    // for THIS task — the subscription on task #1 doesn't leak).
    expect(await screen.findByTestId('notif-panel-collapsed')).toBeInTheDocument();
    expect(screen.queryByTestId('notif-panel-active')).not.toBeInTheDocument();
  });
});
