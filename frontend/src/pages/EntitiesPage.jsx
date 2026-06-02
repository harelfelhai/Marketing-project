/**
 * EntitiesPage — entity table grouped by root entity (accordion).
 *
 * Entities are grouped by their root entity (target_entity_id → primary).
 * Each accordion header shows root entity name, entity count, and phone
 * count for the whole group. Clicking the header toggles the row list.
 * The root entity itself appears as the first row inside the open group.
 *
 * Column visibility is driven by system settings (display_fields.entities).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Phone as PhoneIcon, X } from 'lucide-react';

import { listEntities } from '../api/entityApi';
import { getSystemSettings } from '../api/systemApi';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth }     from '../contexts/MockAuthContext';
import { getClientById } from '../config/clientRegistry';
import { resolveVisibleColumns } from '../config/displayFields';
import {
  PAGE_ENTITIES_TITLE, PAGE_ENTITIES_SUB,
  ENTITIES_EMPTY,
  ENTITIES_PHONES_POPOVER_TITLE, ENTITIES_PHONES_POPOVER_EMPTY,
  ENTITIES_PHONES_POPOVER_CONFIDENCE,
} from '../config/strings.he';


function renderEntityCell(key, e, ctx) {
  const root = ctx.rootEntityById?.get(e.target_entity_id ?? e.id);
  switch (key) {
    case 'root_name':
      return root?.full_name
        ? <span className="text-slate-800 font-medium">{root.full_name}</span>
        : <span className="text-slate-300">—</span>;
    case 'root_role':
      return root?.extra_data?.role
        ? <span className="text-slate-600 text-xs">{root.extra_data.role}</span>
        : <span className="text-slate-300">—</span>;
    case 'root_identifier':
      return root?.identifier_1
        ? <span className="text-slate-700 font-mono text-xs">{root.identifier_1}</span>
        : <span className="text-slate-300">—</span>;
    case 'id':
      return <span className="text-slate-500 font-mono text-xs">#{e.id}</span>;
    case 'name':
      return e.full_name
        ? <span className="text-slate-900">{e.full_name}</span>
        : <span className="text-slate-400 italic">ללא שם</span>;
    case 'identifier_1':
      return e.identifier_1
        ? <span className="text-slate-700 font-mono text-xs">{e.identifier_1}</span>
        : <span className="text-slate-300">—</span>;
    case 'identifier_2':
      return e.identifier_2
        ? <span className="text-slate-700 font-mono text-xs">{e.identifier_2}</span>
        : <span className="text-slate-300">—</span>;
    case 'relation':
      return <span className="text-slate-700">{e.relation_type}</span>;
    case 'client': {
      const clientName = getClientById(e.root_entity_id)?.name || `Client ${e.root_entity_id}`;
      return <span className="text-slate-700">{clientName}</span>;
    }
    case 'phones': {
      const phoneCount = (ctx.phonesByEntity.get(e.id) || []).length;
      return (
        <button
          type="button"
          onClick={() => ctx.setOpenPhonesFor(e.id)}
          disabled={phoneCount === 0}
          data-testid={`entity-phones-count-${e.id}`}
          className={[
            'inline-flex items-center gap-1.5 h-7 px-2 rounded text-xs transition-colors',
            phoneCount === 0
              ? 'text-slate-400 cursor-default'
              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer',
          ].join(' ')}
        >
          <PhoneIcon className="w-3 h-3" />
          {phoneCount}
        </button>
      );
    }
    case 'created':
      return <span className="text-slate-300">—</span>;
    default:
      return null;
  }
}


export default function EntitiesPage() {
  const mockDb = useMockData();
  const { personalizationActive, user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [openPhonesFor, setOpenPhonesFor] = useState(null);
  const [displayFields, setDisplayFields] = useState(null);
  const [displayLabels, setDisplayLabels] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

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

  const columns = useMemo(
    () => resolveVisibleColumns('entities', displayFields, displayLabels),
    [displayFields, displayLabels],
  );

  const personalizationClientIds =
    personalizationActive && user?.managed_client_ids?.length
      ? user.managed_client_ids
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listEntities(
        {
          rootEntityIds: personalizationClientIds || undefined,
          q: q.trim() || undefined,
        },
        mockDb,
      );
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [mockDb, personalizationClientIds, q]);

  useEffect(() => { load(); }, [load]);

  // Map of all (unfiltered) entities by id — used for root-entity lookups
  // in accordion headers and in renderEntityCell.
  const rootEntityById = useMemo(() => {
    const map = new Map();
    for (const e of mockDb.entities) {
      map.set(e.id, e);
    }
    return map;
  }, [mockDb.entities]);

  // Active phones grouped by entity_id.
  const phonesByEntity = useMemo(() => {
    const map = new Map();
    for (const p of mockDb.phones) {
      if (p.deleted_at) continue;
      if (!map.has(p.entity_id)) map.set(p.entity_id, []);
      map.get(p.entity_id).push(p);
    }
    return map;
  }, [mockDb.phones]);

  // Group filtered items by root entity id. Root entity is sorted first
  // within each group.
  const groups = useMemo(() => {
    const map = new Map();
    for (const e of items) {
      const rootId = e.target_entity_id ?? e.id;
      if (!map.has(rootId)) map.set(rootId, []);
      map.get(rootId).push(e);
    }
    return [...map.entries()].map(([rootId, members]) => {
      members.sort((a, b) => {
        if (a.id === rootId) return -1;
        if (b.id === rootId) return 1;
        return 0;
      });
      return { rootId, members };
    });
  }, [items]);

  // Total phone count for a root entity group (across ALL its member
  // entities, not just those visible after search filtering).
  const groupPhoneCount = useCallback((rootId) => {
    let total = 0;
    for (const e of mockDb.entities) {
      if (e.deleted_at) continue;
      const eRootId = e.target_entity_id ?? e.id;
      if (eRootId === rootId) {
        total += (phonesByEntity.get(e.id) || []).length;
      }
    }
    return total;
  }, [mockDb.entities, phonesByEntity]);

  const toggleGroup = (rootId) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(rootId) ? next.delete(rootId) : next.add(rootId);
      return next;
    });
  };

  const openEntity = openPhonesFor
    ? items.find((e) => e.id === openPhonesFor)
    : null;
  const openPhones = openEntity ? (phonesByEntity.get(openEntity.id) || []) : [];

  const ctx = { phonesByEntity, setOpenPhonesFor, rootEntityById };

  return (
    <section className="space-y-4" dir="rtl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{PAGE_ENTITIES_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{PAGE_ENTITIES_SUB}</p>
      </header>

      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש לפי שם או מזהה…"
          data-testid="entities-search"
          className="block w-full h-9 px-2 rounded-md border border-slate-300 text-sm"
        />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">…</td>
              </tr>
            </tbody>
          ) : groups.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                  {ENTITIES_EMPTY}
                </td>
              </tr>
            </tbody>
          ) : (
            groups.map(({ rootId, members }) => {
              const rootEntity = rootEntityById.get(rootId);
              const isExpanded = expandedGroups.has(rootId);
              const phoneCount = groupPhoneCount(rootId);

              return (
                <tbody key={rootId}>
                  {/* Accordion header row */}
                  <tr
                    className="border-t border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer select-none"
                    onClick={() => toggleGroup(rootId)}
                    data-testid={`entity-group-${rootId}`}
                  >
                    <td colSpan={columns.length} className="px-3 py-2.5">
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
                          {members.length} ישויות · {phoneCount} טלפונים
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Column headers — repeated inside each opened group */}
                  {isExpanded && (
                    <tr className="bg-slate-100/60 text-slate-600 text-[11px] uppercase">
                      {columns.map((col) => (
                        <th key={col.key} className="text-start px-3 py-2 font-medium">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  )}

                  {/* Entity rows — shown when expanded */}
                  {isExpanded && members.map((e) => (
                    <tr
                      key={e.id}
                      data-testid="entity-row"
                      className="border-t border-slate-100 hover:bg-slate-50/60"
                    >
                      {columns.map((col) => (
                        <td key={col.key} className="px-3 py-2">
                          {renderEntityCell(col.key, e, ctx)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              );
            })
          )}
        </table>
      </div>

      {openEntity && (
        <PhonesPopover
          entity={openEntity}
          phones={openPhones}
          onClose={() => setOpenPhonesFor(null)}
        />
      )}
    </section>
  );
}


function PhonesPopover({ entity, phones, onClose }) {
  const name = entity.full_name || `#${entity.id}`;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      data-testid="entity-phones-popover"
    >
      <div
        className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-lg p-5 space-y-3"
        dir="rtl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            {ENTITIES_PHONES_POPOVER_TITLE(name)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {phones.length === 0 ? (
          <p className="text-sm text-slate-500 py-2">{ENTITIES_PHONES_POPOVER_EMPTY}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {phones.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                <div className="flex flex-col min-w-0">
                  <span className="font-mono text-sm text-slate-900" dir="ltr">
                    {p.phone_number}
                  </span>
                  <span className="text-[11px] text-slate-500 mt-0.5">
                    {p.verification_status}
                  </span>
                </div>
                <span className="text-xs text-slate-600 whitespace-nowrap">
                  {ENTITIES_PHONES_POPOVER_CONFIDENCE(
                    p.score != null ? Math.round(p.score * 100) : null,
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
