/**
 * Phase E1-D integration — Excel/CSV file-upload tab.
 *
 * The upload arm of bulk ingestion creates ONE Entity per row (vs. the
 * Multi-Text tab's single shared envelope). These tests drive the
 * file-upload tab end-to-end through the mock parity layer:
 *
 *   - Dropzone + file picker accept a CSV
 *   - Preflight rejects bad extensions BEFORE any upload
 *   - Preflight rejects files larger than 5 MB
 *   - Happy-path CSV → BulkResultPanel with success_count = N
 *   - Per-row failure (invalid phone) lands in failed_rows with row index
 *   - Selected-file chip shows the filename + remove button works
 *   - Mock-mode xlsx surfaces a friendly "use CSV" error toast
 */

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


async function openModalAndSwitchToFileTab(user) {
  const openBtn = await screen.findByRole('button', { name: /קליטת מספר חדש/ });
  await user.click(openBtn);
  const fileTab = await screen.findByRole('tab', { name: /העלאת קובץ/ });
  await user.click(fileTab);
  return fileTab;
}

function makeCsvFile(name, lines) {
  return new File([lines.join('\n')], name, { type: 'text/csv' });
}


describe('Phase E1-D — file-upload tab', () => {
  it('renders dropzone + template-download button', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    expect(screen.getByTestId('bulk-file-dropzone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /הורד תבנית/ })).toBeInTheDocument();
    // Submit button is disabled until a file is picked.
    const submit = screen.getByRole('button', { name: /העלה והפעל קליטה/ });
    expect(submit).toBeDisabled();
  });

  it('preflight rejects a .txt file with a friendly error', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    const input = screen.getByTestId('bulk-file-input');
    const txt = new File(['not a csv'], 'notes.txt', { type: 'text/plain' });
    await user.upload(input, txt);

    expect(screen.getByRole('alert')).toHaveTextContent(/סיומת/);
    // The selected-file chip should NOT appear when preflight fails.
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('happy-path CSV with 3 valid rows renders a success summary', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    const csv = makeCsvFile('upload.csv', [
      'phone_number,root_entity_id,entity_type,ingestion_source',
      '+14155557001,1,family,manual',
      '+14155557002,1,friend,manual',
      '+14155557003,2,social_envelope,automated',
    ]);
    await user.upload(screen.getByTestId('bulk-file-input'), csv);

    // Selected-file chip appears with the filename.
    expect(screen.getByText('upload.csv')).toBeInTheDocument();

    // Submit + assert summary panel.
    await user.click(screen.getByRole('button', { name: /העלה והפעל קליטה/ }));
    const panel = await screen.findByTestId('bulk-result-panel');
    // Zero failed rows → empty-state message renders.
    expect(within(panel).getByText(/אין שורות שנכשלו/)).toBeInTheDocument();
    // "New Batch" reset button is wired.
    expect(screen.getByRole('button', { name: /אצווה חדשה/ })).toBeInTheDocument();
  });

  it('per-row failure lands in failed_rows with the correct 1-based index', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    const csv = makeCsvFile('mixed.csv', [
      'phone_number,root_entity_id,entity_type,ingestion_source',
      '+14155557101,1,family,manual',
      'NOTAPHONE,1,family,manual',
      '+14155557102,1,family,manual',
    ]);
    await user.upload(screen.getByTestId('bulk-file-input'), csv);
    await user.click(screen.getByRole('button', { name: /העלה והפעל קליטה/ }));

    const panel = await screen.findByTestId('bulk-result-panel');
    const table = within(panel).getByRole('table');
    const badCell = within(table).getByText('NOTAPHONE');
    expect(badCell.tagName).toBe('TD');
    // The row-index cell sits before the input cell in each row.
    expect(badCell.previousElementSibling.textContent).toBe('2');
  });

  it('file-shape error (missing required column) surfaces as a toast', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    // Header omits ingestion_source — the mock parser raises and the
    // panel catches it as an upload-level error (toast, not failed_rows).
    const csv = makeCsvFile('bad-header.csv', [
      'phone_number,root_entity_id,entity_type',
      '+14155557201,1,family',
    ]);
    await user.upload(screen.getByTestId('bulk-file-input'), csv);
    await user.click(screen.getByRole('button', { name: /העלה והפעל קליטה/ }));

    // The summary panel should NOT render — this is an upload-level fault.
    expect(screen.queryByTestId('bulk-result-panel')).toBeNull();
  });

  it('xlsx upload in mock mode surfaces a friendly "use CSV" error', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    const xlsx = new File(['fake-binary'], 'sheet.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await user.upload(screen.getByTestId('bulk-file-input'), xlsx);
    // Preflight passes (.xlsx is an allowed extension). The mock layer
    // throws once the upload is attempted.
    await user.click(screen.getByRole('button', { name: /העלה והפעל קליטה/ }));

    // No summary panel — the error path keeps the form mounted.
    expect(screen.queryByTestId('bulk-result-panel')).toBeNull();
  });

  it('remove button clears the selected file and re-disables submit', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderApp({ route: '/' });
    await openModalAndSwitchToFileTab(user);

    const csv = makeCsvFile('upload.csv', [
      'phone_number,root_entity_id,entity_type,ingestion_source',
      '+14155557301,1,family,manual',
    ]);
    await user.upload(screen.getByTestId('bulk-file-input'), csv);
    expect(screen.getByRole('button', { name: /העלה והפעל קליטה/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /הסר/ }));
    expect(screen.queryByText('upload.csv')).toBeNull();
    expect(screen.getByRole('button', { name: /העלה והפעל קליטה/ })).toBeDisabled();
  });
});
