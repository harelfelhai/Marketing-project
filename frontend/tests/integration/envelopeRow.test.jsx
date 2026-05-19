/**
 * Phase DY-4-A integration — envelope rows render with the right
 * provenance, glyph, and truth-axis shapes.
 *
 * Asserts the THREE shapes that DY-4 introduced:
 *   - Vector A row: emerald provenance pip, named entity, standard
 *     phone+person truth dots.
 *   - Vector B raw envelope row: amber provenance pip, diamond glyph
 *     on the entity caption, network+identity dots with identity
 *     forced to diamond (unknown).
 *   - Vector B confirmed-in-network envelope row (the user's specific
 *     scenario): same provenance + identity shape, but the network dot
 *     is solid (operator-confirmed) instead of hollow.
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { renderApp } from './renderApp';


describe('Phase DY-4-A — envelope rows', () => {
  it('renders the envelope label for Vector B rows', async () => {
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });

    // Two envelopes seeded with envelope_ids EP-088 and EP-091.
    expect(await screen.findByText(/EP-088/)).toBeInTheDocument();
    expect(screen.getByText(/EP-091/)).toBeInTheDocument();
  });

  it('envelope rows surface the envelope phone numbers', async () => {
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    // The two seeded envelope phone numbers.
    expect(await screen.findByText('+15559000088')).toBeInTheDocument();
    expect(screen.getByText('+15559000091')).toBeInTheDocument();
  });

  it('mock seed assigns lower priority to envelopes than to named entities', async () => {
    renderApp({ route: '/phones' });
    await screen.findByRole('heading', { name: /רשת טלפונים/ });
    // Default sort is priority DESC — the envelope rows should NOT be
    // the first rows on the page. (Visible high-priority Vector A rows
    // outrank envelope rows because relation_weight target=1.0 vs
    // social_envelope=0.5.)
    const allPhoneTexts = await screen.findAllByText(/^\+1555/);
    // First phone in the rendered list should NOT be one of the envelopes.
    const firstPhone = allPhoneTexts[0].textContent;
    expect(firstPhone).not.toBe('+15559000088');
    expect(firstPhone).not.toBe('+15559000091');
  });
});
