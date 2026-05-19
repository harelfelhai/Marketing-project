/**
 * BulkResultPanel — renders a BulkIngestSummary payload returned from the
 * POST /api/v1/phones/bulk-text (or, in E1-D, /bulk-upload) endpoint.
 *
 * Shape (matches `BulkIngestSummary` Pydantic model on the backend):
 *   {
 *     success_count, failed_count,
 *     phone_ids: [int], entity_ids: [int],
 *     failed_rows: [{ row, input, error }],
 *     bulk_submission_id: str,
 *   }
 *
 * Renders three stat cards (success / failed / total) + a table of failed
 * rows for operator review. The submission id is shown beneath as small
 * monospace text so operators can correlate with later log search.
 */

import { CheckCircle2, XCircle, ListChecks } from 'lucide-react';

import {
  BULK_SUMMARY_TITLE,
  BULK_SUMMARY_SUCCESS_LABEL, BULK_SUMMARY_FAILED_LABEL, BULK_SUMMARY_TOTAL_LABEL,
  BULK_SUMMARY_FAILED_HEADER,
  BULK_SUMMARY_COL_ROW, BULK_SUMMARY_COL_INPUT, BULK_SUMMARY_COL_ERROR,
  BULK_SUMMARY_SUBMISSION_ID, BULK_SUMMARY_EMPTY_FAILED,
} from '../../config/strings.he';

function StatCard({ label, value, accent, Icon }) {
  return (
    <div className={`flex items-center gap-3 rounded-md border px-3 py-2 ${accent}`}>
      <Icon className="w-5 h-5 shrink-0" />
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] uppercase tracking-wide opacity-80">{label}</span>
        <span className="text-lg font-semibold">{value}</span>
      </div>
    </div>
  );
}

export default function BulkResultPanel({ summary }) {
  if (!summary) return null;
  const total = (summary.success_count || 0) + (summary.failed_count || 0);

  return (
    <section className="space-y-4" data-testid="bulk-result-panel">
      <header>
        <h3 className="text-sm font-semibold text-slate-900">{BULK_SUMMARY_TITLE}</h3>
        <p className="mt-0.5 text-[11px] font-mono text-slate-400 break-all">
          {BULK_SUMMARY_SUBMISSION_ID(summary.bulk_submission_id || '—')}
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label={BULK_SUMMARY_SUCCESS_LABEL}
          value={summary.success_count ?? 0}
          accent="border-emerald-200 bg-emerald-50 text-emerald-700"
          Icon={CheckCircle2}
        />
        <StatCard
          label={BULK_SUMMARY_FAILED_LABEL}
          value={summary.failed_count ?? 0}
          accent="border-rose-200 bg-rose-50 text-rose-700"
          Icon={XCircle}
        />
        <StatCard
          label={BULK_SUMMARY_TOTAL_LABEL}
          value={total}
          accent="border-slate-200 bg-slate-50 text-slate-700"
          Icon={ListChecks}
        />
      </div>

      {/* UAT addition — show the actual server-assigned IDs so the
          operator has a concrete artifact to verify against the live
          table view. Without this, "2 הצליחו" felt unverifiable. */}
      {(summary.entity_ids?.length || summary.phone_ids?.length) ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 space-y-1">
          {summary.entity_ids?.length > 0 && (
            <div>
              <span className="font-semibold">מזהי ישויות שנוצרו: </span>
              <span className="font-mono">{summary.entity_ids.join(', ')}</span>
            </div>
          )}
          {summary.phone_ids?.length > 0 && (
            <div>
              <span className="font-semibold">מזהי טלפונים שנוצרו: </span>
              <span className="font-mono">{summary.phone_ids.join(', ')}</span>
            </div>
          )}
        </div>
      ) : null}

      <div>
        <h4 className="text-xs font-semibold text-slate-700 mb-2">
          {BULK_SUMMARY_FAILED_HEADER}
        </h4>

        {(!summary.failed_rows || summary.failed_rows.length === 0) ? (
          <p className="text-xs text-slate-500 italic py-2">
            {BULK_SUMMARY_EMPTY_FAILED}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="text-start px-3 py-2 font-medium w-12">
                    {BULK_SUMMARY_COL_ROW}
                  </th>
                  <th className="text-start px-3 py-2 font-medium">
                    {BULK_SUMMARY_COL_INPUT}
                  </th>
                  <th className="text-start px-3 py-2 font-medium">
                    {BULK_SUMMARY_COL_ERROR}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.failed_rows.map((r) => (
                  <tr key={`${r.row}-${r.input}`} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 text-slate-500 font-mono">{r.row}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-700 break-all">{r.input}</td>
                    <td className="px-3 py-1.5 text-rose-700 break-words">{r.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
