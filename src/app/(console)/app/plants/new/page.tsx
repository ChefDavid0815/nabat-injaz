import { currentWorkspace } from '@/server/session';
import { catalog } from '@/server/services';
import { authorize, managerRoles } from '@/server/security';
import { PlantForm } from '@/components/plant-form';
export const metadata = { title: 'Add plant' };
export default async function NewPlantPage() {
  const { actor, workspace } = await currentWorkspace();
  if (workspace.role === 'caretaker')
    return (
      <section className="panel">
        <h1>A manager creates plant identities.</h1>
        <p>Ask your manager to add this plant, then you can begin its care.</p>
      </section>
    );
  await authorize(actor, workspace.id, managerRoles);
  return (
    <section className="panel form-panel">
      <PlantForm
        org={workspace.id}
        catalog={JSON.parse(JSON.stringify(await catalog(actor, workspace.id)))}
      />
    </section>
  );
}
