import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { actorFromToken, sessionCookieName } from './security';
import { workspaces } from './services';
export async function currentActor() {
  return actorFromToken((await cookies()).get(sessionCookieName())?.value);
}
export async function requireActor() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  return actor;
}
export async function currentWorkspace() {
  const actor = await requireActor();
  const all = await workspaces(actor);
  if (!all.length) redirect('/onboarding');
  const selected = (await cookies()).get('nabat_workspace')?.value;
  return { actor, workspaces: all, workspace: all.find((w) => w.id === selected) || all[0] };
}
