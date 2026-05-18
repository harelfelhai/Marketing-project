/**
 * PhoneDetailDrawer — left-side slide-over in RTL layout (40% width, min 480px).
 *
 * Layout isolation:
 *   - Root: fixed top/left, h-screen, flex-col → strict height boundary
 *   - Header: shrink-0 (never compresses)
 *   - Scroll region: flex-1 overflow-y-auto (the ONLY scrolling surface)
 *   - Footer: shrink-0 + sticky bottom-0 + opaque bg + border-t
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Zap, ExternalLink, ClipboardList } from 'lucide-react';

import Badge                  from '../primitives/Badge';
import Skeleton               from '../primitives/Skeleton';
import JsonMetadataExplorer   from './JsonMetadataExplorer';
import VerticalAuditTimeline  from './VerticalAuditTimeline';
import VerdictSplitButtons    from './VerdictSplitButtons';
import ManualActionModal      from './ManualActionModal';

import { useMockData } from '../../contexts/MockDataContext';
import { verificationVariant, verificationLabel } from '../../utils/classifyStatus';
import { formatDateTime } from '../../utils/formatDate';
import {
  ARIA_PHONE_DETAIL, ARIA_CLOSE_DRAWER,
  DRAWER_LABEL_CLIENT, DRAWER_LABEL_ENTITY, DRAWER_LABEL_INGESTED,
  DRAWER_LABEL_UPDATED, DRAWER_VIA_SOURCE, DRAWER_BTN_TRIGGER,
  PHONE_DRAWER_TASK_PILL, PHONE_DRAWER_TASK_PILL_ZERO,
} from '../../config/strings.he';

export default function PhoneDetailDrawer({ phoneId, onClose }) {
  const { phones, entities, clients, actionLogs, tasks, loading } = useMockData();
  const navigate                                = useNavigate();
  const [actionModalOpen, setActionModalOpen]   = useState(false);

  if (phoneId == null) return null;

  const phone  = phones.find((p) => p.id === phoneId);

  if (!phone && loading) {
    return <DrawerSkeleton onClose={onClose} />;
  }
  if (!phone) return null;

  const entity = entities.find((e) => e.id === phone.entity_id) || null;
  const client = entity ? clients.find((c) => c.id === entity.client_id) || null : null;
  const logs   = actionLogs.filter((l) => l.phone_id === phoneId);
  // Phase DX cross-link — tasks attached to this phone (any status).
  const taskCount = tasks.filter((t) => t.phone_id === phoneId).length;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-slate-900/30"
        aria-hidden="true"
      />

      {/* Drawer panel — left-anchored for RTL layout */}
      <aside
        className="fixed top-0 left-0 z-40 h-screen w-full sm:w-[480px] lg:w-[40%] lg:min-w-[480px] lg:max-w-[640px] bg-white shadow-2xl flex flex-col animate-drawer-in"
        role="dialog"
        aria-modal="true"
        aria-label={ARIA_PHONE_DETAIL}
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
                  <span className="text-[11px] text-slate-400">
                    {DRAWER_VIA_SOURCE(phone.verification_source)}
                  </span>
                )}
                {/* Phase DX — cross-link pill to the Operations Cockpit.
                    Do NOT call onClose() here: PhoneGridPage's handleCloseDrawer
                    runs setSearchParams() which races the navigate() and
                    yanks us back to /phones. The drawer unmounts naturally
                    when the route changes. */}
                <button
                  type="button"
                  onClick={() => navigate(`/operations?phone_id=${phoneId}`)}
                  className={`inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-full border transition-colors ${
                    taskCount > 0
                      ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                      : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <ClipboardList className="w-3 h-3" />
                  {taskCount > 0
                    ? PHONE_DRAWER_TASK_PILL(taskCount)
                    : PHONE_DRAWER_TASK_PILL_ZERO}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-slate-400 hover:text-slate-900 transition-colors"
              aria-label={ARIA_CLOSE_DRAWER}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick facts row */}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">{DRAWER_LABEL_CLIENT}</dt>
              <dd className="text-slate-800 truncate max-w-[160px]" title={client?.name || '—'}>
                {client?.name || '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">{DRAWER_LABEL_ENTITY}</dt>
              <dd className="text-slate-800 truncate" title={`#${entity?.id} · ${entity?.entity_type}`}>
                #{entity?.id} · {entity?.entity_type || '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">{DRAWER_LABEL_INGESTED}</dt>
              <dd className="text-slate-800 tabular-nums">{formatDateTime(phone.ingested_at)}</dd>
            </div>
            <div className="flex items-center justify-between min-w-0">
              <dt className="text-slate-500">{DRAWER_LABEL_UPDATED}</dt>
              <dd className="text-slate-800 tabular-nums">{formatDateTime(phone.updated_at)}</dd>
            </div>
          </dl>
        </header>

        {/* ---------- Scroll region ---------- */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin bg-slate-50">
          <JsonMetadataExplorer phone={phone} />
          <VerticalAuditTimeline phone={phone} logs={logs} />
        </div>

        {/* ---------- Footer ---------- */}
        <footer className="shrink-0 sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setActionModalOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <Zap className="w-4 h-4" />
            {DRAWER_BTN_TRIGGER}
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

function DrawerSkeleton({ onClose }) {
  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-30 bg-slate-900/30"
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 left-0 z-40 h-screen w-full sm:w-[480px] lg:w-[40%] lg:min-w-[480px] lg:max-w-[640px] bg-white shadow-2xl flex flex-col animate-drawer-in"
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-label={ARIA_PHONE_DETAIL}
      >
        <header className="shrink-0 border-b border-slate-200 px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <Skeleton height={20} width="55%" />
              <div className="flex items-center gap-2">
                <Skeleton height={18} width={70} rounded="rounded-full" />
                <Skeleton height={18} width={90} rounded="rounded-full" />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-slate-400 hover:text-slate-900 transition-colors"
              aria-label={ARIA_CLOSE_DRAWER}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <Skeleton height={10} width={50} />
                <Skeleton height={10} width={80} />
              </div>
            ))}
          </dl>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50">
          <div className="bg-white rounded-md border border-slate-200 p-4 space-y-2">
            <Skeleton height={12} width="40%" />
            <Skeleton height={10} width="80%" />
            <Skeleton height={10} width="70%" />
          </div>
          <div className="bg-white rounded-md border border-slate-200 p-4 space-y-3">
            <Skeleton height={12} width="35%" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton width={10} height={10} rounded="rounded-full" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <Skeleton height={10} width="60%" />
                  <Skeleton height={8} width="40%" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="shrink-0 sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
          <Skeleton height={36} width={140} rounded="rounded-md" />
          <Skeleton height={36} width={160} rounded="rounded-md" />
        </footer>
      </aside>
    </>
  );
}
