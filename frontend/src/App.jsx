/**
 * App.jsx — Top-level layout and route table.
 *
 * Renders the AppShell (header + nav + content slot) and wires the four
 * primary routes via React Router v6. The ToastStack is mounted once at
 * the application root so toasts survive route changes.
 *
 * Page bodies are placeholders in Phase 2 — they'll be replaced with real
 * page components in later phases.
 */

import { Routes, Route } from 'react-router-dom';

import AppShell from './components/layout/AppShell';
import ToastStack from './components/primitives/Toast';

import ClientHubPage from './pages/ClientHubPage';
import PhoneGridPage from './pages/PhoneGridPage';
import SystemOpsPage from './pages/SystemOpsPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <>
      <AppShell>
        <Routes>
          <Route path="/"          element={<ClientHubPage />} />
          <Route path="/phones"    element={<PhoneGridPage />} />
          <Route path="/ops"       element={<SystemOpsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Fallback — route any unknown path back to the Client Hub. */}
          <Route path="*"          element={<ClientHubPage />} />
        </Routes>
      </AppShell>

      {/* Portal-mounted toasts — outside AppShell so they overlay all content. */}
      <ToastStack />
    </>
  );
}
