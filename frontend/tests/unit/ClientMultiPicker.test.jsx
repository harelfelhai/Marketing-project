/**
 * ClientMultiPicker — searchable combobox primitive.
 *
 * The picker is small but the keyboard + chip semantics matter, so
 * the high-value cases live here as a dedicated unit test rather
 * than being only exercised through RegisterPage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// ClientMultiPicker sources its selectable clients from MockDataContext (the
// live clients slice derived from root entities). Mock the hook so the picker
// can be exercised in isolation with a deterministic client list. `bag` is
// hoisted so individual tests can swap the list (e.g. the 100-client case).
const bag = vi.hoisted(() => ({
  clients: [
    { id: 'ent-1',  name: 'Alpha' },
    { id: 'ent-9',  name: 'Beta'  },
    { id: 'ent-17', name: 'Gamma' },
  ],
}));
vi.mock('../../src/contexts/MockDataContext', () => ({
  useMockData: () => ({ clients: bag.clients }),
}));

import ClientMultiPicker from '../../src/components/primitives/ClientMultiPicker';


beforeEach(() => {
  bag.clients = [
    { id: 'ent-1',  name: 'Alpha' },
    { id: 'ent-9',  name: 'Beta'  },
    { id: 'ent-17', name: 'Gamma' },
  ];
});


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
    await user.click(screen.getByTestId('client-option-ent-1'));

    expect(screen.getByTestId('client-chip-ent-1')).toBeInTheDocument();
    // After picking, the same option is no longer in the dropdown.
    expect(screen.queryByTestId('client-option-ent-1')).not.toBeInTheDocument();
  });

  it('removes a chip when the X is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness initial={new Set(['ent-1', 'ent-9'])} />);

    expect(screen.getByTestId('client-chip-ent-1')).toBeInTheDocument();
    expect(screen.getByTestId('client-chip-ent-9')).toBeInTheDocument();

    await user.click(screen.getByTestId('client-chip-ent-1-remove'));
    expect(screen.queryByTestId('client-chip-ent-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('client-chip-ent-9')).toBeInTheDocument();
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
    expect(screen.getByTestId('client-option-ent-17')).toBeInTheDocument();
    expect(screen.queryByTestId('client-option-ent-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('client-option-ent-9')).not.toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.type(input, 'ALPHA');

    expect(screen.getByTestId('client-option-ent-1')).toBeInTheDocument();
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

    expect(screen.getByTestId('client-chip-ent-9')).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('Backspace on empty input removes the last chip', async () => {
    const user = userEvent.setup();
    render(<Harness initial={new Set(['ent-1', 'ent-9'])} />);

    const input = screen.getByTestId('client-multi-picker-input');
    await user.click(input);
    await user.keyboard('{Backspace}');

    // Last chip (id=9) is gone; first chip remains.
    expect(screen.queryByTestId('client-chip-ent-9')).not.toBeInTheDocument();
    expect(screen.getByTestId('client-chip-ent-1')).toBeInTheDocument();
  });
});


describe('ClientMultiPicker — full client list (regression: 50-row cap)', () => {
  it('renders all 100 root-entity clients, not just the first 50', async () => {
    bag.clients = Array.from({ length: 100 }, (_, i) => ({
      id: `ent-${i + 1}`,
      name: `Client ${i + 1}`,
    }));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByTestId('client-multi-picker-input'));

    // The previously-capped tail must be present (ids 51 and 100).
    expect(screen.getByTestId('client-option-ent-51')).toBeInTheDocument();
    expect(screen.getByTestId('client-option-ent-100')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(100);
  });
});
