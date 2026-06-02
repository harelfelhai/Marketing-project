/**
 * PhoneRow — a single row in the PhoneTable.
 *
 * Five strictly-sized columns; tooltip overflow is allowed by NOT setting
 * any overflow rule on <tr> or <td>; only inner divs clip text.
 *
 * Click selects the row → opens the detail drawer.
 */

import { Diamond, Phone as PhoneIcon, User, Radio, Search } from 'lucide-react';

import Badge from '../primitives/Badge';
import ActionMiniPipeline from './ActionMiniPipeline';
import {
  priorityVariant, tierVariant,
  isEnvelope, phoneAxisState, identityAxisState,
} from '../../utils/classifyStatus';
import { formatRelative } from '../../utils/formatDate';
import {
  SCORE_PRIORITY_LABEL, SCORE_TIER_VALUE, SCORE_ROW_TOOLTIP,
  PROVENANCE_TITLE_VECTOR_A, PROVENANCE_TITLE_VECTOR_B,
  ENVELOPE_LABEL, ENTITY_TYPE_DISPLAY,
  TRUTH_AXIS_PHONE_PERSON, TRUTH_AXIS_PERSON_TARGET,
  TRUTH_AXIS_PHONE_IN_NETWORK, TRUTH_AXIS_IDENTITY,
  TRUTH_STATE_VERIFIED, TRUTH_STATE_PENDING, TRUTH_STATE_DISPROVED,
} from '../../config/strings.he';

const TRUTH_STATE_LABEL = {
  good:    TRUTH_STATE_VERIFIED,
  pending: TRUTH_STATE_PENDING,
  failed:  TRUTH_STATE_DISPROVED,
};

// Dot colour by state — keeps the dual-icon row visually quiet (no
// fully colored Badge pills) so the existing layout doesn't get noisier.
const TRUTH_STATE_DOT = {
  good:    'bg-emerald-500',
  pending: 'border border-slate-400',  // hollow
  failed:  'bg-rose-500',
};

// `visibleKeys` is a Set of keys from the 'phones' display-fields catalog.
// When absent, every column renders (matches the pre-feature behaviour).
const _ALL_KEYS = new Set(['association', 'verification', 'actions', 'updated']);

