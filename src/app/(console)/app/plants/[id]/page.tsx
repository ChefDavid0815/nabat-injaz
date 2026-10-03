import { notFound } from 'next/navigation';
import { requireActor } from '@/server/session';
import { plantDetails, catalog, team } from '@/server/services';
import { AppError } from '@/server/security';
import { PlantProfile } from '@/components/plant-profile';
export const metadata = { title: 'Living record' };
export default async function PlantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(),
    { id } = await params;
  const initial = await plantDetails(actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const [c, members] = await Promise.all([
    catalog(actor, initial.plant.organisation_id),
    team(actor, initial.plant.organisation_id),
  ]);
  return (
    <PlantProfile
      initial={JSON.parse(JSON.stringify(initial))}
      locations={c.locations}
      team={members}
    />
  );
}
