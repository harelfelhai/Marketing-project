/**
 * Phase E2-C integration — entity ingestion modal (single-entry tab).
 *
 * Covers:
 *   - "+ Add Person" header button opens the entity modal
 *   - Modal renders the three-tab strip with Single selected by default
 *   - Validation blocks empty submissions
 *   - Two-step picker: client selection populates the target dropdown
 *   - Submitting a valid form shows the friction-free success panel
 *   - Friction-free CTA closes the entity modal and opens the phone
 *     modal with entity_type pre-filled from the new person's context
 *   - "Cancel" closes without creating
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


async function openEntityModal(user) {
  const openBtn = await screen.findByRole('button', { name: /הוסף אדם$/ });
  await user.click(openBtn);
  // Modal title appears.
  await screen.findByText(/הוספת אדם חדש/);
}


describe('Phase E2-C — entity ingestion modal (single entry)', () => {
  it('opens via the "+ Add Person" header button', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    // Tab strip present with 3 tabs; Single selected.
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.length).toBe(3);
    const singleTab = screen.getByRole('tab', { name: /אדם בודד/ });
    expect(singleTab).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the single-entry form with first/last name + relation + target picker', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    expect(screen.getByLabelText(/שם פרטי/)).toBeInTheDocument();
    expect(screen.getByLabelText(/שם משפחה/)).toBeInTheDocument();
    expect(screen.getByLabelText(/סוג קרבה/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^לקוח/)).toBeInTheDocument();
    expect(screen.getByLabelText(/ישות ראשית/)).toBeInTheDocument();
  });

  it('target dropdown is disabled until a client is picked', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    const targetSelect = screen.getByLabelText(/ישות ראשית/);
    expect(targetSelect).toBeDisabled();

    // Pick a client → target select enables.
    const clientSelect = screen.getByLabelText(/^לקוח/);
    await user.selectOptions(clientSelect, 'alpha');
    expect(targetSelect).not.toBeDisabled();
  });

  it('shows a validation error when first_name is empty on submit', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    // Skip first_name; pick client + target so only first_name is missing.
    await user.selectOptions(screen.getByLabelText(/^לקוח/), 'alpha');
    // Selecting a target requires the dropdown to have options first.
    const targetSelect = screen.getByLabelText(/ישות ראשית/);
    const options = within(targetSelect).getAllByRole('option');
    // The first option is the placeholder; pick the second (a real target).
    if (options.length >= 2) {
      await user.selectOptions(targetSelect, options[1].value);
    }

    await user.click(screen.getByRole('button', { name: /^שמור אדם$/ }));

    // Inline error rendered next to first_name input.
    await screen.findByText(/שם פרטי הוא שדה חובה/);
  });

  it('happy path: submits, shows success panel + friction-free CTA', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    await user.type(screen.getByLabelText(/שם פרטי/), 'Jane');
    await user.type(screen.getByLabelText(/שם משפחה/), 'Doe');
    // 'family' is the default for the relation select — leave it.
    await user.selectOptions(screen.getByLabelText(/^לקוח/), 'alpha');
    const targetSelect = screen.getByLabelText(/ישות ראשית/);
    const options = within(targetSelect).getAllByRole('option');
    await user.selectOptions(targetSelect, options[1].value);

    await user.click(screen.getByRole('button', { name: /^שמור אדם$/ }));

    // Success panel renders with the friction-free CTA.
    const panel = await screen.findByTestId('entity-success-panel');
    expect(within(panel).getByText(/האדם נוסף בהצלחה/)).toBeInTheDocument();
    expect(within(panel).getByText(/Jane Doe/)).toBeInTheDocument();
    expect(screen.getByTestId('entity-success-cta')).toBeInTheDocument();
  });

  it('friction-free CTA closes entity modal and opens phone modal pre-filled', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    // Build a valid submission.
    await user.type(screen.getByLabelText(/שם פרטי/), 'Sam');
    await user.selectOptions(screen.getByLabelText(/סוג קרבה/), 'colleague');
    await user.selectOptions(screen.getByLabelText(/^לקוח/), 'alpha');
    const targetSelect = screen.getByLabelText(/ישות ראשית/);
    const options = within(targetSelect).getAllByRole('option');
    await user.selectOptions(targetSelect, options[1].value);

    await user.click(screen.getByRole('button', { name: /^שמור אדם$/ }));
    await screen.findByTestId('entity-success-cta');

    // Click the friction-free CTA → phone modal opens, entity modal closes.
    await user.click(screen.getByTestId('entity-success-cta'));

    // The phone modal title (different from the entity modal) renders.
    await screen.findByText(/קליטת מספרי טלפון/);

    // Entity modal is no longer in the DOM.
    expect(screen.queryByText(/הוספת אדם חדש/)).not.toBeInTheDocument();

    // The phone modal's single-entry panel pre-fills entity_type with
    // the relation we just chose. The mock lead-form schema labels
    // the field 'Entity Type' (the backend's wire-format name);
    // verifying the select carries the preset value confirms the
    // friction-free handoff threaded the value through UIContext.
    await waitFor(() => {
      const entityTypeInput = screen.getByLabelText(/Entity Type/i);
      expect(entityTypeInput.value).toBe('colleague');
    });
  });

  it('cancel closes the modal without creating an entity', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    await user.type(screen.getByLabelText(/שם פרטי/), 'Discard');
    await user.click(screen.getByRole('button', { name: /^ביטול$/ }));

    expect(screen.queryByText(/הוספת אדם חדש/)).not.toBeInTheDocument();
    // No success toast either.
    expect(screen.queryByText(/האדם נוצר בהצלחה/)).not.toBeInTheDocument();
  });

  it('switching tabs reveals the corresponding panel (E2-D wired)', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openEntityModal(user);

    // Multi-text tab now renders the two-step grid's paste step.
    await user.click(screen.getByRole('tab', { name: /הדבקת רשימה/ }));
    expect(screen.getByTestId('entity-bulk-paste')).toBeInTheDocument();

    // File tab renders the dropzone.
    await user.click(screen.getByRole('tab', { name: /העלאת קובץ/ }));
    expect(screen.getByTestId('entity-file-dropzone')).toBeInTheDocument();
  });
});
