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
import { getSystemSettings } from '../../api/systemApi';
import { verificationLabel } from '../../utils/classifyStatus';
import { resolveActiveFilters, defaultFilterKeys, FILTER_SURFACES } from '../../config/filterFields';
import { resolveCustomFilters } from '../../config/customFilters';
import CustomFilterControls from '../filters/CustomFilterControls';
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

// Token → Hebrew label maps for the controlled lists. Unknown tokens (e.g.
// operator-added vocab values) fall back to the raw token. The OPTION arrays
// are built inside the component from the managed vocabularies.
const SOURCE_LABELS = {
  api:          FILTER_SOURCE_API,
  manual:       FILTER_SOURCE_MANUAL,
  import:       FILTER_SOURCE_IMPORT,
  partner_feed: FILTER_SOURCE_PARTNER,
};
const RELATION_LABELS = {
  family:    ENTITY_OPTION_FAMILY,
  friend:    ENTITY_OPTION_FRIEND,
  colleague: ENTITY_OPTION_COLLEAGUE,
  spouse:    ENTITY_OPTION_SPOUSE,
  associated: 'קשור',
};
// "all" sentinel + a vocab list → [{value,label}], with a label resolver.
function _opts(allLabel, values, labelOf) {
  return [{ value: '', label: allLabel }, ...values.map((v) => ({ value: v, label: labelOf(v) }))];
}

// All keys that map to a '' default (text/select filters). Used for auto-clear.
const TEXT_SELECT_KEYS = ['search', 'rootEntityId', 'verificationStatus', 'ingestionSource', 'phoneType', 'entityName', 'relationType'];

export default function PhoneFilterBar() {
  const mockDb = useMockData();
  const { clients, vocabularies } = mockDb;
  const {
    phoneFilters, updatePhoneFilters, resetPhoneFilters,
    customFilterValues, updateCustomFilterValues, resetCustomFilterValues,
  } = useUI();
  const customValues = customFilterValues.phones || {};

  // Options sourced from the operator-managed vocabularies (single source of
  // truth). Reactive: editing a list in System Settings updates these live.
  const VERIFICATION_OPTIONS = useMemo(
    () => _opts(FILTER_ALL_STATUSES, vocabularies?.verification_statuses || [], verificationLabel),
    [vocabularies],
  );
  const SOURCE_OPTIONS = useMemo(
    () => _opts(FILTER_ALL_SOURCES, vocabularies?.ingestion_sources || [], (v) => SOURCE_LABELS[v] || v),
    [vocabularies],
  );
  const RELATION_TYPE_OPTIONS = useMemo(
    () => _opts(FILTER_ALL_RELATION_TYPES, vocabularies?.relation_types || [], (v) => RELATION_LABELS[v] || v),
    [vocabularies],
  );
  const PHONE_TYPE_VALUES = vocabularies?.phone_types || [];

  // Load active filter fields + custom filters from settings.
  const [activeFilters, setActiveFilters] = useState(() =>
    resolveActiveFilters('phones', null)
  );
  const [customFilters, setCustomFilters] = useState([]);
  useEffect(() => {
    let alive = true;
    getSystemSettings(mockDb)
      .then((s) => {
        if (!alive) return;
        setActiveFilters(resolveActiveFilters('phones', s.filter_fields || {}));
        setCustomFilters(resolveCustomFilters('phones', s.custom_filters || {}));
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

  const hasAnyCustom = customFilters.some((d) => {
    const v = customValues[d.key];
    return v != null && v !== '';
  });
  const hasAny = TEXT_SELECT_KEYS.some((k) => phoneFilters[k]) || hasAnyCustom;

  const clearAll = () => {
    resetPhoneFilters();
    resetCustomFilterValues('phones');
  };

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

      {activeKeys.has('rootEntityId') && (
        <select
          value={phoneFilters.rootEntityId}
          onChange={(e) => updatePhoneFilters({ rootEntityId: e.target.value })}
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
          {PHONE_TYPE_VALUES.map((t) => (
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

      <CustomFilterControls
        descriptors={customFilters}
        values={customValues}
        onChange={(partial) => updateCustomFilterValues('phones', partial)}
      />

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 h-9 px-2.5 text-xs rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {FILTER_BTN_CLEAR}
        </button>
      )}
    </div>
  );
}
