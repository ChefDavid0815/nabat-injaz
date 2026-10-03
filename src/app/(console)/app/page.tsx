import { Dashboard } from '@/components/dashboard';
import { currentWorkspace } from '@/server/session';
import { analytics, plants } from '@/server/services';
export const metadata = { title: 'Dashboard' };
export default async function DashboardPage() {
  const { actor, workspace } = await currentWorkspace();
  const [data, fleet] = await Promise.all([
    analytics(actor, workspace.id),
    plants(actor, workspace.id, { limit: 12 }),
  ]);
  return (
    <Dashboard
      data={JSON.parse(JSON.stringify(data))}
      plants={JSON.parse(JSON.stringify(fleet.items))}
    />
  );
}
