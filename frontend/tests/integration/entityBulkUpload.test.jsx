/**
 * Phase E2-D integration — entity file-upload (Tab 2) of EntityIngestionModal.
 *
 * Covers:
 *   - File tab renders the dropzone with the template-download button
 *   - .xlsx selection in mock mode surfaces a clear "use CSV" error
 *   - .csv happy path: header + valid rows → BulkResultPanel with N successes
 *   - Missing required column → 422-equivalent toast error
 *   - "Remove" button clears the selected file
 */

import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


async function openFileTab(user) {
  const openBtn = await screen.findByRole('button', { name: /הוסף אדם$/ });
  await user.click(openBtn);
  await screen.findByText(/הוספת אדם חדש/);
  await user.click(screen.getByRole('tab', { name: /העלאת קובץ/ }));
  await screen.findByTestId('entity-file-dropzone');
}


describe('Phase E2-D — entity bulk-upload (Tab 2)', () => {
  it('renders the dropzone + template-download button', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openFileTab(user);

    expect(screen.getByTestId('entity-file-dropzone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /הורד תבנית/ })).toBeInTheDocument();
  });

  it('happy path: a valid CSV ingests cleanly and shows the result panel', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openFileTab(user);

    // Target id 1 is one of the seeded root targets (Client Alpha).
    const csv = [
      'first_name,relation_type,target_entity_id,last_name',
      'Jane,family,1,Doe',
      'Sam,colleague,1,Chen',
    ].join('\n');
    const file = new File([csv], 'people.csv', { type: 'text/csv' });

    const input = screen.getByTestId('entity-file-input');
    await user.upload(input, file);

    // Submit. Button is enabled as soon as the file is staged.
    await user.click(screen.getByRole('button', { name: /^קלוט קובץ$/ }));

    const result = await screen.findByTestId('bulk-result-panel');
    // "No failed rows" empty-state proves failed_count == 0; both
    // input rows ingested. Avoid asserting on raw digits — the
    // stat cards repeat values across multiple cells.
    expect(within(result).getByText(/אין שורות שנכשלו/)).toBeInTheDocument();
  });

  it('csv missing required column → operator-friendly toast', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openFileTab(user);

    // Header is missing target_entity_id → backend would 422.
    const csv = 'first_name,relation_type,last_name\nJane,family,Doe\n';
    const file = new File([csv], 'people.csv', { type: 'text/csv' });

    await user.upload(screen.getByTestId('entity-file-input'), file);
    await user.click(screen.getByRole('button', { name: /^קלוט קובץ$/ }));

    // A toast appears (the application's ToastStack renders them). The
    // mock surfaces the missing-columns message verbatim from the
    // applyEntityBulkUploadCsv mutator.
    await waitFor(() => {
      expect(screen.getByText(/target_entity_id/)).toBeInTheDocument();
    });
  });

  it('xlsx in mock mode surfaces a "use CSV" error', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openFileTab(user);

    const xlsxFile = new File(['fake'], 'people.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByTestId('entity-file-input'), xlsxFile);
    await user.click(screen.getByRole('button', { name: /^קלוט קובץ$/ }));

    // The mock-mode error message contains the phrase "real backend"
    // (unique to the xlsx-in-mock branch) — much safer to assert on
    // than /csv/i which matches the dropzone hint too.
    await waitFor(() => {
      expect(screen.getByText(/real backend/i)).toBeInTheDocument();
    });
  });

  it('Remove button clears the selected file', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openFileTab(user);

    const csv = 'first_name,relation_type,target_entity_id\nJane,family,1\n';
    const file = new File([csv], 'people.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('entity-file-input'), file);

    // File chip visible.
    expect(screen.getByText('people.csv')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/^הסר$/));

    expect(screen.queryByText('people.csv')).not.toBeInTheDocument();
  });
});
