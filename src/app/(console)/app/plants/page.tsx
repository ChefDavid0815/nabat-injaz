import { currentWorkspace } from '@/server/session';
import { catalog } from '@/server/services';
import { Fleet } from '@/components/fleet';
export const metadata = { title: 'Plants' };
export default async function PlantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, workspace } = await currentWorkspace();
  const params = await searchParams;
  return (
    <Fleet
      key={JSON.stringify(params)}
      catalog={JSON.parse(JSON.stringify(await catalog(actor, workspace.id)))}
      initialFilters={{
        location: typeof params.location === 'string' ? params.location : undefined,
        state: typeof params.state === 'string' ? params.state : undefined,
        overdue: params.overdue === 'true',
      }}
    />
  );
}