export default function PhoneRow({
  phone, entity, client, logs, isSelected, onSelect,
  visibleKeys = _ALL_KEYS,
}) {
  const rowTooltip = SCORE_ROW_TOOLTIP(
    phone.priority_score,
    phone.confidence_score,
    phone.customer_tier,
  );

  // Phase DY-4 — Vector A vs Vector B determines provenance + truth-axis
  // shapes. `relation_type` is the canonical field name; `entity_type` is
  // the legacy mock-mode alias retained for backward compat. isEnvelope()
  // wraps the comparison so the same check is testable in isolation.
  const relationType = entity?.relation_type ?? entity?.entity_type;
  const envelope = isEnvelope(relationType);

  // Provenance pip — emerald left border for Vector A, amber for Vector B.
  // The first cell carries the pip so it visually anchors the row's start
  // edge under RTL (the "start" side in RTL is the right; Tailwind's
  // logical `border-s-*` flips automatically).
  const pipClass = envelope
    ? 'border-s-4 border-s-amber-400'
    : 'border-s-4 border-s-emerald-400';
  const pipTitle = envelope ? PROVENANCE_TITLE_VECTOR_B : PROVENANCE_TITLE_VECTOR_A;

  // Two-axis truth states. Vector A reads from confidence_score +
  // verification_status; Vector B reads only from confidence (the
  // identity axis is always 'pending' until the envelope is identified).
  const phoneState    = phoneAxisState(phone.confidence_score);
  const identityState = identityAxisState(relationType, phone.verification_status);

  return (
    <tr
      onClick={() => onSelect(phone.id)}
      title={rowTooltip}
      className={`cursor-pointer border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Column 1 — Phone + classification + priority pill. The provenance
          pip lives on the start edge of this cell so the row reads as
          provenance-bar → phone-number, scannable in one glance. */}
      <td className={`px-4 py-3 align-middle ${pipClass}`} title={pipTitle}>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-sm font-semibold text-slate-900 truncate">
            {phone.phone_number}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {phone.classification_type ? (
              <Badge variant="info" size="xs" className="uppercase tracking-wide">
                {phone.classification_type}
              </Badge>
            ) : (
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">—</span>
            )}
            {phone.priority_score != null && (
              <Badge variant={priorityVariant(phone.priority_score)} size="xs">
                {SCORE_PRIORITY_LABEL} {Math.round(phone.priority_score)}
              </Badge>
            )}
          </div>
        </div>
      </td>

      {/* Column 2 — Client + entity + tier. Envelope rows replace the
          standard entity caption with the diamond glyph + envelope_id so
          "this isn't a named person yet" is unmistakable. */}
      {visibleKeys.has('association') && (
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col min-w-0 max-w-[180px] gap-1">
          <span
            className="text-sm font-medium text-slate-800 truncate"
            title={client?.name || ''}
          >
            {client?.name || '—'}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {envelope ? (
              <span
                className="inline-flex items-center gap-1 text-xs text-slate-500 italic truncate"
                title={ENVELOPE_LABEL(entity?.extra_data?.envelope_id)}
              >
                <Diamond className="w-3 h-3 shrink-0" />
                {ENVELOPE_LABEL(entity?.extra_data?.envelope_id)}
              </span>
            ) : (
              (() => {
                // Prefer full_name (new schema) then extra_data.first_name+last_name
                // (mock/legacy schema), then fall back to "Entity #N".
                const nm = entity?.full_name
                  || [entity?.extra_data?.first_name, entity?.extra_data?.last_name]
                    .filter(Boolean).join(' ')
                  || null;
                const label = nm
                  ? `${nm} · ${ENTITY_TYPE_DISPLAY(relationType)}`
                  : `Entity #${entity?.id} · ${ENTITY_TYPE_DISPLAY(relationType)}`;
                return (
                  <span
                    className="text-xs text-slate-500 truncate"
                    title={label}
                  >
                    {label}
                  </span>
                );
              })()
            )}
            {phone.customer_tier != null && (
              <Badge variant={tierVariant(phone.customer_tier)} size="xs">
                {SCORE_TIER_VALUE(phone.customer_tier)}
              </Badge>
            )}
          </div>
        </div>
      </td>

      )}
      {/* Column 3 — Two-axis truth dots. Vector A shows phone/person;
          Vector B shows network/identity. Identity for envelopes uses
          the diamond glyph (not a dot) to mark "unknown" as a distinct
          state from "pending verification". */}
      {visibleKeys.has('verification') && (
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col gap-1.5">
          <TruthAxis
            icon={envelope ? Radio : PhoneIcon}
            state={phoneState}
            title={envelope ? TRUTH_AXIS_PHONE_IN_NETWORK : TRUTH_AXIS_PHONE_PERSON}
          />
          <TruthAxis
            icon={envelope ? Search : User}
            state={identityState}
            title={envelope ? TRUTH_AXIS_IDENTITY : TRUTH_AXIS_PERSON_TARGET}
            // Envelopes always show diamond on the identity axis until
            // promoted to a named entity — distinct from "pending".
            forceDiamond={envelope}
          />
        </div>
      </td>

      )}
      {/* Column 4 — Action mini-pipeline */}
      {visibleKeys.has('actions') && (
      <td className="px-4 py-3 align-middle">
        <ActionMiniPipeline logs={logs} />
      </td>
      )}

      {/* Column 5 — Last updated + source */}
      {visibleKeys.has('updated') && (
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col">
          <span className="text-sm text-slate-700">{formatRelative(phone.updated_at)}</span>
          <span className="text-[11px] text-slate-400 uppercase tracking-wide">
            {phone.ingestion_source}
          </span>
        </div>
      </td>
      )}
    </tr>
  );
}


function TruthAxis({ icon: Icon, state, title, forceDiamond = false }) {
  // forceDiamond renders a diamond glyph instead of a coloured dot when
  // the state is intrinsically unknown (envelope identity axis). For all
  // other cases the dot colour communicates the state per TRUTH_STATE_DOT.
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-slate-500"
      title={`${title} · ${TRUTH_STATE_LABEL[state] || ''}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {forceDiamond ? (
        <Diamond className="w-2.5 h-2.5 text-slate-400 shrink-0" />
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${TRUTH_STATE_DOT[state]}`} />
      )}
    </span>
  );
}
