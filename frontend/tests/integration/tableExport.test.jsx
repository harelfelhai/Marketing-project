/**
 * Phase EXP integration — table export button + configurator modal.
 *
 * Covers:
 *   - Export button renders on /phones and /operations
 *   - Click fires a download (mock mode: CSV blob)
 *   - Current filters are honored in the exported CSV (filtered export)
 *   - Configurator modal opens, lists selected + available fields
 *   - Adding a field from "available" moves it into "selected"
 *   - Removing a field from "selected" moves it back
 *   - Reset to defaults restores the catalog defaults
 *   - Save-and-download persists the selection AND fires the export
 *   - Stale localStorage keys (catalog dropped them) don't crash
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';
import { PHONES_EXPORT_CATALOG, TASKS_EXPORT_CATALOG } from '../../src/config/exportCatalog';


// jsdom doesn't implement createObjectURL; stub it so the download
// helper doesn't crash. We track the last Blob handed in so tests
// can introspect the CSV payload.
let lastBlob = null;
beforeEach(() => {
  lastBlob = null;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((b) => { lastBlob = b; return 'blob:mock'; }),
    revokeObjectURL: vi.fn(),
  });
  // Clear any saved column selection from a previous test so each
  // test starts from the catalog defaults.
  try { localStorage.clear(); } catch { /* jsdom edge case */ }
});


async function readBlobText(blob) {
  // jsdom doesn't include Blob.text() in some versions — fall back to
  // FileReader where needed.
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}


// ---------------------------------------------------------------------------
// Button presence
// ---------------------------------------------------------------------------


describe('Phase EXP — button presence', () => {
  it('renders on the /phones page', async () => {
    renderApp({ route: '/phones' });
    expect(await screen.findByTestId('export-phones-button')).toBeInTheDocument();
  });

  it('renders on the /operations page', async () => {
    renderApp({ route: '/operations' });
    expect(await screen.findByTestId('export-tasks-button')).toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// Filtered export
// ---------------------------------------------------------------------------


describe('Phase EXP — filtered export', () => {
  it('exports only the filtered subset when a status filter is set', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByTestId('export-tasks-button');

    // Default-hide is ON → only active tasks are visible. SEED_TASKS:
    // 2 pending + 1 assigned = 3 visible. The export should carry
    // exclude_terminal through to the mock-parity filter and emit
    // exactly those 3 rows.
    await user.click(screen.getByTestId('export-tasks-button'));

    await waitFor(() => expect(lastBlob).not.toBeNull());
    const text = await readBlobText(lastBlob);
    const lines = text.trim().split('\n');
    // Header + 3 active task rows.
    expect(lines.length).toBe(1 + 3);
  });

  it('exports the full set when "Show resolved" is on', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByTestId('export-tasks-button');

    // Flip the show-resolved toggle.
    await user.click(screen.getByLabelText(/הצג משימות שטופלו/));

    await user.click(screen.getByTestId('export-tasks-button'));

    await waitFor(() => expect(lastBlob).not.toBeNull());
    const text = await readBlobText(lastBlob);
    const lines = text.trim().split('\n');
    // Header + all 5 seed tasks.
    expect(lines.length).toBe(1 + 5);
  });
});


// ---------------------------------------------------------------------------
// Configurator modal
// ---------------------------------------------------------------------------


describe('Phase EXP — configurator modal', () => {
  async function openConfigurator(user) {
    await screen.findByTestId('export-tasks-button');
    await user.click(screen.getByTestId('export-tasks-menu-toggle'));
    await user.click(screen.getByTestId('export-tasks-customize'));
    return screen.findByText(/התאם שדות לייצוא/);
  }

  it('opens the configurator from the chevron menu', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openConfigurator(user);

    // Both columns render.
    expect(screen.getByTestId('export-selected-list')).toBeInTheDocument();
    expect(screen.getByTestId('export-available-list')).toBeInTheDocument();
  });

  it('default selected list matches catalog.defaults', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openConfigurator(user);

    const list = screen.getByTestId('export-selected-list');
    for (const key of TASKS_EXPORT_CATALOG.defaults) {
      expect(within(list).getByTestId(`export-selected-${key}`)).toBeInTheDocument();
    }
  });

  it('adding a field from "available" moves it into "selected"', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openConfigurator(user);

    // `id` isn't in defaults — should be on the available side.
    const availableId = await screen.findByTestId('export-available-id');
    expect(availableId).toBeInTheDocument();

    // Click the add button on that row.
    await user.click(within(availableId).getByRole('button'));

    // It now appears under "selected".
    expect(screen.getByTestId('export-selected-id')).toBeInTheDocument();
    expect(screen.queryByTestId('export-available-id')).not.toBeInTheDocument();
  });

  it('removing a field from "selected" moves it back', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openConfigurator(user);

    // task_type is in defaults → currently selected.
    const selected = screen.getByTestId('export-selected-task_type');
    // Find the × button (aria-label contains "הסר").
    const removeBtn = within(selected).getByLabelText(/הסר/);
    await user.click(removeBtn);

    expect(screen.queryByTestId('export-selected-task_type')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-available-task_type')).toBeInTheDocument();
  });

  it('reset restores the catalog defaults', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openConfigurator(user);

    // Remove a default column.
    const selected = screen.getByTestId('export-selected-task_type');
    await user.click(within(selected).getByLabelText(/הסר/));
    expect(screen.queryByTestId('export-selected-task_type')).not.toBeInTheDocument();

    // Reset.
    await user.click(screen.getByText(/אפס לברירת מחדל/));

    // task_type back in selected.
    expect(screen.getByTestId('export-selected-task_type')).toBeInTheDocument();
  });

  it('save and download persists selection AND fires the export', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await openConfigurator(user);

    // Add a non-default column.
    const availableId = screen.getByTestId('export-available-id');
    await user.click(within(availableId).getByRole('button'));

    // Save-and-download.
    await user.click(screen.getByTestId('export-modal-save'));

    // Blob should have been emitted.
    await waitFor(() => expect(lastBlob).not.toBeNull());

    // localStorage persisted the new selection.
    const persisted = JSON.parse(localStorage.getItem('tableExport:tasks:v1'));
    expect(persisted).toContain('id');
    expect(persisted).toContain('task_type');
  });
});


