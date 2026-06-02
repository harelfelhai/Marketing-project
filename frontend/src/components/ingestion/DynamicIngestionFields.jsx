/**
 * DynamicIngestionFields — renders the admin-defined dynamic ingestion fields
 * (config-driven, no per-key JSX) as labeled inputs, matching the ingestion
 * forms' field style. Shared by the add-person and add-number panels.
 *
 * Presentational: the parent owns the `values` object (keyed by descriptor
 * key) and supplies `onChange(key, value)`. Values are later folded into
 * extra_data via config/ingestionFields.buildExtraData.
 */

export default function DynamicIngestionFields({ descriptors, values, onChange }) {
  if (!descriptors?.length) return null;

  return descriptors.map((d) => {
    const value = values?.[d.key] ?? '';
    const id = `ingest-field-${d.key}`;

    return (
      <label key={d.key} htmlFor={id} className="block">
        <span className="text-xs font-medium text-slate-700">{d.label}</span>
        {d.widget === 'select' ? (
          <select
            id={id}
            value={value}
            data-testid={`ingest-field-${d.key}`}
            onChange={(e) => onChange(d.key, e.target.value)}
            className="mt-1 block w-full h-9 px-2 rounded-md border border-slate-300 text-sm bg-white"
          >
            <option value="">—</option>
            {d.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label || o.value}</option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type="text"
            value={value}
            data-testid={`ingest-field-${d.key}`}
            onChange={(e) => onChange(d.key, e.target.value)}
            className="mt-1 block w-full h-9 px-2 rounded-md border border-slate-300 text-sm"
          />
        )}
      </label>
    );
  });
}
