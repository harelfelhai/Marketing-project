/**
 * UIContext — modal visibility, toast queue, and persistent phone filter state.
 *
 * Filter state for the Phone Grid lives here (not local to PhoneGridPage) so
 * that operators navigating between tabs return to the exact filters they left.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const UIContext = createContext(null);

// Default filter shape — mirrors PhoneFilterBar controls.
const DEFAULT_FILTERS = {
  clientId:           '',
  verificationStatus: '',
  ingestionSource:    '',
  classificationType: '',
  search:             '',
};

export function UIProvider({ children }) {
  // -------------------------------------------------------------------------
  // Ingestion modal
  // -------------------------------------------------------------------------
  const [isIngestionModalOpen, setIsIngestionModalOpen] = useState(false);
  const openIngestionModal  = useCallback(() => setIsIngestionModalOpen(true), []);
  const closeIngestionModal = useCallback(() => setIsIngestionModalOpen(false), []);

  // -------------------------------------------------------------------------
  // Persistent phone grid filters — survive tab navigation.
  // -------------------------------------------------------------------------
  const [phoneFilters, setPhoneFilters] = useState(DEFAULT_FILTERS);

  const updatePhoneFilters = useCallback((partial) => {
    setPhoneFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetPhoneFilters = useCallback(() => {
    setPhoneFilters(DEFAULT_FILTERS);
  }, []);

  // Convenience setter for seeding the client filter from a URL param on
  // first navigation to /phones?client_id=X without overwriting other filters.
  const seedClientFilter = useCallback((clientId) => {
    setPhoneFilters((prev) => ({ ...prev, clientId: clientId || '' }));
  }, []);

  // -------------------------------------------------------------------------
  // Toast queue
  // -------------------------------------------------------------------------
  const toastIdRef = useRef(0);
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback(({ variant = 'success', message }) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, variant, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = {
    // Modal
    isIngestionModalOpen,
    openIngestionModal,
    closeIngestionModal,
    // Phone filters
    phoneFilters,
    updatePhoneFilters,
    resetPhoneFilters,
    seedClientFilter,
    // Toasts
    toasts,
    pushToast,
    dismissToast,
  };

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
