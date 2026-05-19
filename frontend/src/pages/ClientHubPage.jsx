/**
 * ClientHubPage — landing screen: responsive grid of ClientCard tiles.
 *
 * Cards derive their metrics from MockDataContext live state, so any
 * mutation elsewhere in the app (verdict, ingest, etc.) is reflected
 * here on the next render.
 */

import { useMemo } from 'react';

import { useMockData } from '../contexts/MockDataContext';
import { useAuth }     from '../contexts/MockAuthContext';
import ClientCard       from '../components/clients/ClientCard';
import Skeleton         from '../components/primitives/Skeleton';
import { PAGE_CLIENT_HUB_TITLE, PAGE_CLIENT_HUB_SUB } from '../config/strings.he';

const SKELETON_CARD_COUNT = 4;

export default function ClientHubPage() {
  const { clients, loading }            = useMockData();
  const { personalizationActive, user } = useAuth();

  // Phase AUTH-C — when the global toggle is ON and the operator has
  // managed clients, narrow the hub to those tiles. Admins (no managed
  // clients) see the full list regardless of toggle position.
  const visibleClients = useMemo(() => {
    if (!personalizationActive) return clients;
    const allowed = user?.managed_client_ids;
    if (!allowed?.length) return clients;
    const allowedSet = new Set(allowed.map(String));
    return clients.filter((c) => allowedSet.has(String(c.id)));
  }, [clients, personalizationActive, user]);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{PAGE_CLIENT_HUB_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{PAGE_CLIENT_HUB_SUB}</p>
      </header>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        aria-busy={loading || undefined}
      >
        {loading
          ? Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
              <ClientCardSkeleton key={i} />
            ))
          : visibleClients.map((client) => (
              <ClientCard key={client.id} client={client} />
            ))}
      </div>
    </section>
  );
}

function ClientCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Skeleton width={10} height={10} rounded="rounded-full" />
        <Skeleton height={16} width="55%" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton height={24} width="60%" />
          <Skeleton height={10} width="80%" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton height={24} width="60%" />
          <Skeleton height={10} width="80%" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton height={24} width="60%" />
          <Skeleton height={10} width="80%" />
        </div>
      </div>
      <Skeleton height={10} width="70%" />
      <Skeleton height={8} width="100%" rounded="rounded-full" />
    </div>
  );
}
