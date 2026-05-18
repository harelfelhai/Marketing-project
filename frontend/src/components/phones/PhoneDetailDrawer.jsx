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
import {
  X, Zap, ExternalLink, ClipboardList,
  Phone as PhoneIcon, User, Radio, Search, Diamond,
} from 'lucide-react';

import Badge                  from '../primitives/Badge';
import Skeleton               from '../primitives/Skeleton';
import JsonMetadataExplorer   from './JsonMetadataExplorer';
import VerticalAuditTimeline  from './VerticalAuditTimeline';
import VerdictSplitButtons    from './VerdictSplitButtons';
import ManualActionModal      from './ManualActionModal';

import { useMockData } from '../../contexts/MockDataContext';
import {
  priorityVariant, confidenceVariant, tierVariant,
  isEnvelope, phoneAxisState, identityAxisState,
} from '../../utils/classifyStatus';
import { formatDateTime } from '../../utils/formatDate';
import {
  ARIA_PHONE_DETAIL, ARIA_CLOSE_DRAWER,
  DRAWER_LABEL_CLIENT, DRAWER_LABEL_ENTITY, DRAWER_LABEL_INGESTED,
  DRAWER_LABEL_UPDATED, DRAWER_BTN_TRIGGER,
  PHONE_DRAWER_TASK_PILL, PHONE_DRAWER_TASK_PILL_ZERO,
  SCORE_PRIORITY_LABEL, SCORE_CONFIDENCE_LABEL,
  SCORE_TIER_VALUE, SCORE_TIER_UNKNOWN, SCORE_NOT_AUDITED,
  DRAWER_TRUTH_SECTION_IDENTITY, DRAWER_TRUTH_SECTION_PHONE_LINE,
  DRAWER_TRUTH_IDENTITY_VECTOR_A, DRAWER_TRUTH_IDENTITY_ENVELOPE,
  DRAWER_TRUTH_SOURCE_MANUAL, DRAWER_TRUTH_SOURCE_AUTOMATED,
  DRAWER_TRUTH_SOURCE_AWAITING, DRAWER_TRUTH_SOURCE_AMBIENT,
  DRAWER_TRUTH_SOURCE_DISPROVED,
  TRUTH_STATE_VERIFIED, TRUTH_STATE_PENDING, TRUTH_STATE_DISPROVED,
} from '../../config/strings.he';

const TRUTH_STATE_LABEL = {
  good:    TRUTH_STATE_VERIFIED,
  pending: TRUTH_STATE_PENDING,
  failed:  TRUTH_STATE_DISPROVED,
};
const TRUTH_STATE_DOT_BG = {
  good:    'bg-emerald-500',
  pending: 'border border-slate-400 bg-white',
  failed:  'bg-rose-500',
};
const TRUTH_STATE_BORDER = {
  good:    'border-emerald-200 bg-emerald-50',
  pending: 'border-slate-200 bg-slate-50',
  failed:  'border-rose-200 bg-rose-50',
};

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

          {/* Phase DY-4 — Truth Panel: structured two-row identity +
              phone-line summary. Replaces the legacy single verification
              badge with an explicit two-axis read. Envelope rows render
              the Identity row with a diamond + "ambient" source caption;
              the Phone-line row label flips to "phone in network" copy. */}
          <TruthPanel phone={phone} entity={entity} />

          {/* Phase DY — scoring block: three score badges + tier badge.
              Sits below the Truth Panel so the structural truth read
              precedes the numeric scores. */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            <Badge variant={priorityVariant(phone.priority_score)} size="xs">
              {SCORE_PRIORITY_LABEL}{' '}
              {phone.priority_score != null
                ? Math.round(phone.priority_score)
                : '—'}
            </Badge>
            <Badge variant={confidenceVariant(phone.confidence_score)} size="xs">
              {SCORE_CONFIDENCE_LABEL}{' '}
              {phone.confidence_score != null
                ? Math.round(phone.confidence_score)
                : SCORE_NOT_AUDITED}
            </Badge>
            <Badge variant={tierVariant(phone.customer_tier)} size="xs">
              {phone.customer_tier != null
                ? SCORE_TIER_VALUE(phone.customer_tier)
                : SCORE_TIER_UNKNOWN}
            </Badge>
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
        <footer className="shrink-0 sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3 flex flex-col gap-3">
          {/* Trigger-action button — kept above the verdict form so the
              footer reads top-to-bottom: ad-hoc action → structured
              verdict feedback. */}
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setActionModalOpen(true)}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <Zap className="w-4 h-4" />
              {DRAWER_BTN_TRIGGER}
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>

          <VerdictSplitButtons phone={phone} entity={entity} />
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


