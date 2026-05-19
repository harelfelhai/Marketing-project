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

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import PhoneFilterBar     from '../components/phones/PhoneFilterBar';
import PhoneTable         from '../components/phones/PhoneTable';
import PhoneDetailDrawer  from '../components/phones/PhoneDetailDrawer';
import TableExportButton  from '../components/exports/TableExportButton';
import { useUI }          from '../contexts/UIContext';
import { useAuth }        from '../contexts/MockAuthContext';
import { PAGE_PHONE_GRID_TITLE, PAGE_PHONE_GRID_SUB } from '../config/strings.he';

export default function PhoneGridPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { seedClientFilter, phoneFilters } = useUI();
  const { personalizationActive, user }    = useAuth();
  const [selectedId, setSelectedId]     = useState(null);

  // Phase AUTH-C — derive effective personalization clientIds from
  // useAuth(). When the global toggle is ON and the user has managed
  // clients, every list view + export narrows to those clients.
  const personalizationClientIds =
    personalizationActive && user?.managed_client_ids?.length
      ? user.managed_client_ids
      : null;

  // Translate the UIContext filter shape into the GET /phones query
  // shape that ExportService expects. Lazy callback (not memoized
  // state) so the click reads the LIVE filter state, not a snapshot
  // captured at render time.
  const getCurrentFilters = useCallback(() => {
    const f = {};
    if (phoneFilters.clientId !== '' && phoneFilters.clientId != null) f.client_id = phoneFilters.clientId;
    if (phoneFilters.verificationStatus)                                f.verification_status = phoneFilters.verificationStatus;
    if (phoneFilters.ingestionSource)                                   f.ingestion_source    = phoneFilters.ingestionSource;
    if (phoneFilters.classificationType)                                f.classification_type = phoneFilters.classificationType;
    if (phoneFilters.search)                                            f.q                   = phoneFilters.search.trim();
    if (personalizationClientIds)                                       f.client_ids          = personalizationClientIds;
    return f;
  }, [phoneFilters, personalizationClientIds]);

  // Seed the persistent filter from ?client_id on mount (and any subsequent
  // change). Filter state lives in UIContext so it survives nav.
  useEffect(() => {
    const raw = searchParams.get('client_id');
    if (raw) {
      // Real-API mode uses integer client_ids; URL params are always strings.
      // Parse to number when the param is purely numeric so filter comparisons
      // against integer entity.client_id values succeed without coercion.
      const parsed = Number(raw);
      seedClientFilter(Number.isFinite(parsed) && raw.trim() !== '' ? parsed : raw);
    }
    // We intentionally do NOT clear the filter when the param is absent —
    // operators may have set it manually via the dropdown.
  }, [searchParams, seedClientFilter]);

  // Phase DX cross-link landing — when arriving from TaskDetailDrawer's
  // "פתח כרטיס טלפון" link with ?phone_id=N, auto-open the matching
  // drawer. Numeric coercion same as §5.1.
  useEffect(() => {
    const raw = searchParams.get('phone_id');
    if (raw) {
      const parsed = Number(raw);
      const id = Number.isFinite(parsed) && raw.trim() !== '' ? parsed : null;
      if (id != null) setSelectedId(id);
    }
  }, [searchParams]);

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
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{PAGE_PHONE_GRID_TITLE}</h1>
          <p className="text-sm text-slate-500 mt-1">{PAGE_PHONE_GRID_SUB}</p>
        </div>
        <TableExportButton
          tableId="phones"
          getCurrentFilters={getCurrentFilters}
          filenameHint={phoneFilters.verificationStatus || undefined}
        />
      </header>

      <PhoneFilterBar />
      <PhoneTable
        selectedId={selectedId}
        onSelect={setSelectedId}
        clientIds={personalizationClientIds}
      />

      <PhoneDetailDrawer phoneId={selectedId} onClose={handleCloseDrawer} />
    </section>
  );
}
