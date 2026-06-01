/**
 * ClientMultiPicker — searchable combobox primitive.
 *
 * The picker is small but the keyboard + chip semantics matter, so
 * the high-value cases live here as a dedicated unit test rather
 * than being only exercised through RegisterPage.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import ClientMultiPicker from '../../src/components/primitives/ClientMultiPicker';


function Harness({ initial = new Set() } = {}) {
  const [selected, setSelected] = useState(initial);
  return (
    <ClientMultiPicker
      selected={selected}
      onChange={setSelected}
    />
  );
}


describe('ClientMultiPicker — basic add/remove', () => {
  it('adds a client when an option is clicked, then surfaces a chip', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId('client-multi-picker-input'));
    await user.click(screen.getByTestId('client-option-1'));

    expect(screen.getByTestId('client-chip-1')).toBeInTheDocument();
    // After picking, the same option is no longer in the dropdown.
    expect(screen.queryByTestId('client-option-1')).not.toBeInTheDocument();
  });

  it('removes a chip when the X is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness initial={new Set([1, 9])} />);

    expect(screen.getByTestId('client-chip-1')).toBeInTheDocument();
    expect(screen.getByTestId('client-chip-9')).toBeInTheDocument();

    await user.click(screen.getByTestId('client-chip-1-remove'));
    expect(screen.queryByTestId('client-chip-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('client-chip-9')).toBeInTheDocument();
  });
});


describe('ClientMultiPicker — search filtering', () => {
  it('typing narrows the dropdown to substring matches on name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.type(input, 'gamma');

    // Only Gamma (id=17) survives.
    expect(screen.getByTestId('client-option-17')).toBeInTheDocument();
    expect(screen.queryByTestId('client-option-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('client-option-9')).not.toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.type(input, 'ALPHA');

    expect(screen.getByTestId('client-option-1')).toBeInTheDocument();
  });

  it('shows the empty-results message when no client matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.type(input, 'zzz-no-match');

    expect(screen.getByText(/לא נמצאו לקוחות תואמים/)).toBeInTheDocument();
  });
});


describe('ClientMultiPicker — keyboard', () => {
  it('Enter adds the highlighted option and clears the query', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.type(input, 'beta{Enter}');

    expect(screen.getByTestId('client-chip-9')).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('Backspace on empty input removes the last chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={new Set([1, 9])} />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.keyboard('{Backspace}');

    // Last chip (id=9) is gone; first chip remains.
    expect(screen.queryByTestId('client-chip-9')).not.toBeInTheDocument();
    expect(screen.getByTestId('client-chip-1')).toBeInTheDocument();
  });
});
