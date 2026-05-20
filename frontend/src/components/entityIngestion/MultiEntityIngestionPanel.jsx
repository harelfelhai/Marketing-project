/**
 * MultiEntityIngestionPanel — Phase E2-D Tab 3 (Two-Step grid).
 *
 * Local state machine:
 *
 *   PASTE ──── continue ────▶ EDIT ──── save all ────▶ SUBMITTING ──▶ RESULT
 *     ▲                        │
 *     │  ◀── back (confirm) ───┘
 *
 * Step 1 (PASTE)
 *   Operator picks two defaults at the modal level (`default_relation_type`
 *   + `default_target_entity_id`, chosen via a two-step client→target
 *   picker) and pastes a raw list of names into a textarea. A live token
 *   counter mirrors the tokenizer so the operator knows how many rows
 *   the grid will produce before clicking Continue.
 *
 * Step 2 (EDIT)
 *   The textarea is tokenized into rows, each rendered as one line of
 *   the inline editor:
 *     [first_name] [last_name] [relation override?] [target override?] [×]
 *   Per-row null values for relation/target mean "inherit the default".
 *   The row's original token is preserved in `rowToken` (for the audit
 *   trail) and rendered as a small muted prefix so the operator can
 *   trace back to their original input.
 *
 * Step 3 (SUBMIT)
 *   The grid is serialized to the EntityBulkTextIn shape and posted.
 *   The response (BulkIngestSummary) lands in `summary` and the panel
 *   switches to the RESULT view (reusing BulkResultPanel from the
 *   phone-side bulk modal).
 *
 * Why a two-step UX instead of one big form?
 *   - Step 1 keeps the operator's mental model simple: paste-and-go.
 *   - Step 2 is where shape correctness happens — per-row edits without
 *     the operator having to type four columns per person from scratch.
 *   This matches how the original phone-side bulk-text works (paste +
 *   shared envelope), but adapted to the multi-field nature of people.
 */

import { useCallback, useMemo, useState } from 'react';
import { Loader2, Upload, ArrowRight, ArrowLeft, X, RefreshCw } from 'lucide-react';

import { bulkIngestEntityText } from '../../api/entityApi';
import { useMockData }          from '../../contexts/MockDataContext';
import { useUI }                from '../../contexts/UIContext';
import BulkResultPanel          from '../ingestion/BulkResultPanel';
import {
  ENTITY_BULK_TEXT_INTRO,
  ENTITY_BULK_TEXT_PASTE_LABEL, ENTITY_BULK_TEXT_PASTE_PLACE, ENTITY_BULK_TEXT_PASTE_HELP,
  ENTITY_BULK_TEXT_TOKEN_COUNT, ENTITY_BULK_TEXT_CONTINUE,
  ENTITY_BULK_DEFAULT_RELATION, ENTITY_BULK_DEFAULT_TARGET,
  ENTITY_BULK_DEFAULTS_HELP,
  ENTITY_BULK_ERR_EMPTY_TEXT, ENTITY_BULK_ERR_MISSING_TARGET,
  ENTITY_BULK_GRID_HEADER_TOKEN, ENTITY_BULK_GRID_HEADER_FIRST,
  ENTITY_BULK_GRID_HEADER_LAST, ENTITY_BULK_GRID_HEADER_RELATION,
  ENTITY_BULK_GRID_HEADER_TARGET, ENTITY_BULK_GRID_HEADER_STRONG_ID,
  ENTITY_BULK_GRID_INHERIT, ENTITY_BULK_GRID_BACK, ENTITY_BULK_GRID_BACK_CONFIRM,
  ENTITY_BULK_GRID_REMOVE_ROW, ENTITY_BULK_GRID_ERR_FIRST,
  ENTITY_BULK_GRID_SUMMARY_ISSUES,
  ENTITY_BULK_BTN_SUBMIT_ALL, ENTITY_BULK_BTN_SUBMITTING, ENTITY_BULK_BTN_NEW_BATCH,
  ENTITY_BULK_TOAST_PARTIAL, ENTITY_BULK_TOAST_ALL_OK, ENTITY_BULK_TOAST_NONE_OK,
  ENTITY_BULK_TOAST_ERROR,
  ENTITY_BTN_CANCEL, ENTITY_PLACEHOLDER_PICK,
  ENTITY_OPTION_FAMILY, ENTITY_OPTION_FRIEND, ENTITY_OPTION_COLLEAGUE, ENTITY_OPTION_SPOUSE,
} from '../../config/strings.he';

