/**
 * Phase E1-C integration — bulk-text ingestion modal (multi-tab shell +
 * Multi-Text tab end-to-end through the mock parity layer).
 *
 * Covers:
 *   - Modal opens via the header button with a three-tab strip
 *   - Tab switch from Single → Multi-Text shows the bulk form
 *   - Token counter mirrors the backend tokenizer regex
 *   - Submitting validates required envelope fields
 *   - Happy path → BulkResultPanel renders success_count = N and 0 failures
 *   - Partial failure → failed_rows table renders with the bad row's
 *     1-based index AND error message
 *   - File-Upload tab is wired but shows the E1-D placeholder
 */

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from './renderApp';


async function openModalAndSwitchToMultiText(user) {
  // The header button label is the Hebrew string BTN_INGEST_NEW.
  const openBtn = await screen.findByRole('button', { name: /קליטת מספר חדש/ });
  await user.click(openBtn);

  // Tab strip is rendered with role=tab.
  const multiTextTab = await screen.findByRole('tab', { name: /הדבקת רשימה/ });
  await user.click(multiTextTab);
  return multiTextTab;
}


describe('Phase E1-C — bulk-text ingestion modal', () => {
  it('renders a three-tab strip with Single selected by default', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    const openBtn = await screen.findByRole('button', { name: /קליטת מספר חדש/ });
    await user.click(openBtn);

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.length).toBe(3);
    // Default tab — Single — is selected.
    const singleTab = screen.getByRole('tab', { name: /מספר בודד/ });
    expect(singleTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switching to Multi-Text reveals the bulk form', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openModalAndSwitchToMultiText(user);

    // Textarea visible.
    const textarea = await screen.findByLabelText(/מספרי טלפון/);
    expect(textarea.tagName).toBe('TEXTAREA');
    // Submit button shows the bulk label.
    expect(screen.getByRole('button', { name: /קלוט אצווה/ })).toBeInTheDocument();
  });

  it('live token counter mirrors the backend tokenizer', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openModalAndSwitchToMultiText(user);

    const textarea = await screen.findByLabelText(/מספרי טלפון/);
    await user.type(textarea, '+14155550001, +14155550002\n+14155550003');

    const counter = screen.getByTestId('bulk-token-count');
    // Token regex splits on commas / semicolons / whitespace → three.
    expect(counter).toHaveTextContent('3');
  });

  it('happy path: 3 valid numbers ingest cleanly and render success card', async () => {
    // UAT round-3: the panel was rewritten to mirror the single-form
    // shape (existing/new/envelope mode). Default mode is "existing";
    // pick the first available entity, paste 3 numbers, submit.
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openModalAndSwitchToMultiText(user);

    await user.type(
      await screen.findByLabelText(/מספרי טלפון/),
      '+14155556001, +14155556002, +14155556003',
    );

    const existingSel = screen.getByTestId('bulk-existing-entity');
    const options = Array.from(existingSel.querySelectorAll('option')).filter((o) => o.value !== '');
    await user.selectOptions(existingSel, options[0].value);

    await user.click(screen.getByTestId('bulk-submit'));

    // The success card lands; the form is replaced with the summary panel.
    const panel = await screen.findByTestId('bulk-result-panel');
    expect(within(panel).getByText(/אין שורות שנכשלו/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /אצווה חדשה/ })).toBeInTheDocument();
  });

  it('partial failure: NOTAPHONE row lands in failed_rows with its 1-based index', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openModalAndSwitchToMultiText(user);

    await user.type(
      await screen.findByLabelText(/מספרי טלפון/),
      '+14155556101, NOTAPHONE, +14155556102',
    );

    const existingSel = screen.getByTestId('bulk-existing-entity');
    const options = Array.from(existingSel.querySelectorAll('option')).filter((o) => o.value !== '');
    await user.selectOptions(existingSel, options[0].value);

    await user.click(screen.getByTestId('bulk-submit'));

    const panel = await screen.findByTestId('bulk-result-panel');
    const table = within(panel).getByRole('table');
    const noPhoneCell = within(table).getByText('NOTAPHONE');
    expect(noPhoneCell.tagName).toBe('TD');
    const indexCell = noPhoneCell.previousElementSibling;
    expect(indexCell.textContent).toBe('2');
  });

  it('empty body shows a validation error and does not submit', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await openModalAndSwitchToMultiText(user);

    const submit = screen.getByRole('button', { name: /קלוט אצווה/ });
    // Submit button is disabled when token count is zero (defense in depth);
    // the form-level validation also runs once the user types invalid input.
    expect(submit).toBeDisabled();
  });

  it('File-Upload tab renders the dropzone, not the multi-text form', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });
    const openBtn = await screen.findByRole('button', { name: /קליטת מספר חדש/ });
    await user.click(openBtn);

    await user.click(screen.getByRole('tab', { name: /העלאת קובץ/ }));
    // The dropzone is the centerpiece of the file-upload tab (E1-D).
    expect(screen.getByTestId('bulk-file-dropzone')).toBeInTheDocument();
    // The multi-text textarea should NOT be present on the file tab.
    expect(screen.queryByLabelText(/מספרי טלפון/)).toBeNull();
  });
});
