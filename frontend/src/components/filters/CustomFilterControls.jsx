/**
 * CustomFilterControls — generic renderer for admin-defined custom filters.
 *
 * Shared by every filterable surface (phones / operations / entities) so the
 * custom filters render inline, in the same bar, as the built-in catalog
 * controls — no separate "custom filters" UI region. Each descriptor renders
 * as a text input (substring match) or a select (equality), driven entirely
 * by config (src/config/customFilters.js); there is no per-key JSX.
 *
 * Values live in UIContext.customFilterValues[surface]; this component is
 * presentational — the parent supplies `values` and an `onChange(partial)`.
 */

import { Filter } from 'lucide-react';

import { CUSTOM_FILTER_ALL } from '../../config/strings.he';

const SELECT_CLASS =
  'h-9 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-800 ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-0';

export default function CustomFilterControls({ descriptors, values, onChange }) {
  if (!descriptors?.length) return null;

  return descriptors.map((d) => {
    const value = values?.[d.key] ?? '';

    if (d.widget === 'select') {
      return (
        <select
          key={d.key}
          aria-label={d.label}
          data-testid={`custom-filter-${d.key}`}
          value={value}
          onChange={(e) => onChange({ [d.key]: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">{d.label} — {CUSTOM_FILTER_ALL}</option>
          {d.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label || o.value}</option>
          ))}
        </select>
      );
    }

    return (
      <div key={d.key} className="relative min-w-[160px]">
        <Filter className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          aria-label={d.label}
          data-testid={`custom-filter-${d.key}`}
          value={value}
          onChange={(e) => onChange({ [d.key]: e.target.value })}
          placeholder={d.label}
          className="w-full h-9 pr-8 ps-3 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>
    );
  });
}