// Operator-creatable relation subset. Kept in lockstep with the
// backend's interfaces/relation_types.py::AssociatedRelationType.
const RELATION_OPTIONS = [
  { value: 'family',    label: ENTITY_OPTION_FAMILY },
  { value: 'friend',    label: ENTITY_OPTION_FRIEND },
  { value: 'colleague', label: ENTITY_OPTION_COLLEAGUE },
  { value: 'spouse',    label: ENTITY_OPTION_SPOUSE },
];

// Tokenizer (PASTE → grid rows).
//   - Splits on commas, newlines, tabs, and runs of 2+ spaces.
//   - A single space inside a token is preserved (so "Jane Doe" stays
//     one token, not two).
//   - Each surviving token becomes one editable row, with its original
//     text preserved in `rowToken` for audit and revert.
function tokenize(rawText) {
  if (!rawText) return [];
  return rawText
    .split(/[,\n\r\t]+|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// First word → first_name; remaining words → last_name. Empty surnames
// stay null (the backend's last_name field is optional).
function parseName(token) {
  const parts = token.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Stable uuid for each grid row so React's reconciliation can't lose
// input focus when rows are deleted or reordered.
function freshRowId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Empty form constant — mirrors the EMPTY_FORM in SingleEntityPanel.
const EMPTY_STATE = {
  step:                  'paste',
  rawText:               '',
  defaultRelation:       'family',
  defaultTargetId:       '',
  rows:                  [],
  pasteErr:              '',
  defaultsErr:           {},
  summary:               null,
};

export default function MultiEntityIngestionPanel() {
  const mockDb = useMockData();
  const { closeEntityIngestionModal, pushToast } = useUI();

  const [state, setState] = useState(EMPTY_STATE);

  // ---------- Derived target lists (mirrors SingleEntityPanel logic) ----------
  // UAT round-3: same client→target redundancy as the single panel.
  // One grouped picker (clients as <optgroup>) replaces both fields.
  const rootTargets = useMemo(
    () => mockDb.entities.filter(
      (e) => e.entity_type === 'target' && e.target_entity_id == null,
    ),
    [mockDb.entities],
  );

  const targetsByClient = useMemo(() => {
    const groups = new Map();
    for (const t of rootTargets) {
      if (t.client_id == null) continue;
      if (!groups.has(t.client_id)) groups.set(t.client_id, []);
      groups.get(t.client_id).push(t);
    }
    return Array.from(groups.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cid, targets]) => {
        const match = mockDb.clients.find((c) => String(c.id) === String(cid));
        return {
          clientId:    cid,
          clientLabel: match?.name || `Client ${cid}`,
          targets,
        };
      });
  }, [rootTargets, mockDb.clients]);

  // ---------- Live tokenizer count for the PASTE step ----------
  const liveTokenCount = useMemo(() => tokenize(state.rawText).length, [state.rawText]);

  // ===========================================================================
  // PASTE step handlers
  // ===========================================================================

  const handleRawChange = (value) => {
    setState((s) => ({ ...s, rawText: value, pasteErr: '' }));
  };

  const handleTargetChange = (value) => {
    setState((s) => ({
      ...s,
      defaultTargetId: value,
      defaultsErr:     { ...s.defaultsErr, defaultTargetId: '' },
    }));
  };

  const handleContinue = () => {
    const tokens = tokenize(state.rawText);
    const defaultsErr = {};
    if (tokens.length === 0) {
      setState((s) => ({ ...s, pasteErr: ENTITY_BULK_ERR_EMPTY_TEXT }));
      return;
    }
    if (state.defaultTargetId === '') {
      defaultsErr.defaultTargetId = ENTITY_BULK_ERR_MISSING_TARGET;
    }
    if (Object.keys(defaultsErr).length > 0) {
      setState((s) => ({ ...s, defaultsErr }));
      return;
    }
    // Build the grid rows. Pre-fill relationType + targetEntityId with
    // the modal-level defaults so the operator SEES their step-1 choice
    // carried through into the editor — without this the dropdowns
    // showed "ירש" (inherit) and the picked קרבה looked dropped, even
    // though the payload still applied it server-side. The operator
    // can still change per-row.
    const rows = tokens.map((token) => {
      const { firstName, lastName } = parseName(token);
      return {
        rowId:           freshRowId(),
        rowToken:        token,
        firstName,
        lastName:        lastName || '',
        // UAT round-3: per-row optional strong identifier, matching the
        // single-entry panel. Empty values are dropped at submit.
        strongIdentifier: '',
        relationType:    state.defaultRelation || null,
        targetEntityId:  state.defaultTargetId
                            ? Number(state.defaultTargetId)
                            : null,
      };
    });
    setState((s) => ({ ...s, step: 'edit', rows, pasteErr: '', defaultsErr: {} }));
  };

  // ===========================================================================
  // EDIT step handlers
  // ===========================================================================

  const updateRow = useCallback((rowId, patch) => {
    setState((s) => ({
      ...s,
      rows: s.rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)),
    }));
  }, []);

  const removeRow = useCallback((rowId) => {
    setState((s) => ({
      ...s,
      rows: s.rows.filter((r) => r.rowId !== rowId),
    }));
  }, []);

  // Per-row client-side validation. We do this on every render rather
  // than memoizing because the row list is small (max 500) and edits
  // are bursty — the cost of re-validating is well under render budget.
  const rowErrors = useMemo(() => {
    const map = {};
    state.rows.forEach((r) => {
      const issues = {};
      if (!r.firstName.trim()) issues.firstName = ENTITY_BULK_GRID_ERR_FIRST;
      if (Object.keys(issues).length > 0) map[r.rowId] = issues;
    });
    return map;
  }, [state.rows]);

  const issueCount = Object.keys(rowErrors).length;

  const handleBack = () => {
    // eslint-disable-next-line no-alert
    if (state.rows.length > 0 && !window.confirm(ENTITY_BULK_GRID_BACK_CONFIRM)) {
      return;
    }
    setState((s) => ({ ...s, step: 'paste', rows: [] }));
  };

  // ===========================================================================
  // SUBMIT
  // ===========================================================================

  const handleSubmit = async () => {
    if (state.rows.length === 0 || issueCount > 0) return;

    const payload = {
      default_relation_type:    state.defaultRelation,
      default_target_entity_id: Number(state.defaultTargetId),
      rows: state.rows.map((r) => {
        const sid = (r.strongIdentifier || '').trim();
        const row = {
          row_token:        r.rowToken,
          first_name:       r.firstName.trim(),
          last_name:        r.lastName.trim() || null,
          relation_type:    r.relationType,   // null = inherit
          target_entity_id: r.targetEntityId, // null = inherit
        };
        if (sid) row.extra_data = { strong_identifier: sid };
        return row;
      }),
    };

    setState((s) => ({ ...s, step: 'submitting' }));
    try {
      const summary = await bulkIngestEntityText(payload, mockDb);

      // Operator-facing toast variant matches the partial-success
      // model used by the phone bulk-text endpoint.
      if (summary.failed_count === 0 && summary.success_count > 0) {
        pushToast({
          variant: 'success',
          message: ENTITY_BULK_TOAST_ALL_OK(summary.success_count),
        });
      } else if (summary.success_count === 0) {
        pushToast({ variant: 'error', message: ENTITY_BULK_TOAST_NONE_OK });
      } else {
        pushToast({
          variant: 'info',
          message: ENTITY_BULK_TOAST_PARTIAL(summary.success_count, summary.failed_count),
        });
      }
      setState((s) => ({ ...s, step: 'result', summary }));
    } catch (err) {
      pushToast({
        variant: 'error',
        message: ENTITY_BULK_TOAST_ERROR(err?.message || 'error'),
      });
      // Drop back to EDIT so the operator can fix and retry.
      setState((s) => ({ ...s, step: 'edit' }));
    }
  };

  const handleNewBatch = () => setState(EMPTY_STATE);

  // ===========================================================================
  // RESULT view — same BulkResultPanel as the phone-side bulk modal.
  // ===========================================================================
  if (state.step === 'result') {
    return (
      <div className="space-y-5" dir="rtl" data-testid="entity-bulk-result">
        <BulkResultPanel summary={state.summary} />
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={closeEntityIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {ENTITY_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleNewBatch}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {ENTITY_BULK_BTN_NEW_BATCH}
          </button>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // PASTE view (Step 1)
  // ===========================================================================
  if (state.step === 'paste') {
    return (
      <div className="space-y-4" dir="rtl" data-testid="entity-bulk-paste">
        <p className="text-sm text-slate-500">{ENTITY_BULK_TEXT_INTRO}</p>

        {/* Modal-level defaults — single grouped target picker + default
            relation. UAT round-3: client field removed; picking a target
            in the <optgroup> already implies its client. */}
        <fieldset className="rounded-md border border-slate-200 p-3 space-y-3">
          <legend className="text-xs font-semibold text-slate-700 px-1">
            {ENTITY_BULK_DEFAULTS_HELP}
          </legend>

          <div className="grid grid-cols-2 gap-3">
            <LabelledSelect
              id="entity-bulk-default-relation"
              label={ENTITY_BULK_DEFAULT_RELATION}
              value={state.defaultRelation}
              onChange={(v) => setState((s) => ({ ...s, defaultRelation: v }))}
            >
              {RELATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </LabelledSelect>
            <LabelledSelect
              id="entity-bulk-default-target"
              label={ENTITY_BULK_DEFAULT_TARGET}
              value={state.defaultTargetId}
              onChange={handleTargetChange}
              error={state.defaultsErr.defaultTargetId}
            >
              <option value="">{ENTITY_PLACEHOLDER_PICK}</option>
              {targetsByClient.map((group) => (
                <optgroup key={String(group.clientId)} label={group.clientLabel}>
                  {group.targets.map((t) => (
                    <option key={t.id} value={t.id}>{`#${t.id}`}</option>
                  ))}
                </optgroup>
              ))}
            </LabelledSelect>
          </div>
        </fieldset>

        {/* Raw paste area + live token counter. */}
        <label htmlFor="entity-bulk-raw" className="block">
          <span className="text-xs font-semibold text-slate-700">
            {ENTITY_BULK_TEXT_PASTE_LABEL}
          </span>
          <textarea
            id="entity-bulk-raw"
            value={state.rawText}
            onChange={(e) => handleRawChange(e.target.value)}
            placeholder={ENTITY_BULK_TEXT_PASTE_PLACE}
            rows={6}
            className="mt-1 block w-full p-2 rounded-md border border-slate-300 text-sm font-mono"
          />
          <span className="text-[11px] text-slate-400 mt-1 block">
            {ENTITY_BULK_TEXT_PASTE_HELP}
          </span>
          <span
            data-testid="entity-bulk-token-count"
            className="text-[11px] text-slate-500 mt-1 inline-block"
          >
            {ENTITY_BULK_TEXT_TOKEN_COUNT(liveTokenCount)}
          </span>
        </label>

        {state.pasteErr && (
          <p role="alert" className="text-xs text-rose-600">{state.pasteErr}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={closeEntityIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {ENTITY_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            data-testid="entity-bulk-continue"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            {ENTITY_BULK_TEXT_CONTINUE}
          </button>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // EDIT view (Step 2) — inline editor grid
  // ===========================================================================
  const submitDisabled =
    state.step === 'submitting' || state.rows.length === 0 || issueCount > 0;

  return (
    <div className="space-y-3" dir="rtl" data-testid="entity-bulk-grid">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          {ENTITY_BULK_GRID_BACK}
        </button>
        <span data-testid="entity-bulk-row-count">{state.rows.length}</span>
      </div>

      {/* Grid */}
      <div className="rounded-md border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase">
            <tr>
              <th className="px-2 py-1 text-right font-medium w-32">{ENTITY_BULK_GRID_HEADER_TOKEN}</th>
              <th className="px-2 py-1 text-right font-medium">{ENTITY_BULK_GRID_HEADER_FIRST}</th>
              <th className="px-2 py-1 text-right font-medium">{ENTITY_BULK_GRID_HEADER_LAST}</th>
              <th className="px-2 py-1 text-right font-medium w-32">{ENTITY_BULK_GRID_HEADER_STRONG_ID}</th>
              <th className="px-2 py-1 text-right font-medium w-32">{ENTITY_BULK_GRID_HEADER_RELATION}</th>
              <th className="px-2 py-1 text-right font-medium w-28">{ENTITY_BULK_GRID_HEADER_TARGET}</th>
              <th className="px-2 py-1 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r) => {
              const issues = rowErrors[r.rowId] || {};
              return (
                <tr
                  key={r.rowId}
                  data-testid="entity-bulk-row"
                  className="border-t border-slate-100"
                >
                  <td className="px-2 py-1 text-[11px] text-slate-400 truncate" title={r.rowToken}>
                    {r.rowToken}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={r.firstName}
                      onChange={(e) => updateRow(r.rowId, { firstName: e.target.value })}
                      className={[
                        'block w-full h-8 px-2 rounded border text-sm',
                        issues.firstName ? 'border-rose-400' : 'border-slate-300',
                      ].join(' ')}
                    />
                    {issues.firstName && (
                      <span className="text-[10px] text-rose-600 mt-0.5 block">
                        {issues.firstName}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={r.lastName}
                      onChange={(e) => updateRow(r.rowId, { lastName: e.target.value })}
                      className="block w-full h-8 px-2 rounded border border-slate-300 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1">
                    {/* UAT round-3: optional strong identifier per row.
                        Same field as the single-entry panel — empty
                        cells are dropped at submit. */}
                    <input
                      type="text"
                      value={r.strongIdentifier || ''}
                      onChange={(e) => updateRow(r.rowId, { strongIdentifier: e.target.value })}
                      className="block w-full h-8 px-2 rounded border border-slate-300 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={r.relationType || ''}
                      onChange={(e) => updateRow(r.rowId, {
                        relationType: e.target.value || null,
                      })}
                      className="block w-full h-8 px-1 rounded border border-slate-300 text-sm bg-white"
                    >
                      <option value="">{ENTITY_BULK_GRID_INHERIT}</option>
                      {RELATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={r.targetEntityId == null ? '' : String(r.targetEntityId)}
                      onChange={(e) => updateRow(r.rowId, {
                        targetEntityId: e.target.value === '' ? null : Number(e.target.value),
                      })}
                      className="block w-full h-8 px-1 rounded border border-slate-300 text-sm bg-white"
                    >
                      <option value="">{ENTITY_BULK_GRID_INHERIT}</option>
                      {targetsByClient.map((group) => (
                        <optgroup key={String(group.clientId)} label={group.clientLabel}>
                          {group.targets.map((t) => (
                            <option key={t.id} value={t.id}>{`#${t.id}`}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => removeRow(r.rowId)}
                      aria-label={ENTITY_BULK_GRID_REMOVE_ROW}
                      className="text-slate-400 hover:text-rose-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer — submit + issues summary */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200">
        <span className="text-xs text-slate-500">
          {issueCount > 0 ? ENTITY_BULK_GRID_SUMMARY_ISSUES(issueCount) : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeEntityIngestionModal}
            className="h-9 px-3 text-sm text-slate-600 hover:text-slate-900"
          >
            {ENTITY_BTN_CANCEL}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            data-testid="entity-bulk-submit-all"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {state.step === 'submitting'
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {ENTITY_BULK_BTN_SUBMITTING}</>
              : <><Upload className="w-4 h-4" /> {ENTITY_BULK_BTN_SUBMIT_ALL}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local field primitive. Same shape as the one in SingleEntityPanel but
// kept inline here to avoid coupling the two panels; the styling is
// small enough that duplication is cheaper than a shared component.
// ---------------------------------------------------------------------------

function LabelledSelect({ id, label, value, onChange, children, disabled, error }) {
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'mt-1 block w-full h-9 px-2 rounded-md border text-sm bg-white',
          error ? 'border-rose-400' : 'border-slate-300',
          disabled ? 'opacity-60' : '',
        ].join(' ')}
      >
        {children}
      </select>
      {error && <span className="text-xs text-rose-600 mt-1 block">{error}</span>}
    </label>
  );
}
