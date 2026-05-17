/**
 * AppShell — top-level chrome: header bar, nav tabs, and content slot.
 *
 * Layout structure:
 *   ┌───────────────────────────────────────────────────────┐
 *   │  Branding   |  NavTabs        |    HeaderActions      │   <- sticky top
 *   ├───────────────────────────────────────────────────────┤
 *   │                                                       │
 *   │              page content via {children}              │
 *   │                                                       │
 *   └───────────────────────────────────────────────────────┘
 *
 * The header is a single sticky row so all tab switches happen below it
 * without layout jump. The operator chip on the right reads from useAuth()
 * — // HOOK FOR ENTERPRISE AUTH: swap to a real user dropdown later.
 */

import { Activity } from 'lucide-react';

import NavTabs       from './NavTabs';
import HeaderActions from './HeaderActions';
import { useAuth }   from '../../contexts/MockAuthContext';

export default function AppShell({ children }) {
  const { operatorId, operatorRole } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center gap-8">
          {/* Branding — // HOOK FOR ENTERPRISE LABELS */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <span className="font-semibold text-slate-900 tracking-tight">
              Marketing Automation
            </span>
          </div>

          {/* Tabs */}
          <NavTabs />

          {/* Right cluster: actions + operator chip */}
          <div className="ml-auto flex items-center gap-4">
            <HeaderActions />
            <div
              className="flex items-center gap-2 pl-4 border-l border-slate-200"
              title={`Role: ${operatorRole}`}
            >
              <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center">
                {operatorId.slice(-2).toUpperCase()}
              </div>
              <span className="text-xs text-slate-600 truncate max-w-[120px]">
                {operatorId}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  );
}
