/**
 * RequireRole — frontend permission gate (Auth Deferral seam, Phase DX).
 *
 * Reads `operatorRole` from `MockAuthContext` and renders `children` only
 * when the role matches. Today the mock always returns 'admin', so the
 * gate is functionally a no-op — but every gated surface in the codebase
 * already lives behind this component, so when Phase G activates the
 * `useAuth()` swap is the entire migration.
 *
 * // HOOK FOR ENTERPRISE AUTH — this component is the single read site
 * // for role-based UI gating. Phase G replaces `useAuth()` with a real
 * // JWT-backed identity provider and this signature stays unchanged.
 *
 * Usage:
 *   <RequireRole role="admin">
 *     <ResolveTaskButton ... />
 *   </RequireRole>
 *
 *   <RequireRole role="admin" fallback={<PermissionDeniedNotice />}>
 *     <SensitivePayloadCard ... />
 *   </RequireRole>
 *
 * Props:
 *   role     (string)  — required role token.
 *   children (ReactNode) — rendered when the current operator's role matches.
 *   fallback (ReactNode | null) — rendered when the role does not match.
 *                                  Default: null (renders nothing).
 */

import { useAuth } from '../../contexts/MockAuthContext';

export default function RequireRole({ role, children, fallback = null }) {
  const { operatorRole } = useAuth();
  return operatorRole === role ? <>{children}</> : fallback;
}
