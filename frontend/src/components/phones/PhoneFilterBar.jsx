/**
 * PhoneFilterBar — data-driven filter bar for the phones surface.
 *
 * Active filter fields are loaded from system settings (filter_fields.phones).
 * When a field is deactivated its UIContext value is cleared automatically.
 * Filter state lives in UIContext so values survive tab navigation.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';

import { useUI }       from '../../contexts/UIContext';
import { useMockData } from '../../contexts/MockDataContext';
import { PHONE_TYPES } from '../../mock/mockData';
import { getSystemSettings } from '../../api/systemApi';
import { resolveActiveFilters, defaultFilterKeys, FILTER_SURFACES } from '../../config/filterFields';
import {
  FILTER_SEARCH_PLACEHOLDER, FILTER_ALL_CLIENTS, FILTER_ALL_STATUSES,
  FILTER_STATUS_PENDING, FILTER_STATUS_GOOD, FILTER_STATUS_BAD,
  FILTER_ALL_SOURCES, FILTER_SOURCE_API, FILTER_SOURCE_MANUAL,
  FILTER_SOURCE_IMPORT, FILTER_SOURCE_PARTNER, FILTER_ALL_CLASSIFICATIONS,
  FILTER_BTN_CLEAR,
  FILTER_ENTITY_NAME_PLACEHOLDER, FILTER_ALL_RELATION_TYPES,
} from '../../config/strings.he';
import {
  ENTITY_OPTION_FAMILY, ENTITY_OPTION_FRIEND,
  ENTITY_OPTION_COLLEAGUE, ENTITY_OPTION_SPOUSE,
} from '../../config/strings.he';

const VERIFICATION_OPTIONS = [
  { value: '',         label: FILTER_ALL_STATUSES },
  { value: 'pending',  label: FILTER_STATUS_PENDING },
  { value: 'verified', label: FILTER_STATUS_GOOD },
  { value: 'rejected', label: FILTER_STATUS_BAD },
];

const SOURCE_OPTIONS = [
  { value: '',              label: FILTER_ALL_SOURCES },
  { value: 'api',           label: FILTER_SOURCE_API },
  { value: 'manual',        label: FILTER_SOURCE_MANUAL },
  { value: 'import',        label: FILTER_SOURCE_IMPORT },
  { value: 'partner_feed',  label: FILTER_SOURCE_PARTNER },
];

const RELATION_TYPE_OPTIONS = [
  { value: '',          label: FILTER_ALL_RELATION_TYPES },
  { value: 'family',    label: ENTITY_OPTION_FAMILY },
  { value: 'friend',    label: ENTITY_OPTION_FRIEND },
  { value: 'colleague', label: ENTITY_OPTION_COLLEAGUE },
  { value: 'spouse',    label: ENTITY_OPTION_SPOUSE },
  { value: 'associated', label: 'קשור' },
];

// All keys that map to a '' default (text/select filters). Used for auto-clear.
const TEXT_SELECT_KEYS = ['search', 'clientId', 'verificationStatus', 'ingestionSource', 'phoneType', 'entityName', 'relationType'];

export default function PhoneFilterBar() {
  const mockDb = useMockData();
  const { clients } = mockDb;
  const { phoneFilters, updatePhoneFilters, resetPhoneFilters } = useUI();

  // Load active filter fields from settings.
  const [activeFilters, setActiveFilters] = useState(() =>
    resolveActiveFilters('phones', null)
  );
  useEffect(() => {
    let alive = true;
    getSystemSettings(mockDb)
      .then((s) => {
        if (!alive) return;
        setActiveFilters(resolveActiveFilters('phones', s.filter_fields || {}));
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeKeys = useMemo(() => new Set(activeFilters.map((f) => f.key)), [activeFilters]);

  // Auto-clear UIContext values for text/select fields that are no longer active.
  useEffect(() => {
    const toClear = {};
    for (const key of TEXT_SELECT_KEYS) {
      if (!activeKeys.has(key) && phoneFilters[key]) {
        toClear[key] = '';
      }
    }
    if (Object.keys(toClear).length > 0) updatePhoneFilters(toClear);
    // Only re-run when the active keys set changes (after settings load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys]);

  const hasAny = TEXT_SELECT_KEYS.some((k) => phoneFilters[k]);

  const selectClass =
    'h-9 px-3 text-sm rounded-md border border-slate-300 bg-white text-slate-800 ' +
    'focus:outline-none focus:ring-2 focus:ring-slate-300 min-w-0';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">

      {activeKeys.has('search') && (
        <div className="relative grow min-w-[200px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={phoneFilters.search}
            onChange={(e) => updatePhoneFilters({ search: e.target.value })}
            placeholder={FILTER_SEARCH_PLACEHOLDER}
            className="w-full h-9 pr-8 ps-3 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
      )}

      {activeKeys.has('entityName') && (
        <div className="relative min-w-[180px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={phoneFilters.entityName}
            onChange={(e) => updatePhoneFilters({ entityName: e.target.value })}
            placeholder={FILTER_ENTITY_NAME_PLACEHOLDER}
            className="w-full h-9 pr-8 ps-3 text-sm rounded-md border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
      )}

      {activeKeys.has('clientId') && (
        <select
          value={phoneFilters.clientId}
          onChange={(e) => updatePhoneFilters({ clientId: e.target.value })}
          className={selectClass}
        >
          <option value="">{FILTER_ALL_CLIENTS}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {activeKeys.has('verificationStatus') && (
        <select
          value={phoneFilters.verificationStatus}
          onChange={(e) => updatePhoneFilters({ verificationStatus: e.target.value })}
          className={selectClass}
        >
          {VERIFICATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {activeKeys.has('ingestionSource') && (
        <select
          value={phoneFilters.ingestionSource}
          onChange={(e) => updatePhoneFilters({ ingestionSource: e.target.value })}
          className={selectClass}
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {activeKeys.has('phoneType') && (
        <select
          value={phoneFilters.phoneType}
          onChange={(e) => updatePhoneFilters({ phoneType: e.target.value })}
          className={selectClass}
        >
          <option value="">{FILTER_ALL_CLASSIFICATIONS}</option>
          {(PHONE_TYPES || []).map((t) => (
            <option key={t} value={t}>{t.toUpperCase()}</option>
          ))}
        </select>
      )}

      {activeKeys.has('relationType') && (
        <select
          value={phoneFilters.relationType}
          onChange={(e) => updatePhoneFilters({ relationType: e.target.value })}
          className={selectClass}
        >
          {RELATION_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {hasAny && (
        <button
          type="button"
          onClick={resetPhoneFilters}
          className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {FILTER_BTN_CLEAR}
        </button>
      )}
    </div>
  );
}
