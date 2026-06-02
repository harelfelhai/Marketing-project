/**
 * PhoneTable — filtered, grouped-by-root-entity table over MockDataContext state.
 *
 * Phones are grouped into accordion sections by their root entity.
 * Each accordion header shows the root entity name and phone count for that
 * group; clicking it toggles the rows. Groups default to collapsed.
 *
 * Column visibility is driven by system settings (display_fields.phones).
 * The first column (phone_number + phone_type + score) is always shown.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { useMockData } from '../../contexts/MockDataContext';
import { useUI }       from '../../contexts/UIContext';
import PhoneRow        from './PhoneRow';
import Skeleton        from '../primitives/Skeleton';
import { resolveVisibleColumns } from '../../config/displayFields';
import { getSystemSettings }     from '../../api/systemApi';
import {
  TABLE_HEADER_PHONE, TABLE_EMPTY_PHONES, TABLE_SHOWING,
} from '../../config/strings.he';

const PHONE_COL_WIDTH = {
  root_name:    '160px',
  root_role:    '180px',
  entity_name:  '140px',
  relation:     '110px',
  association:  '200px',
  verification: '160px',
  actions:      null,
  updated:      '140px',
};

const SKELETON_ROW_COUNT = 8;

export function applyFilters(phones, entities, clients, filters) {
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const rows = phones.map((phone) => {
    const entity = entityById.get(phone.entity_id);
    const client = entity ? clientById.get(entity.root_entity_id) : null;
    const rootEntityId = entity?.target_entity_id ?? entity?.id;
    const rootEntity = rootEntityId != null ? entityById.get(rootEntityId) : null;
    return { phone, entity, client, rootEntity };
  });

  const clientIdsAllowed = filters.rootEntityIds?.length
    ? new Set(filters.rootEntityIds.map(Number))
    : null;

  const filtered = rows.filter(({ phone, entity }) => {
    if (phone.deleted_at || entity?.deleted_at)                                                    return false;
    if (clientIdsAllowed && !clientIdsAllowed.has(entity?.root_entity_id))                              return false;
    if (filters.rootEntityId && String(entity?.root_entity_id) !== String(filters.rootEntityId))               return false;
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
        // search also matches root entity name via client
        rows.find(r => r.phone.id === phone.id)?.rootEntity?.full_name || '',
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

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

export default function PhoneTable({ selectedId, onSelect, rootEntityIds }) {
  const mockDb = useMockData();
  const { phones, entities, clients, loading } = mockDb;
  const { phoneFilters } = useUI();

  const [displayFields, setDisplayFields] = useState(null);
  const [displayLabels, setDisplayLabels] = useState(null);
  useEffect(() => {
    let alive = true;
    getSystemSettings(mockDb)
      .then((s) => {
        if (!alive) return;
        setDisplayFields(s.display_fields || {});
        setDisplayLabels(s.display_labels || {});
      })
      .catch(() => { if (alive) { setDisplayFields({}); setDisplayLabels({}); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visibleCols = useMemo(
    () => resolveVisibleColumns('phones', displayFields, displayLabels),
    [displayFields, displayLabels],
  );
  const visibleKeys = useMemo(
    () => new Set(visibleCols.map((c) => c.key)),
    [visibleCols],
  );
  const colSpan = visibleCols.length + 1;

  const effectiveFilters = useMemo(
    () => (rootEntityIds?.length ? { ...phoneFilters, rootEntityIds } : phoneFilters),
    [phoneFilters, rootEntityIds]
  );

  const rows = useMemo(
    () => applyFilters(phones, entities, clients, effectiveFilters),
    [phones, entities, clients, effectiveFilters]
  );

  // Group rows by root entity id.
  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const rootId = row.rootEntity?.id ?? row.entity?.id ?? 'unknown';
      if (!map.has(rootId)) {
        map.set(rootId, { rootEntity: row.rootEntity, rows: [] });
      }
      map.get(rootId).rows.push(row);
    }
    return [...map.entries()].map(([rootId, group]) => ({ rootId, ...group }));
  }, [rows]);

  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const toggleGroup = (rootId) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(rootId) ? next.delete(rootId) : next.add(rootId);
      return next;
    });
  };

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

        {loading ? (
          <tbody>
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <SkeletonRow key={i} visibleKeys={visibleKeys} />
            ))}
          </tbody>
        ) : rows.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-400">
                {TABLE_EMPTY_PHONES}
              </td>
            </tr>
          </tbody>
        ) : (
          groups.map(({ rootId, rootEntity, rows: groupRows }) => {
            const isExpanded = expandedGroups.has(rootId);
            return (
              <tbody key={rootId}>
                {/* Accordion header */}
                <tr
                  className="border-b border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer select-none"
                  onClick={() => toggleGroup(rootId)}
                  data-testid={`phone-group-${rootId}`}
                >
                  <td colSpan={colSpan} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ChevronRight
                        className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                      />
                      <span className="font-semibold text-slate-800 text-sm">
                        {rootEntity?.full_name || rootId}
                      </span>
                      {rootEntity?.extra_data?.role && (
                        <span className="text-xs text-slate-500 truncate hidden sm:inline">
                          {rootEntity.extra_data.role}
                        </span>
                      )}
                      <span className="me-auto" />
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {groupRows.length} טלפונים
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Phone rows */}
                {isExpanded && groupRows.map(({ phone, entity, client, rootEntity: re }) => (
                  <PhoneRow
                    key={phone.id}
                    phone={phone}
                    entity={entity}
                    client={client}
                    rootEntity={re}
                    isSelected={selectedId === phone.id}
                    onSelect={onSelect}
                    visibleKeys={visibleKeys}
                  />
                ))}
              </tbody>
            );
          })
        )}
      </table>

      <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        {loading ? ' ' : TABLE_SHOWING(rows.length, phones.length)}
      </div>
    </div>
  );
}

const SKELETON_CELL_BY_KEY = {
  root_name:   <Skeleton height={12} width="70%" />,
  root_role:   <Skeleton height={10} width="60%" />,
  entity_name: <Skeleton height={12} width="65%" />,
  relation:    <Skeleton height={10} width="50%" />,
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
      {['root_name', 'root_role', 'entity_name', 'relation', 'association', 'verification', 'actions', 'updated']
        .filter((k) => visibleKeys.has(k))
        .map((k) => (
          <td key={k} className="px-4 py-3">
            {SKELETON_CELL_BY_KEY[k] || <Skeleton height={10} width="60%" />}
          </td>
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
