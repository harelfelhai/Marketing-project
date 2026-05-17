/**
 * JsonMetadataExplorer — key/value display of phone.extra_data with
 * inline Edit → Save Updates → patchPhone(...) flow.
 *
 * View mode renders an aligned key:value grid; Edit mode renders each
 * key with a text input plus an "add row" affordance and per-row delete.
 * Save serializes values to JSON-safe types (string fallback), calls the
 * API mutator, and pushes a toast.
 */

import { useState, useMemo } from 'react';
import { Edit3, Plus, Trash2, Check, X } from 'lucide-react';

import { patchPhone } from '../../api/phonesApi';
import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';

export default function JsonMetadataExplorer({ phone }) {
  const mockDb = useMockData();
  const { pushToast } = useUI();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft]         = useState([]);
  const [saving, setSaving]       = useState(false);

  // Snapshot entries when entering edit mode.
  const entries = useMemo(
    () => Object.entries(phone.extra_data || {}),
    [phone.extra_data]
  );

  const enterEdit = () => {
    setDraft(entries.map(([k, v]) => ({
      key:   k,
      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
    })));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft([]);
  };

  const updateDraftKey   = (idx, key)   => setDraft((d) => d.map((row, i) => i === idx ? { ...row, key   } : row));
  const updateDraftValue = (idx, value) => setDraft((d) => d.map((row, i) => i === idx ? { ...row, value } : row));
  const removeDraftRow   = (idx)        => setDraft((d) => d.filter((_, i) => i !== idx));
  const addDraftRow      = ()           => setDraft((d) => [...d, { key: '', value: '' }]);

  const save = async () => {
    // Build the object, dropping empty keys; values are kept as strings
    // (operator can paste numbers/JSON intentionally — we don't coerce).
    const next = {};
    for (const row of draft) {
      const k = row.key.trim();
      if (!k) continue;
      // Try to parse JSON for numeric / boolean / object values; fall
      // back to the raw string if parsing fails.
      try {
        next[k] = JSON.parse(row.value);
      } catch {
        next[k] = row.value;
      }
    }

    setSaving(true);
    try {
      await patchPhone(phone.id, { extra_data: next }, mockDb);
      pushToast({ variant: 'success', message: 'Phone metadata updated.' });
      setIsEditing(false);
      setDraft([]);
    } catch (err) {
      pushToast({ variant: 'error', message: `Update failed: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-md border border-slate-200">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-800">Metadata</h3>
        {!isEditing ? (
          <button
            type="button"
            onClick={enterEdit}
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save Updates'}
            </button>
          </div>
        )}
      </header>

      <div className="p-4">
        {!isEditing ? (
          entries.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No metadata recorded.</p>
          ) : (
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-xs">
              {entries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500 uppercase tracking-wide truncate" title={k}>{k}</dt>
                  <dd
                    className="text-slate-800 font-mono break-all"
                    title={typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  >
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          <div className="space-y-2">
            {draft.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateDraftKey(idx, e.target.value)}
                  placeholder="key"
                  className="w-[140px] h-8 px-2 text-xs rounded border border-slate-300 font-mono"
                />
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateDraftValue(idx, e.target.value)}
                  placeholder="value"
                  className="flex-1 h-8 px-2 text-xs rounded border border-slate-300 font-mono min-w-0"
                />
                <button
                  type="button"
                  onClick={() => removeDraftRow(idx)}
                  className="shrink-0 text-slate-400 hover:text-rose-600"
                  aria-label="Remove row"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addDraftRow}
              className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
            >
              <Plus className="w-3.5 h-3.5" />
              Add row
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
