import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentActor } from '@/server/session';
import {
  resolveTag,
  plantDetails,
  catalog,
  team,
  workspaces,
  publicPassport,
} from '@/server/services';
import { AppError } from '@/server/security';
import { AppShell } from '@/components/app-shell';
import { gatewayRoute } from '@/domain/analysis/routing';
import { PlantProfile } from '@/components/plant-profile';
import { Brand } from '@/components/brand';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plant identity', robots: { index: false, follow: false } };
export default async function TagPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let tag;
  try {
    tag = await resolveTag(token);
  } catch (e) {
    if (e instanceof AppError && e.status === 410)
      return (
        <main className="passport" id="main-content">
          <Brand />
          <h1>This tag has been retired.</h1>
          <p>The plant’s history continues. Ask the caretaker for its current tag.</p>
          <Link href="/login" className="button">
            Sign in
          </Link>
        </main>
      );
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  const actor = await currentActor();
  if (actor) {
    const all = await workspaces(actor),
      workspace = all.find((w) => w.id === tag.organisation_id);
    if (workspace) {
      const [initial, c, members] = await Promise.all([
        plantDetails(actor, tag.plant_id),
        catalog(actor, tag.organisation_id),
        team(actor, tag.organisation_id),
      ]);
      return (
        <AppShell
          actor={actor}
          workspace={workspace}
          workspaces={all}
          analysisProvider={process.env.AI_PROVIDER || 'development'}
          analysisModel={
            process.env.AI_PROVIDER === 'gateway'
              ? gatewayRoute(workspace.ai_tier).label
              : process.env.AI_PROVIDER === 'workspace-agent'
                ? 'GPT-5.6 Luna'
                : ''
          }
        >
          <PlantProfile
            initial={JSON.parse(JSON.stringify(initial))}
            locations={c.locations}
            team={members}
            nfc
          />
        </AppShell>
      );
    }
  }
  const passport = await publicPassport(tag.plant_id);
  return (
    <main className="passport identity-acquired" id="main-content">
      <Brand />
      <div className="passport-mark">
        <Brand compact />
      </div>
      <h1>{passport.public_passport ? passport.name : 'A plant, known.'}</h1>
      <p className="passport-species">
        {passport.public_passport ? passport.scientific_name : 'This living record is private.'}
      </p>
      {passport.public_passport && <span className="passport-code">{passport.code}</span>}
      <p>
        A stable identity. A lifetime of care.
        <br />
        Sign in with the plant’s workspace to open its living history.
      </p>
      <Link className="button" href={`/login?next=${encodeURIComponent(`/p/${token}`)}`}>
        Sign in to care
      </Link>
      <Link className="text-link" href="/">
        Discover NABAT
      </Link>
    </main>
  );
}
