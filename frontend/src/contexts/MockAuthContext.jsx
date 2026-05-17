/**
 * MockAuthContext — stub identity layer for M6 prototype.
 *
 * M5 (Auth/RBAC) is deferred. This context provides a single seam so that
 * every component consuming useAuth() continues to work unchanged when real
 * auth is wired. To migrate: replace the hardcoded values below with actual
 * session/token state.
 *
 * // HOOK FOR ENTERPRISE AUTH
 */

import { createContext, useContext } from 'react';

const OPERATOR_ID   = 'mock_operator_01';  // HOOK FOR ENTERPRISE AUTH
const OPERATOR_ROLE = 'admin';             // HOOK FOR ENTERPRISE AUTH

const MockAuthContext = createContext({
  operatorId:   OPERATOR_ID,
  operatorRole: OPERATOR_ROLE,
});

export function MockAuthProvider({ children }) {
  return (
    <MockAuthContext.Provider value={{ operatorId: OPERATOR_ID, operatorRole: OPERATOR_ROLE }}>
      {children}
    </MockAuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(MockAuthContext);
}
