/**
 * PhoneDetailDrawer — right-side slide-over (40% width, min 480px).
 *
 * Layout isolation:
 *   - Root: fixed top/right, h-screen, flex-col → strict height boundary
 *   - Header: shrink-0 (never compresses)
 *   - Scroll region: flex-1 overflow-y-auto (the ONLY scrolling surface)
 *   - Footer: shrink-0 + sticky bottom-0 + opaque bg + border-t
 *
 * The drawer derives its data from MockDataContext directly (not via API
 * fetch) so any mutation — verdict, patch, manual action — reflects
 * instantly without a reload.
 */

import { useState } from 'react';
import { X, Zap, ExternalLink } from 'lucide-react';

import Badge                  from '../primitives/Badge';
import JsonMetadataExplorer   from './JsonMetadataExplorer';
import VerticalAuditTimeline  from './VerticalAuditTimeline';
import VerdictSplitButtons    from './VerdictSplitButtons';
import ManualActionModal      from './ManualActionModal';

import { useMockData } from '../../contexts/MockDataContext';
import { verificationVariant, verificationLabel } from '../../utils/classifyStatus';
import { formatDateTime } from '../../utils/formatDate';

export default function PhoneDetailDrawer({ phoneId, onClose }) {
  const { phones, entities, clients, actionLogs } = useMockData();
  const [actionModalOpen, setActionModalOpen]     = useState(false);

  if (phoneId == null) return null;

  const phone  = phones.find((p) => p.id === phoneId);
  if (!phone) return null;

  const entity = entities.find((e) => e.id === phone.entity_id) || null;
  const client = entity ? clients.find((c) => c.id === entity.client_id) || null : null;
  const logs   = actionLogs.filter((l) => l.phone_id === phoneId);

  return (
    <>
      {/* Backdrop — click anywhere to dismiss */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-slate-900/30"
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className="fixed top-0 right-0 z-40 h-screen w-full sm:w-[480px] lg:w-[40%] lg:min-w-[480px] lg:max-w-[640px] bg-white shadow-2xl flex flex-col animate-drawer-in"
        role="dialog"
        aria-modal="true"
        aria-label="Phone detail"
      >
        {/* ---------- Header (shrink-0) ---------- */}
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-base font-semibold text-slate-900 truncate">
                {phone.phone_number}
              </p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {phone.classification_type && (
                  <Badge variant="info" size="sm" className="uppercase tracking-wide">
                    {phone.classification_type}
                  </Badge>
                )}
                <Badge variant={verificationVariant(phone.verification_status)} size="sm">
                  {verificationLabel(phone.verification_status)}
                </Badge>
                {phone.verification_source && (
                  <span className="text-[11px] text-slate-400">via {phone.verification_source}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-slate-400 hover:text-slate-900 transition-colors"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick facts row */}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">Client</dt>
              <dd className="text-slate-800 truncate max-w-[160px]" title={client?.name || '—'}>
                {client?.name || '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">Entity</dt>
              <dd className="text-slate-800 truncate" title={`#${entity?.id} · ${entity?.entity_type}`}>
                #{entity?.id} · {entity?.entity_type || '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">Ingested</dt>
              <dd className="text-slate-800 tabular-nums">{formatDateTime(phone.ingested_at)}</dd>
            </div>
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">Updated</dt>
              <dd className="text-slate-800 tabular-nums">{formatDateTime(phone.updated_at)}</dd>
            </div>
          </dl>
        </header>

        {/* ---------- Scroll region (flex-1 + overflow-y-auto) ---------- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin bg-slate-50">
          <JsonMetadataExplorer phone={phone} />
          <VerticalAuditTimeline phone={phone} logs={logs} />
        </div>

        {/* ---------- Footer (shrink-0 + sticky bottom-0 + opaque bg) ---------- */}
        <footer className="shrink-0 sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setActionModalOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Trigger Action
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <VerdictSplitButtons phone={phone} />
        </footer>
      </aside>

      <ManualActionModal
        isOpen={actionModalOpen}
        onClose={() => setActionModalOpen(false)}
        phone={phone}
      />
    </>
  );
}
