/**
 * PhoneGridPage — filter bar + table + detail drawer.
 *
 * On mount, reads the ?client_id query param and seeds the persistent
 * client filter via UIContext.seedClientFilter — this is what makes the
 * "click a Client Card → land here pre-filtered" flow work.
 *
 * The selected phone ID is local state (it's purely a UI concern); the
 * drawer renders unconditionally and short-circuits when phoneId is null.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import PhoneFilterBar     from '../components/phones/PhoneFilterBar';
import PhoneTable         from '../components/phones/PhoneTable';
import PhoneDetailDrawer  from '../components/phones/PhoneDetailDrawer';
import { useUI }          from '../contexts/UIContext';
import { PAGE_PHONE_GRID_TITLE, PAGE_PHONE_GRID_SUB } from '../config/strings.he';

export default function PhoneGridPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { seedClientFilter }            = useUI();
  const [selectedId, setSelectedId]     = useState(null);

  // Seed the persistent filter from ?client_id on mount (and any subsequent
  // change). Filter state lives in UIContext so it survives nav.
  useEffect(() => {
    const cid = searchParams.get('client_id');
    if (cid) seedClientFilter(cid);
    // We intentionally do NOT clear the filter when the param is absent —
    // operators may have set it manually via the dropdown.
  }, [searchParams, seedClientFilter]);

  // Closing the drawer should also drop ?phone_id from the URL if present.
  // (We don't currently sync selectedId to the URL but the hook is here
  // for future deep-linking work.)
  const handleCloseDrawer = () => {
    setSelectedId(null);
    if (searchParams.has('phone_id')) {
      const next = new URLSearchParams(searchParams);
      next.delete('phone_id');
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{PAGE_PHONE_GRID_TITLE}</h1>
          <p className="text-sm text-slate-500 mt-1">{PAGE_PHONE_GRID_SUB}</p>
        </div>
      </header>

      <PhoneFilterBar />
      <PhoneTable selectedId={selectedId} onSelect={setSelectedId} />

      <PhoneDetailDrawer phoneId={selectedId} onClose={handleCloseDrawer} />
    </section>
  );
}
