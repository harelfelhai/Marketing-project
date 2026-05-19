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
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { listEntities } from '../api/entityApi';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth }     from '../contexts/MockAuthContext';
import { getClientById } from '../config/clientRegistry';
import {
  PAGE_ENTITIES_TITLE, PAGE_ENTITIES_SUB,
  ENTITIES_COL_ID, ENTITIES_COL_NAME, ENTITIES_COL_RELATION,
  ENTITIES_COL_CLIENT, ENTITIES_COL_PHONES, ENTITIES_COL_CREATED,
  ENTITIES_EMPTY,
} from '../config/strings.he';


export default function EntitiesPage() {
  const mockDb = useMockData();
  const { personalizationActive, user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

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

  // Phone-count lookup by entity_id (active phones only).
  const phoneCountByEntity = useMemo(() => {
    const map = new Map();
    for (const p of mockDb.phones) {
      if (p.deleted_at) continue;
      map.set(p.entity_id, (map.get(p.entity_id) || 0) + 1);
    }
    return map;
  }, [mockDb.phones]);

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
              <th className="text-start px-3 py-2 font-medium w-24">{ENTITIES_COL_PHONES}</th>
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
                    <td className="px-3 py-2 text-slate-700">{phoneCountByEntity.get(e.id) || 0}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs">{created}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
