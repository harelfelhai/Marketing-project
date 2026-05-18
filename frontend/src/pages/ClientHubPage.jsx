/**
 * ClientHubPage — landing screen: responsive grid of ClientCard tiles.
 *
 * Cards derive their metrics from MockDataContext live state, so any
 * mutation elsewhere in the app (verdict, ingest, etc.) is reflected
 * here on the next render.
 */

import { useMockData } from '../contexts/MockDataContext';
import ClientCard       from '../components/clients/ClientCard';
import { PAGE_CLIENT_HUB_TITLE, PAGE_CLIENT_HUB_SUB } from '../config/strings.he';

export default function ClientHubPage() {
  const { clients } = useMockData();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{PAGE_CLIENT_HUB_TITLE}</h1>
        <p className="text-sm text-slate-500 mt-1">{PAGE_CLIENT_HUB_SUB}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {clients.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>
    </section>
  );
}
