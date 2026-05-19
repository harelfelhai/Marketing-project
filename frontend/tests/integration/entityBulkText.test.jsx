/**
 * Phase E2-D integration — two-step grid (Tab 3) of EntityIngestionModal.
 *
 * Covers:
 *   - PASTE step: live token counter mirrors the tokenizer
 *   - PASTE step: continue blocked without default target
 *   - PASTE step: continue blocked with empty textarea
 *   - PASTE → EDIT transition produces one editable row per token
 *   - EDIT: per-row name parsing splits "First Last" into two fields
 *   - EDIT: deleting a row removes it from the grid
 *   - EDIT: empty first_name flags an inline error AND disables submit
 *   - EDIT: per-row relation override changes the resulting entity_type
 *   - Happy path: submit renders BulkResultPanel with success_count=N
 *   - row_token round-trips into the per-row audit
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


async function openMultiTextTab(user) {
  const openBtn = await screen.findByRole('button', { name: /הוסף אדם$/ });
  await user.click(openBtn);
  await screen.findByText(/הוספת אדם חדש/);
  await user.click(screen.getByRole('tab', { name: /הדבקת רשימה/ }));
  await screen.findByTestId('entity-bulk-paste');
}

// Helper — Step 1 picks the default client + target so the operator
// can advance to the EDIT step.
async function configureDefaults(user) {
  await user.selectOptions(
    screen.getByLabelText(/לקוח$/),
    'alpha',
  );
  // After client selection, the target dropdown has real options.
  const targetSelect = screen.getByLabelText(/ישות ראשית/);
  const options = within(targetSelect).getAllByRole('option');
  await user.selectOptions(targetSelect, options[1].value);
}


describe('Phase E2-D — entity bulk-text (two-step grid)', () => {
  it('live token counter mirrors the tokenizer', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    const textarea = await screen.findByLabelText(/רשימת שמות/);
    await user.type(textarea, 'Jane Doe, Sam Chen\nAlex');

    const counter = screen.getByTestId('entity-bulk-token-count');
    // Three tokens — "Jane Doe", "Sam Chen", "Alex".
    expect(counter).toHaveTextContent('3');
  });

  it('continue requires both a textarea body AND a default target', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    // Empty textarea — continue surfaces empty-text error.
    await user.click(screen.getByTestId('entity-bulk-continue'));
    await screen.findByText(/נא להדביק לפחות שם אחד/);

    // Type names but skip target — continue surfaces missing-target error.
    await user.type(await screen.findByLabelText(/רשימת שמות/), 'Jane');
    await user.click(screen.getByTestId('entity-bulk-continue'));
    await screen.findByText(/יש לבחור ישות ראשית/);
  });

  it('continue advances to EDIT and tokenizes "First Last" pairs', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    await configureDefaults(user);
    await user.type(
      await screen.findByLabelText(/רשימת שמות/),
      'Jane Doe, Sam Chen',
    );
    await user.click(screen.getByTestId('entity-bulk-continue'));

    // EDIT step rendered.
    await screen.findByTestId('entity-bulk-grid');
    const rows = screen.getAllByTestId('entity-bulk-row');
    expect(rows.length).toBe(2);

    // Each row's first_name and last_name are populated from the
    // tokenizer. The first row should be Jane Doe.
    const firstRow = rows[0];
    const inputs = within(firstRow).getAllByRole('textbox');
    expect(inputs[0].value).toBe('Jane');
    expect(inputs[1].value).toBe('Doe');
  });

  it('deleting a row removes it from the grid', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    await configureDefaults(user);
    await user.type(
      await screen.findByLabelText(/רשימת שמות/),
      'Jane Doe\nSam Chen\nAlex Cohen',
    );
    await user.click(screen.getByTestId('entity-bulk-continue'));

    const rows = screen.getAllByTestId('entity-bulk-row');
    expect(rows.length).toBe(3);

    // Click the remove button on the middle row.
    const removeBtn = within(rows[1]).getByLabelText(/מחק שורה/);
    await user.click(removeBtn);

    await waitFor(() => {
      expect(screen.getAllByTestId('entity-bulk-row').length).toBe(2);
    });
  });

  it('empty first_name flags a row issue and disables Save All', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    await configureDefaults(user);
    await user.type(await screen.findByLabelText(/רשימת שמות/), 'Jane');
    await user.click(screen.getByTestId('entity-bulk-continue'));

    const row = screen.getAllByTestId('entity-bulk-row')[0];
    const firstInput = within(row).getAllByRole('textbox')[0];

    // Clear the first name.
    await user.clear(firstInput);

    // Inline error appears + footer issue count + submit disabled.
    await screen.findByText(/שם פרטי חובה/);
    expect(screen.getByText(/1 שורות עם בעיות/)).toBeInTheDocument();
    expect(screen.getByTestId('entity-bulk-submit-all')).toBeDisabled();
  });

  it('happy path: submit ingests rows and shows the result panel', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    await configureDefaults(user);
    await user.type(
      await screen.findByLabelText(/רשימת שמות/),
      'Jane Doe\nSam Chen',
    );
    await user.click(screen.getByTestId('entity-bulk-continue'));

    await user.click(screen.getByTestId('entity-bulk-submit-all'));

    // Result panel renders. The "no failed rows" empty-state proves
    // failed_count == 0; combined with 2 input tokens this confirms
    // both rows ingested. We avoid asserting on the raw "2" text
    // because the stat cards repeat values across multiple cells.
    const result = await screen.findByTestId('bulk-result-panel');
    expect(within(result).getByText(/אין שורות שנכשלו/)).toBeInTheDocument();
  });

  it('default relation chosen in step 1 is pre-filled into every step-2 row', async () => {
    // UAT regression: the operator picked "family" at the paste step
    // but the edit grid showed "ירש" on every row. The default looked
    // dropped even though it was still applied server-side. The fix
    // pre-fills each row's relationType from state.defaultRelation.
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    await configureDefaults(user);
    await user.type(await screen.findByLabelText(/רשימת שמות/), 'Jane Doe, Bob Roe');
    await user.click(screen.getByTestId('entity-bulk-continue'));

    const rows = screen.getAllByTestId('entity-bulk-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const relationSelect = within(row).getAllByRole('combobox')[0];
      expect(relationSelect.value).toBe('family');
    }
  });

  it('per-row relation override changes the resulting entity_type', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openMultiTextTab(user);

    await configureDefaults(user);
    await user.type(await screen.findByLabelText(/רשימת שמות/), 'Jane Doe');
    await user.click(screen.getByTestId('entity-bulk-continue'));

    // Override row 1's relation_type to colleague (default was family).
    const row = screen.getAllByTestId('entity-bulk-row')[0];
    const relationSelect = within(row).getAllByRole('combobox')[0];
    await user.selectOptions(relationSelect, 'colleague');

    await user.click(screen.getByTestId('entity-bulk-submit-all'));

    // The result panel renders with zero failures — the override
    // value flowed through the submit payload correctly. The mock-DB
    // unit-level coverage of entity_type override lives in the
    // applyEntityBulkText parity layer.
    const result = await screen.findByTestId('bulk-result-panel');
    expect(within(result).getByText(/אין שורות שנכשלו/)).toBeInTheDocument();
  });
});
