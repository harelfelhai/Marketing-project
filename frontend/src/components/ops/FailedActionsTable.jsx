/**
 * FailedActionsTable — audit log filtered to status='failed' rows.
 *
 * When EITHER engine is executing, a full-table overlay dims the rows
 * (opacity-50 + pointer-events-none) and shows a central spinner to signal
 * that records may be reprocessing. This is triggered by the global
 * executing state in MockDataContext, so switching tabs during a run
 * preserves the visual lock.
 *
 * "Force Retry Now" calls retryNow(), which marks the log as 'superseded'
 * via applyRetryNow() and appends a new 'sent' log — the row disappears
 * from this table on the next render because the filter drops non-'failed'
 * rows.
 */

import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';

import ErrorAccordionCell from './ErrorAccordionCell';
import Badge              from '../primitives/Badge';
import { retryNow }       from '../../api/actionsApi';
import { useMockData }    from '../../contexts/MockDataContext';
import { useUI }          from '../../contexts/UIContext';
import { useAuth }        from '../../contexts/MockAuthContext';
import { labelForActionType } from '../../utils/actionTypeIcons';
import { formatDateTime }     from '../../utils/formatDate';

export default function FailedActionsTable() {
  const mockDb          = useMockData();
  const { pushToast }   = useUI();
  const { operatorId }  = useAuth();

  const { phones, entities, clients, actionLogs, engines } = mockDb;

  // Any engine executing → overlay the table.
  const anyExecuting = Object.values(engines).some((e) => e.executing);

  const failed = actionLogs.filter((l) => l.status === 'failed');

  // Build lookup maps once for performance.
  const phoneById  = new Map(phones.map((p) => [p.id, p]));
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const rows = failed
    .map((log) => {
      const phone  = phoneById.get(log.phone_id);
      const entity = phone ? entityById.get(phone.entity_id) : null;
      const client = entity ? clientById.get(entity.client_id) : null;
      return { log, phone, entity, client };
    })
    .sort((a, b) => new Date(b.log.requested_at) - new Date(a.log.requested_at));

  return (
    <div className="relative bg-white rounded-lg border border-slate-200">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Failed Actions</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {rows.length} record{rows.length === 1 ? '' : 's'} requiring attention
          </p>
        </div>
        {anyExecuting && (
          <div className="flex items-center gap-1.5 text-xs text-amber-700">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Engine processing…
          </div>
        )}
      </header>

      {/* Table + overlay wrapper */}
      <div className="relative">
        {/* Execution overlay — dims table and blocks clicks while an engine runs */}
        {anyExecuting && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-b-lg"
            aria-busy="true"
            aria-label="Engine is processing records"
          >
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              <span className="text-sm font-medium">Re-evaluating records…</span>
            </div>
          </div>
        )}

        <div className={anyExecuting ? 'opacity-50 pointer-events-none' : ''}>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              No failed actions — pipeline is clear.
            </div>
          ) : (
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[140px]" />
                <col className="w-[100px]" />
                <col />
                <col className="w-[160px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>Phone</Th>
                  <Th>Client</Th>
                  <Th>Type</Th>
                  <Th>Error Detail</Th>
                  <Th>Requested</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ log, phone, entity, client }) => (
                  <FailedRow
                    key={log.id}
                    log={log}
                    phone={phone}
                    entity={entity}
                    client={client}
                    onRetry={async () => {
                      try {
                        await retryNow(log.id, operatorId, mockDb);
                        pushToast({ variant: 'success', message: 'Retry dispatched — action requeued.' });
                      } catch (err) {
                        pushToast({ variant: 'error', message: `Retry failed: ${err.message}` });
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function FailedRow({ log, phone, entity, client, onRetry }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-4 py-3">
        <div className="flex flex-col min-w-0">
          <span className="font-mono text-xs text-slate-900 truncate" title={phone?.phone_number || ''}>
            {phone?.phone_number || `#${log.phone_id}`}
          </span>
          {phone?.classification_type && (
            <span className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">
              {phone.classification_type}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-slate-700 truncate block max-w-[130px]" title={client?.name || '—'}>
          {client?.name || '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <Badge variant="failed" size="xs">{labelForActionType(log.action_type)}</Badge>
        <div className="text-[10px] text-slate-400 mt-1">retry #{log.retry_count}</div>
      </td>
      <td className="px-4 py-3">
        <ErrorAccordionCell extraData={log.extra_data || {}} />
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
        {formatDateTime(log.requested_at)}
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {retrying
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Retrying…</>
            : <><RefreshCw className="w-3 h-3" /> Force Retry</>
          }
        </button>
      </td>
    </tr>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
      {children}
    </th>
  );
}
