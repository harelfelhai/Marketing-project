/**
 * PhoneTable — filtered table over the live MockDataContext state.
 *
 * Uses table-fixed with explicit colgroup widths. Filter application is
 * a useMemo derivation; the source of truth stays in context so
 * mutations propagate instantly.
 */

import { useEffect, useMemo, useState } from 'react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import PhoneRow        from './PhoneRow';
import Skeleton        from '../primitives/Skeleton';
import { resolveVisibleColumns } from '../../config/displayFields';
import { getSystemSettings }     from '../../api/systemApi';
import {
  TABLE_HEADER_PHONE, TABLE_EMPTY_PHONES, TABLE_SHOWING,
} from '../../config/strings.he';

// Column-width hints per configurable phone-table key. The phone column
// (row identity, always shown) gets a fixed 180px; the rest size
// proportionally to the column count.
const PHONE_COL_WIDTH = {
  association:  '200px',
  verification: '160px',
  actions:      null,        // flex — fills remaining space
  updated:      '140px',
};

const SKELETON_ROW_COUNT = 8;

/**
 * applyFilters — pure filter + sort function exposed for unit-testability.
 *
 * Mirrors the TaskTable.applyFilters pattern (DX-T2): the function is a
 * NAMED export so tests can exercise the filter / sort matrix without
 * mounting the React tree. The component still uses it via the same
 * call signature; production bundle is unaffected.
 */
export function applyFilters(phones, entities, clients, filters) {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const rows = phones.map((phone) => {
    const entity = entityById.get(phone.entity_id);
    const client = entity ? clientById.get(entity.client_id) : null;
    return { phone, entity, client };
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
    if (filters.verificationStatus && phone.verification_status !== filters.verificationStatus) return false;
    if (filters.ingestionSource    && phone.ingestion_source    !== filters.ingestionSource)    return false;
    if (filters.phoneType          && phone.phone_type          !== filters.phoneType)          return false;
    if (filters.relationType       && entity?.relation_type     !== filters.relationType)       return false;
    if (filters.entityName) {
      const q = filters.entityName.toLowerCase().trim();
      if (!entity?.full_name?.toLowerCase().includes(q)) return false;
    }
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
  filtered.sort((a, b) => {
    const aHas = a.phone.score != null;
    const bHas = b.phone.score != null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.phone.score !== b.phone.score) {
      return b.phone.score - a.phone.score;
    }
    return String(b.phone.id).localeCompare(String(a.phone.id));
  });
  return filtered;
}

export default function PhoneTable({ selectedId, onSelect, clientIds }) {
  const mockDb = useMockData();
  const { phones, entities, clients, loading } = mockDb;
  const { phoneFilters } = useUI();

  // Configurable display fields — driven by /system/settings → display_fields.
  const [displayFields, setDisplayFields] = useState(null);
  useEffect(() => {
    let alive = true;
    getSystemSettings(mockDb)
      .then((s) => { if (alive) setDisplayFields(s.display_fields || {}); })
      .catch(() => { if (alive) setDisplayFields({}); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visibleCols = useMemo(
    () => resolveVisibleColumns('phones', displayFields),
    [displayFields],
  );
  const visibleKeys = useMemo(
    () => new Set(visibleCols.map((c) => c.key)),
    [visibleCols],
  );
  // colSpan for skeleton / empty rows (phone column + every visible one).
  const colSpan = visibleCols.length + 1;

  // Phase AUTH-C — merge personalization clientIds (from PhoneGridPage,
  // which derives them from useAuth) into the filter shape so the
  // table view honors the global toggle without re-reading the auth
  // context here.
  const effectiveFilters = useMemo(
    () => (clientIds?.length ? { ...phoneFilters, clientIds } : phoneFilters),
    [phoneFilters, clientIds]
  );

  const rows = useMemo(
    () => applyFilters(phones, entities, clients, effectiveFilters),
    [phones, entities, clients, effectiveFilters]
  );

  return (
    <div className="bg-white rounded-lg border border-slate-200" aria-busy={loading || undefined}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-[180px]" />
          {visibleCols.map((c) => {
            const w = PHONE_COL_WIDTH[c.key];
            return <col key={c.key} className={w ? `w-[${w}]` : ''} />;
          })}
        </colgroup>
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <Th>{TABLE_HEADER_PHONE}</Th>
            {visibleCols.map((c) => <Th key={c.key}>{c.label}</Th>)}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <SkeletonRow key={i} visibleKeys={visibleKeys} />
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-400">
                {TABLE_EMPTY_PHONES}
              </td>
            </tr>
          ) : (
            rows.map(({ phone, entity, client }) => (
              <PhoneRow
                key={phone.id}
                phone={phone}
                entity={entity}
                client={client}
                isSelected={selectedId === phone.id}
                onSelect={onSelect}
                visibleKeys={visibleKeys}
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

const SKELETON_CELL_BY_KEY = {
  association: (
    <div className="flex flex-col gap-1.5 min-w-0">
      <Skeleton height={12} width="70%" />
      <Skeleton height={10} width="40%" />
    </div>
  ),
  verification: (
    <div className="flex flex-col gap-1.5 min-w-0">
      <Skeleton height={14} width={80} rounded="rounded-full" />
      <Skeleton height={10} width="55%" />
    </div>
  ),
  actions: (
    <div className="flex items-center gap-2">
      <Skeleton height={20} width={20} rounded="rounded-full" />
      <Skeleton height={20} width={20} rounded="rounded-full" />
      <Skeleton height={20} width={20} rounded="rounded-full" />
    </div>
  ),
  updated: <Skeleton height={10} width="80%" />,
};

function SkeletonRow({ visibleKeys }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Skeleton height={12} width="80%" />
          <Skeleton height={10} width="50%" />
        </div>
      </td>
      {['association', 'verification', 'actions', 'updated']
        .filter((k) => visibleKeys.has(k))
        .map((k) => (
          <td key={k} className="px-4 py-3">{SKELETON_CELL_BY_KEY[k]}</td>
        ))}
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
