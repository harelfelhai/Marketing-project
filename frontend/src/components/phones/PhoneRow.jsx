/**
 * PhoneRow — a single row in the PhoneTable.
 *
 * Handles both legacy column keys (association, updated) and new
 * granular keys (root_name, root_role, entity_name, relation).
 */

import { Phone as PhoneIcon } from 'lucide-react';

import Badge from '../primitives/Badge';
import { verificationVariant, scoreVariant } from '../../utils/classifyStatus';
import {
  ENTITY_TYPE_DISPLAY,
  PROVENANCE_TITLE_VECTOR_A,
} from '../../config/strings.he';

const _ALL_KEYS = new Set(['root_name', 'root_role', 'entity_name', 'relation', 'verification']);

export default function PhoneRow({
  phone, entity, client, rootEntity, isSelected, onSelect,
  visibleKeys = _ALL_KEYS,
}) {
  const relationType = entity?.relation_type;
  const pipClass = 'border-s-4 border-s-emerald-400';
  const pipTitle = PROVENANCE_TITLE_VECTOR_A;

  return (
    <tr
      onClick={() => onSelect(phone.id)}
      className={`cursor-pointer border-b border-slate-100 transition-colors ${
        isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60'
      }`}
    >
      {/* Always-visible: phone number + type + score */}
      <td className={`px-4 py-3 align-middle ${pipClass}`} title={pipTitle}>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-sm font-semibold text-slate-900 truncate">
            {phone.phone_number}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {phone.phone_type ? (
              <Badge variant="info" size="xs" className="uppercase tracking-wide">
                {phone.phone_type}
              </Badge>
            ) : (
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">—</span>
            )}
            {phone.score != null && (
              <Badge variant={scoreVariant(phone.score)} size="xs">
                {Math.round(phone.score * 100)}
              </Badge>
            )}
          </div>
        </div>
      </td>

      {/* root_name — root entity full_name */}
      {visibleKeys.has('root_name') && (
        <td className="px-4 py-3 align-middle">
          <span className="text-sm text-slate-800 truncate block max-w-[150px]" title={rootEntity?.full_name || ''}>
            {rootEntity?.full_name || '—'}
          </span>
        </td>
      )}

      {/* root_role — root entity role from extra_data */}
      {visibleKeys.has('root_role') && (
        <td className="px-4 py-3 align-middle">
          <span className="text-xs text-slate-500 truncate block max-w-[170px]" title={rootEntity?.extra_data?.role || ''}>
            {rootEntity?.extra_data?.role || '—'}
          </span>
        </td>
      )}

      {/* entity_name — the entity attached to this phone */}
      {visibleKeys.has('entity_name') && (
        <td className="px-4 py-3 align-middle">
          <span className="text-sm text-slate-700 truncate block max-w-[130px]" title={entity?.full_name || ''}>
            {entity?.full_name || '—'}
          </span>
        </td>
      )}

      {/* relation — entity relation_type */}
      {visibleKeys.has('relation') && (
        <td className="px-4 py-3 align-middle">
          <span className="text-xs text-slate-600">
            {relationType ? ENTITY_TYPE_DISPLAY(relationType) : '—'}
          </span>
        </td>
      )}

      {/* association — legacy combined client+entity column */}
      {visibleKeys.has('association') && (
        <td className="px-4 py-3 align-middle">
          <div className="flex flex-col min-w-0 max-w-[180px] gap-1">
            <span className="text-sm font-medium text-slate-800 truncate" title={client?.name || ''}>
              {client?.name || '—'}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {entity?.full_name ? (
                <span className="text-xs text-slate-500 truncate" title={entity.full_name}>
                  {entity.full_name} · {ENTITY_TYPE_DISPLAY(relationType)}
                </span>
              ) : (
                <span className="text-xs text-slate-500 truncate">
                  #{entity?.id} · {ENTITY_TYPE_DISPLAY(relationType)}
                </span>
              )}
            </div>
          </div>
        </td>
      )}

      {/* verification status badge */}
      {visibleKeys.has('verification') && (
        <td className="px-4 py-3 align-middle">
          <div className="inline-flex items-center gap-1 text-xs text-slate-600">
            <PhoneIcon className="w-3 h-3 shrink-0" />
            <Badge variant={verificationVariant(phone.verification_status)} size="xs">
              {phone.verification_status || '—'}
            </Badge>
          </div>
        </td>
      )}

      {/* updated — ingestion source (legacy) */}
      {visibleKeys.has('updated') && (
        <td className="px-4 py-3 align-middle">
          <span className="text-sm text-slate-600 uppercase tracking-wide">
            {phone.ingestion_source || '—'}
          </span>
        </td>
      )}
    </tr>
  );
}