// ---------------------------------------------------------------------------
// Resilience — stale localStorage keys
// ---------------------------------------------------------------------------


describe('Phase EXP — resilience', () => {
  it('stale localStorage keys (no longer in the catalog) are silently dropped', async () => {
    // Seed localStorage with a key the catalog no longer has.
    localStorage.setItem(
      'tableExport:tasks:v1',
      JSON.stringify(['task_type', 'no_such_key_anywhere', 'status']),
    );

    const user = userEvent.setup();
    renderApp({ route: '/operations' });
    await screen.findByTestId('export-tasks-button');

    // Click to export — the stale key should be filtered out by
    // buildExportColumns before the wire request, and the export
    // succeeds.
    await user.click(screen.getByTestId('export-tasks-button'));
    await waitFor(() => expect(lastBlob).not.toBeNull());

    // CSV header has labels for the two valid keys, NOT for the
    // stale one (which has no label in the catalog).
    const text = await readBlobText(lastBlob);
    const header = text.split('\n')[0];
    expect(header).toContain('סוג משימה');   // task_type label
    expect(header).toContain('סטטוס');        // status label
    // The stale key never made it into the request → no spurious
    // empty / "no_such" column header.
    expect(header).not.toContain('no_such_key_anywhere');
  });
});


// ---------------------------------------------------------------------------
// Phones — smoke (one happy-path test to confirm cross-table coverage)
// ---------------------------------------------------------------------------


describe('Phase EXP — phones smoke', () => {
  it('exports the phones table on demand', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/phones' });
    await screen.findByTestId('export-phones-button');

    await user.click(screen.getByTestId('export-phones-button'));
    await waitFor(() => expect(lastBlob).not.toBeNull());

    const text = await readBlobText(lastBlob);
    const header = text.split('\n')[0];
    // Default phones columns produce a recognizable header.
    expect(header).toContain('מספר טלפון');
    // Catalog still aligned with the defaults constant.
    expect(PHONES_EXPORT_CATALOG.defaults).toContain('phone_number');
  });
});
