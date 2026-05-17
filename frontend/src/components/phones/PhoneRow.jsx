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
import { verificationVariant, verificationLabel } from '../../utils/classifyStatus';
import { formatRelative } from '../../utils/formatDate';

export default function PhoneRow({ phone, entity, client, logs, isSelected, onSelect }) {
  return (
    <tr
      onClick={() => onSelect(phone.id)}
      className={`cursor-pointer border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Column 1 — Phone number + classification_type sub-badge */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-sm font-semibold text-slate-900 truncate">
            {phone.phone_number}
          </span>
          {phone.classification_type ? (
            <Badge variant="info" size="xs" className="self-start uppercase tracking-wide">
              {phone.classification_type}
            </Badge>
          ) : (
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">—</span>
          )}
        </div>
      </td>

      {/* Column 2 — Association: Client + Entity (truncated, hover for full) */}
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col min-w-0 max-w-[180px]">
          <span
            className="text-sm font-medium text-slate-800 truncate"
            title={client?.name || ''}
          >
            {client?.name || '—'}
          </span>
          <span
            className="text-xs text-slate-500 truncate"
            title={`Entity #${entity?.id} · ${entity?.entity_type || 'unknown'}`}
          >
            Entity #{entity?.id} · {entity?.entity_type || 'unknown'}
          </span>
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