// ---------------------------------------------------------------------------
// TruthPanel (DY-4-B) — two-row identity + phone-line summary.
// ---------------------------------------------------------------------------
// Renders below the badges row in the drawer header. The shape adapts to
// the entity_type:
//   Vector A: 👤 Identity (named) + 📞 Phone line
//   Vector B: 🔍 Identity (envelope, diamond) + 📡 Phone in network
// Each row pairs an icon, a state pip (dot OR diamond), a primary line,
// and a small source caption. Verbose by drawer-standard but exactly the
// "executive summary" the operator needs at the top of the drawer.

function TruthPanel({ phone, entity }) {
  const envelope = isEnvelope(entity?.entity_type);
  const phoneState    = phoneAxisState(phone.confidence_score);
  const identityState = identityAxisState(entity?.entity_type, phone.verification_status);

  // Identity row content varies by provenance.
  const identityPrimary = envelope
    ? DRAWER_TRUTH_IDENTITY_ENVELOPE
    : DRAWER_TRUTH_IDENTITY_VECTOR_A(entity?.entity_type);

  // Phone-line source caption — derived from verification_source and
  // verified_at, with a sensible fallback for the unaudited state.
  let phoneSource;
  if (phone.verification_status === 'verified_bad') {
    phoneSource = DRAWER_TRUTH_SOURCE_DISPROVED;
  } else if (phone.verification_source === 'manual' && phone.verified_at) {
    phoneSource = DRAWER_TRUTH_SOURCE_MANUAL(formatDateTime(phone.verified_at));
  } else if (phone.verification_source === 'automated' && phone.verified_at) {
    phoneSource = DRAWER_TRUTH_SOURCE_AUTOMATED(formatDateTime(phone.verified_at));
  } else if (envelope) {
    phoneSource = DRAWER_TRUTH_SOURCE_AMBIENT;
  } else {
    phoneSource = DRAWER_TRUTH_SOURCE_AWAITING;
  }

  // Identity row source caption — envelope is always "ambient · pending
  // identification" until promoted; named entities echo phone source for
  // simplicity (the operator-confirmed-and-named case is rare enough
  // that more nuance isn't worth the visual weight).
  const identitySource = envelope
    ? DRAWER_TRUTH_SOURCE_AMBIENT
    : phoneSource;

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
      <TruthRow
        icon={envelope ? Search : User}
        sectionLabel={DRAWER_TRUTH_SECTION_IDENTITY}
        state={identityState}
        forceDiamond={envelope}
        primary={identityPrimary}
        source={identitySource}
      />
      <TruthRow
        icon={envelope ? Radio : PhoneIcon}
        sectionLabel={DRAWER_TRUTH_SECTION_PHONE_LINE}
        state={phoneState}
        primary={phone.phone_number}
        source={phoneSource}
      />
    </div>
  );
}

function TruthRow({ icon: Icon, sectionLabel, state, forceDiamond = false, primary, source }) {
  return (
    <div className={`rounded-sm border ${TRUTH_STATE_BORDER[state] || 'border-slate-200 bg-white'} px-2.5 py-1.5`}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="text-[11px] text-slate-500 shrink-0">{sectionLabel}</span>
        {forceDiamond ? (
          <Diamond className="w-3 h-3 text-slate-400 shrink-0" aria-label={TRUTH_STATE_LABEL[state]} />
        ) : (
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${TRUTH_STATE_DOT_BG[state] || ''}`}
            aria-label={TRUTH_STATE_LABEL[state]}
          />
        )}
        <span className="text-xs font-medium text-slate-800 truncate">{primary}</span>
      </div>
      {source && (
        <div className="mt-0.5 ps-6 text-[10px] text-slate-400 truncate">{source}</div>
      )}
    </div>
  );
}
