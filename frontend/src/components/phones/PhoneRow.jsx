/**
 * PhoneRow — a single row in the PhoneTable.
 *
 * Five strictly-sized columns; tooltip overflow is allowed by NOT setting
 * any overflow rule on <tr> or <td>; only inner divs clip text.
 *
 * Click selects the row → opens the detail drawer.
 */

import Badge from '../primitives/Badge';
import ActionMiniPipeline from './ActionMiniPipeline';
import {
  verificationVariant, verificationLabel,
  priorityVariant, tierVariant,
} from '../../utils/classifyStatus';
import { formatRelative } from '../../utils/formatDate';
import {
  SCORE_PRIORITY_LABEL, SCORE_TIER_VALUE, SCORE_ROW_TOOLTIP,
} from '../../config/strings.he';

export default function PhoneRow({ phone, entity, client, logs, isSelected, onSelect }) {
  // Phase DY — score-derived visuals. The priority badge inherits the
  // existing Badge variant palette (good/pending/failed) so it composes
  // with the rest of the row without introducing a new colour vocabulary.
  // The whole row carries a tooltip with all three scores so an operator
  // hovering anywhere on the row sees the rationale.
  const rowTooltip = SCORE_ROW_TOOLTIP(
    phone.priority_score,
    phone.confidence_score,
    phone.customer_tier,
  );

  return (
    <tr
      onClick={() => onSelect(phone.id)}
      title={rowTooltip}
      className={`cursor-pointer border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Column 1 — Phone + classification + priority pill (stacked) */}
      <td className="px-4 py-3 align-middle">
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

      {/* Column 2 — Client + entity + tier (stacked) */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col min-w-0 max-w-[180px] gap-1">
          <span
            className="text-sm font-medium text-slate-800 truncate"
            title={client?.name || ''}
          >
            {client?.name || '—'}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span
              className="text-xs text-slate-500 truncate"
              title={`Entity #${entity?.id} · ${entity?.entity_type || 'unknown'}`}
            >
              Entity #{entity?.id} · {entity?.entity_type || 'unknown'}
            </span>
            {phone.customer_tier != null && (
              <Badge variant={tierVariant(phone.customer_tier)} size="xs">
                {SCORE_TIER_VALUE(phone.customer_tier)}
              </Badge>
            )}
          </div>
        </div>
      </td>

      {/* Column 3 — Verification status + source */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col gap-1 items-start">
          <Badge variant={verificationVariant(phone.verification_status)} size="sm">
            {verificationLabel(phone.verification_status)}
          </Badge>
          {phone.verification_source && (
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">
              via {phone.verification_source}
            </span>
          )}
        </div>
      </td>

      {/* Column 4 — Action mini-pipeline */}
      <td className="px-4 py-3 align-middle">
        <ActionMiniPipeline logs={logs} />
      </td>

      {/* Column 5 — Last updated + source */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col">
          <span className="text-sm text-slate-700">{formatRelative(phone.updated_at)}</span>
          <span className="text-[11px] text-slate-400 uppercase tracking-wide">
            {phone.ingestion_source}
          </span>
        </div>
      </td>
    </tr>
  );
}
