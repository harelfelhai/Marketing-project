/**
 * PhoneTable — filtered table over the live MockDataContext state.
 *
 * Uses table-fixed with explicit colgroup widths. Filter application is
 * a useMemo derivation; the source of truth stays in context so
 * mutations propagate instantly.
 */

import { useMemo } from 'react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import PhoneRow        from './PhoneRow';
import Skeleton        from '../primitives/Skeleton';
import {
  TABLE_HEADER_PHONE, TABLE_HEADER_ASSOCIATION, TABLE_HEADER_VERIFICATION,
  TABLE_HEADER_ACTIONS, TABLE_HEADER_UPDATED, TABLE_EMPTY_PHONES, TABLE_SHOWING,
} from '../../config/strings.he';

const SKELETON_ROW_COUNT = 8;

/**
 * applyFilters — pure filter + sort function exposed for unit-testability.
 *
 * Mirrors the TaskTable.applyFilters pattern (DX-T2): the function is a
 * NAMED export so tests can exercise the filter / sort matrix without
 * mounting the React tree. The component still uses it via the same
 * call signature; production bundle is unaffected.
 */
export function applyFilters(phones, entities, clients, actionLogs, filters) {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const logsByPhone = actionLogs.reduce((acc, l) => {
    (acc[l.phone_id] ||= []).push(l);
    return acc;
  }, {});

  const rows = phones.map((phone) => {
    const entity = entityById.get(phone.entity_id);
    const client = entity ? clientById.get(entity.client_id) : null;
    const logs   = logsByPhone[phone.id] || [];
    return { phone, entity, client, logs };
  });

  // Phase AUTH-C — multi-value personalization filter. When the
  // header toggle is ON, PhoneGridPage passes the operator's
  // managed_client_ids as filters.clientIds; rows whose entity
  // doesn't belong to one of those clients are hidden.
  const clientIdsAllowed = filters.clientIds?.length
    ? new Set(filters.clientIds.map(Number))
    : null;

  const filtered = rows.filter(({ phone, entity, client }) => {
    // UAT round-3: hide soft-deleted rows from the regular grid. The
    // admin tab queries the same data with include_deleted=true.
    if (phone.deleted_at || entity?.deleted_at)                                                    return false;
    if (clientIdsAllowed && !clientIdsAllowed.has(entity?.client_id))                              return false;
    // UAT regression: the PhoneFilterBar's <select> emits e.target.value
    // as a string ("1"), but the real-mode entity.client_id arrives as
    // an integer. A strict `!==` always tripped, emptying the table.
    // Stringify both sides to match the §5.1 cross-link coercion rule.
    if (filters.clientId && String(entity?.client_id) !== String(filters.clientId))               return false;
    if (filters.verificationStatus && phone.verification_status   !== filters.verificationStatus) return false;
    if (filters.ingestionSource    && phone.ingestion_source      !== filters.ingestionSource)    return false;
    if (filters.classificationType && phone.classification_type   !== filters.classificationType) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      const hay = [
        phone.phone_number,
        String(phone.entity_id),
        client?.name || '',
        client?.id   || '',
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Phase DY — client-side re-sort. The data in `db.phones` was fetched
  // with the backend's default ordering (priority DESC); switching the
  // toggle re-sorts the in-memory rows without a network round-trip.
  // Same NULLS-LAST + id-DESC tiebreaker as the backend's ORDER BY so
  // mock-mode and real-mode produce identical visible ordering.
  const sortBy = filters.sortBy || 'priority';
  if (sortBy === 'ingested_at') {
    filtered.sort((a, b) => {
      const da = new Date(a.phone.ingested_at).getTime();
      const db = new Date(b.phone.ingested_at).getTime();
      if (da !== db) return db - da;
      return b.phone.id - a.phone.id;
    });
  } else {
    filtered.sort((a, b) => {
      const aHas = a.phone.priority_score != null;
      const bHas = b.phone.priority_score != null;
      if (aHas !== bHas) return aHas ? -1 : 1;                   // NULLS LAST
      if (aHas && bHas && a.phone.priority_score !== b.phone.priority_score) {
        return b.phone.priority_score - a.phone.priority_score;  // DESC
      }
      return b.phone.id - a.phone.id;                            // tiebreaker
    });
  }
  return filtered;
}

export default function PhoneTable({ selectedId, onSelect, clientIds }) {
  const { phones, entities, clients, actionLogs, loading } = useMockData();
  const { phoneFilters } = useUI();

  // Phase AUTH-C — merge personalization clientIds (from PhoneGridPage,
  // which derives them from useAuth) into the filter shape so the
  // table view honors the global toggle without re-reading the auth
  // context here.
  const effectiveFilters = useMemo(
    () => (clientIds?.length ? { ...phoneFilters, clientIds } : phoneFilters),
    [phoneFilters, clientIds]
  );

  const rows = useMemo(
    () => applyFilters(phones, entities, clients, actionLogs, effectiveFilters),
    [phones, entities, clients, actionLogs, effectiveFilters]
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200" aria-busy={loading || undefined}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[180px]" />
          <col className="w-[200px]" />
          <col className="w-[160px]" />
          <col />
          <col className="w-[140px]" />
        </colgroup>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>{TABLE_HEADER_PHONE}</Th>
            <Th>{TABLE_HEADER_ASSOCIATION}</Th>
            <Th>{TABLE_HEADER_VERIFICATION}</Th>
            <Th>{TABLE_HEADER_ACTIONS}</Th>
            <Th>{TABLE_HEADER_UPDATED}</Th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <SkeletonRow key={i} />
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">
                {TABLE_EMPTY_PHONES}
              </td>
            </tr>
          ) : (
            rows.map(({ phone, entity, client, logs }) => (
              <PhoneRow
                key={phone.id}
                phone={phone}
                entity={entity}
                client={client}
                logs={logs}
                isSelected={selectedId === phone.id}
                onSelect={onSelect}
              />
            ))
          )}
        </tbody>
      </table>

      <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        {loading ? ' ' : TABLE_SHOWING(rows.length, phones.length)}
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="80%" />
          <Skeleton height={10} width="50%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="70%" />
          <Skeleton height={10} width="40%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={14} width={80} rounded="rounded-full" />
          <Skeleton height={10} width="55%" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton height={20} width={20} rounded="rounded-full" />
          <Skeleton height={20} width={20} rounded="rounded-full" />
          <Skeleton height={20} width={20} rounded="rounded-full" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton height={10} width="80%" />
      </td>
    </tr>
  );
}

function Th({ children }) {
  return (
    <th className="px-4 py-2.5 text-start text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
      {children}
    </th>
  );
}
