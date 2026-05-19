/**
 * EntitiesPage — UAT round-3 view tab for entities (persons + roots).
 *
 * Mirrors the PhoneGridPage shape with fewer columns because entities
 * carry no per-row operational actions:
 *
 *   ┌──────┬─────────────────┬─────────┬─────────┬───────────┬──────────┐
 *   │  ID  │  Name           │ Relation│ Client  │ # Phones  │ Created  │
 *   └──────┴─────────────────┴─────────┴─────────┴───────────┴──────────┘
 *
 * Shows BOTH primary (target) and associated (family/friend/...)
 * entities. Personalization toggle narrows by managed_client_ids.
 * Soft-deleted rows are hidden — surface them in /admin instead.
 *
 * Clicking the "# Phones" cell opens a popover with the linked
 * phones + their verification status + confidence score, so the
 * operator gets the per-number context without navigating away.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Phone as PhoneIcon, X } from 'lucide-react';

import { listEntities } from '../api/entityApi';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth }     from '../contexts/MockAuthContext';
import { getClientById } from '../config/clientRegistry';
import {
  PAGE_ENTITIES_TITLE, PAGE_ENTITIES_SUB,
  ENTITIES_COL_ID, ENTITIES_COL_NAME, ENTITIES_COL_RELATION,
  ENTITIES_COL_CLIENT, ENTITIES_COL_PHONES, ENTITIES_COL_CREATED,
  ENTITIES_EMPTY,
  ENTITIES_PHONES_POPOVER_TITLE, ENTITIES_PHONES_POPOVER_EMPTY,
  ENTITIES_PHONES_POPOVER_CONFIDENCE,
} from '../config/strings.he';


export default function EntitiesPage() {
  const mockDb = useMockData();
  const { personalizationActive, user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [openPhonesFor, setOpenPhonesFor] = useState(null);

  // Derive personalization narrowing.
  const personalizationClientIds =
    personalizationActive && user?.managed_client_ids?.length
      ? user.managed_client_ids
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listEntities(
        {
          clientIds: personalizationClientIds || undefined,
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

  // Active phones grouped by entity_id — drives BOTH the count cell
  // and the popover detail list.
  const phonesByEntity = useMemo(() => {
    const map = new Map();
    for (const p of mockDb.phones) {
      if (p.deleted_at) continue;
      if (!map.has(p.entity_id)) map.set(p.entity_id, []);
      map.get(p.entity_id).push(p);
    }
    return map;
  }, [mockDb.phones]);

  const openEntity = openPhonesFor
    ? items.find((e) => e.id === openPhonesFor)
    : null;
  const openPhones = openEntity ? (phonesByEntity.get(openEntity.id) || []) : [];

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
          <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase">
            <tr>
              <th className="text-start px-3 py-2 font-medium w-20">{ENTITIES_COL_ID}</th>
              <th className="text-start px-3 py-2 font-medium">{ENTITIES_COL_NAME}</th>
              <th className="text-start px-3 py-2 font-medium w-32">{ENTITIES_COL_RELATION}</th>
              <th className="text-start px-3 py-2 font-medium w-36">{ENTITIES_COL_CLIENT}</th>
              <th className="text-start px-3 py-2 font-medium w-28">{ENTITIES_COL_PHONES}</th>
              <th className="text-start px-3 py-2 font-medium w-32">{ENTITIES_COL_CREATED}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">{ENTITIES_EMPTY}</td></tr>
            ) : (
              items.map((e) => {
                const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || `#${e.id}`;
                const clientName = getClientById(e.client_id)?.name || `Client ${e.client_id}`;
                const created = e.created_at ? new Date(e.created_at).toLocaleDateString('he-IL') : '—';
                const phoneCount = (phonesByEntity.get(e.id) || []).length;
                return (
                  <tr
                    key={e.id}
                    data-testid="entity-row"
                    className="border-t border-slate-100 hover:bg-slate-50/60"
                  >
                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">#{e.id}</td>
                    <td className="px-3 py-2 text-slate-900">{name}</td>
                    <td className="px-3 py-2 text-slate-700">{e.entity_type}</td>
                    <td className="px-3 py-2 text-slate-700">{clientName}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setOpenPhonesFor(e.id)}
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
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{created}</td>
                  </tr>
                );
              })
            )}
          </tbody>
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


/**
 * PhonesPopover — compact modal listing the phones attached to one
 * entity. Kept simple because the count is small (5 phones is the
 * 99th-percentile case based on the seed); a virtualized scroller
 * would be overkill.
 */
function PhonesPopover({ entity, phones, onClose }) {
  const name = [entity.first_name, entity.last_name].filter(Boolean).join(' ') || `#${entity.id}`;
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
                    p.confidence_score != null ? Math.round(p.confidence_score * 100) : null,
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
