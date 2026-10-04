import { currentWorkspace } from '@/server/session';
import { catalog } from '@/domain/organisations/service';
import { today, sessions } from '@/domain/operations/queries';
import { OperationsToday } from '@/components/operations/today';
export default async function TodayPage() {
  const { actor, workspace } = await currentWorkspace();
  const [tasks, maintenance, structure] = await Promise.all([
    today(actor, workspace.id),
    sessions(actor, workspace.id),
    catalog(actor, workspace.id),
  ]);
  return (
    <OperationsToday
      workspace={workspace}
      actor={actor}
      initialTasks={JSON.parse(JSON.stringify(tasks))}
      initialSessions={JSON.parse(JSON.stringify(maintenance))}
      locations={structure.locations}
    />
  );
}
