/**
 * NavTabs — four primary navigation tabs.
 *
 * Uses NavLink so the active path automatically gets the `active` styling
 * via the className callback. Tab labels are kept generic.
 * // HOOK FOR ENTERPRISE LABELS
 */

import { NavLink } from 'react-router-dom';
import { LayoutGrid, Phone, Activity, ClipboardList, BarChart3 } from 'lucide-react';
import {
  NAV_CLIENT_HUB, NAV_PHONE_GRID, NAV_SYSTEM_OPS, NAV_OPERATIONS, NAV_DASHBOARD,
} from '../../config/strings.he';

const TABS = [
  { to: '/',           label: NAV_CLIENT_HUB, icon: LayoutGrid },
  { to: '/phones',     label: NAV_PHONE_GRID, icon: Phone },
  { to: '/ops',        label: NAV_SYSTEM_OPS, icon: Activity },
  { to: '/operations', label: NAV_OPERATIONS, icon: ClipboardList },
  { to: '/dashboard',  label: NAV_DASHBOARD,  icon: BarChart3 },
];

const baseClasses   = 'inline-flex items-center gap-2 h-14 px-3 text-sm font-medium border-b-2 transition-colors';
const activeClasses = 'border-slate-900 text-slate-900';
const idleClasses   = 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300';

export default function NavTabs() {
  return (
    <nav className="flex items-center gap-1">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `${baseClasses} ${isActive ? activeClasses : idleClasses}`
          }
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
