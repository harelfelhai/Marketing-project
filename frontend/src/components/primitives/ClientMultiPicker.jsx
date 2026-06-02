/**
 * ClientMultiPicker — searchable combobox for selecting one or more
 * clients from CLIENT_REGISTRY.
 *
 * UX:
 *   - Single input field. Typing filters CLIENT_REGISTRY by name +
 *     shortName (case-insensitive, substring).
 *   - The filtered list appears as a dropdown below; clicking a row
 *     adds that client to the `selected` set and clears the input.
 *   - Selected clients render as removable chips ABOVE the input.
 *   - Keyboard:
 *       ↓ / ↑       move highlight in the dropdown
 *       Enter       add the highlighted row
 *       Backspace   on empty input removes the last chip (fast undo)
 *       Esc         closes the dropdown
 *
 * Scales to hundreds of entries because:
 *   - The dropdown is capped at 50 visible rows (further typing
 *     narrows it). For a 5-client demo the cap is a no-op.
 *   - The selected chips array is the source of truth — no second
 *     state copy of the registry.
 *
 * Controlled component. Parent owns `selected` (a Set of integer ids)
 * and provides `onChange(nextSet)`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

import { CLIENT_REGISTRY } from '../../config/clientRegistry';
import { useMockData } from '../../contexts/MockDataContext';
import {
  AUTH_CLIENT_PICKER_PLACEHOLDER,
  AUTH_CLIENT_PICKER_EMPTY,
  AUTH_CLIENT_PICKER_REMOVE_ARIA,
} from '../../config/strings.he';


const MAX_VISIBLE_RESULTS = 50;


export default function ClientMultiPicker({
  selected,
  onChange,
  disabled = false,
  inputId,
  'data-testid': testId = 'client-multi-picker',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef(null);
  const inputRef   = useRef(null);

  // Source of truth for selectable clients = the live clients slice
  // (derived from root entities by MockDataContext). Falls back to
  // CLIENT_REGISTRY when the context isn't mounted (e.g. unit tests
  // that render this component in isolation).
  const ctx = useMockData();
  const registry = ctx?.clients?.length ? ctx.clients : CLIENT_REGISTRY;

  // Filter the registry: exclude already-selected ids, then substring
  // match on name + shortName. Sorted by registry order for stability.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    for (const c of registry) {
      if (selected.has(c.id)) continue;
      if (!q) { out.push(c); continue; }
      const hay = `${c.name} ${c.shortName || ''}`.toLowerCase();
      if (hay.includes(q)) out.push(c);
    }
    return out.slice(0, MAX_VISIBLE_RESULTS);
  }, [query, selected, registry]);

  // Keep the highlighted index in-range when the result set shrinks.
  useEffect(() => {
    if (highlightIndex >= filtered.length) setHighlightIndex(0);
  }, [filtered.length, highlightIndex]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedClients = useMemo(
    () => registry.filter((c) => selected.has(c.id)),
    [selected, registry]
  );

  const addClient = (id) => {
    const next = new Set(selected);
    next.add(id);
    onChange(next);
    setQuery('');
    setHighlightIndex(0);
    // Keep focus in the input for rapid multi-add.
    inputRef.current?.focus();
  };

  const removeClient = (id) => {
    const next = new Set(selected);
    next.delete(id);
    onChange(next);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlightIndex];
      if (pick) addClient(pick.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && selectedClients.length > 0) {
      // Quick-undo: empty input + Backspace pops the last chip.
      const last = selectedClients[selectedClients.length - 1];
      removeClient(last.id);
    }
  };

  return (
    <div ref={wrapperRef} className="relative" data-testid={testId}>
      {/* Selected chips */}
      {selectedClients.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selectedClients.map((c) => (
            <span
              key={c.id}
              data-testid={`client-chip-${c.id}`}
              className="inline-flex items-center gap-1 ps-2 pe-1 h-7 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-700"
            >
              {c.name}
              <button
                type="button"
                onClick={() => removeClient(c.id)}
                disabled={disabled}
                aria-label={AUTH_CLIENT_PICKER_REMOVE_ARIA(c.name)}
                data-testid={`client-chip-${c.id}-remove`}
                className="ms-0.5 w-4 h-4 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={AUTH_CLIENT_PICKER_PLACEHOLDER}
          disabled={disabled}
          autoComplete="off"
          data-testid={`${testId}-input`}
          className="block w-full h-9 ps-2 pe-7 rounded-md border border-slate-300 text-sm focus:border-slate-500 focus:outline-none disabled:opacity-50"
        />
        <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>

      {/* Dropdown */}
      {open && !disabled && (
        <div
          role="listbox"
          data-testid={`${testId}-listbox`}
          className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              {AUTH_CLIENT_PICKER_EMPTY}
            </div>
          ) : (
            filtered.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={idx === highlightIndex}
                onMouseEnter={() => setHighlightIndex(idx)}
                onClick={() => addClient(c.id)}
                data-testid={`client-option-${c.id}`}
                className={[
                  'w-full flex items-center justify-between px-3 py-1.5 text-sm text-start',
                  idx === highlightIndex
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                <span className="truncate">{c.name}</span>
                {c.shortName && (
                  <span className="text-[11px] text-slate-400 ms-2 shrink-0">
                    {c.shortName}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
