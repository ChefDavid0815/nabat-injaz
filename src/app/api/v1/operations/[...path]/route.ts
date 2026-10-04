import { cookies } from 'next/headers';
import { z } from 'zod';
import { ready, database } from '@/server/db';
import {
  actorFromToken,
  AppError,
  checkOrigin,
  digest,
  rateLimit,
  sessionCookieName,
} from '@/server/security';
import { login } from '@/domain/identity/service';
import { workspaces, createWorkspace } from '@/domain/organisations/service';
import { createLocation } from '@/domain/locations/service';
import { plantDetails, createPlant } from '@/domain/plants/service';
import { tags } from '@/domain/tags/service';
import { destination } from '@/server/tags';
import { tagDesign, tagSheet, tagLifecycle, programmingHistory } from '@/server/operations-tags';
import sharp from 'sharp';
import {
  fleet,
  snapshot,
  today,
  sessions,
  sessionDetail,
  teamOperations,
} from '@/domain/operations/queries';
import { requireCapability } from '@/domain/operations/authorization';
import {
  reconcileQueue,
  logOperationsCare,
  startSession,
  finishSession,
  createTask,
  updateTask,
  bulkChange,
  transitionAlert,
} from '@/domain/operations/mutations';
import { reserveOperationsPhoto, receiveOperationsPhoto } from '@/server/operations-media';
import * as management from '@/domain/operations/management';
import * as ingestion from '@/domain/operations/imports';
import {
  operationsAnalytics,
  scoreExplanation,
  compareObservations,
  report,
} from '@/domain/operations/intelligence';
import { catalog } from '@/domain/organisations/service';
import { bulkWork, recordLifecycle } from '@/domain/operations/bulk-work';
import { addMember, team } from '@/domain/memberships/service';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path: string[] }> };
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError(415, 'Send JSON.');
  if (!request.body) throw new AppError(400, 'Request body is missing.');
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 64000) {
      await reader.cancel();
      throw new AppError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AppError(400, 'Invalid JSON.');
  }
}
async function handle(request: Request, context: Context) {
  try {
    await ready();
    const path = (await context.params).path,
      method = request.method;
    if (request.headers.get('origin')) checkOrigin(request);
    if (path[0] === 'session' && method === 'POST') {
      await rateLimit(
        `native-login:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
        30,
        900,
      );
      const session = await login(await body(request));
      return json({
        token: session.token,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        actor: session.actor,
        workspaces: await workspaces(session.actor),
        contractVersion: 'operations/1.1',
      });
    }
    const bearer = request.headers.get('authorization');
    if (bearer && !/^Bearer [A-Za-z0-9_-]{40,128}$/.test(bearer))
      throw new AppError(401, 'Invalid session.');
    const token = bearer?.slice(7) || (await cookies()).get(sessionCookieName())?.value;
    if (!bearer && method !== 'GET') checkOrigin(request);
    const actor = await actorFromToken(token);
    if (!actor) throw new AppError(401, 'Sign in to continue.');
    await rateLimit(`operations:${actor.id}`, 240, 60);
    if (path[0] === 'session' && method === 'GET')
      return json({
        actor,
        workspaces: await workspaces(actor),
        contractVersion: 'operations/1.1',
      });
    if (path[0] === 'session' && method === 'DELETE') {
      await (await database()).query('DELETE FROM sessions WHERE token_hash=$1', [digest(token!)]);
      return json({ signedOut: true });
    }
    if (path[0] === 'workspaces' && path.length === 1 && method === 'POST')
      return json(await createWorkspace(actor, await body(request)), 201);
    if (path[0] === 'identity' && path.length === 2 && method === 'GET') {
      const code = z
        .string()
        .regex(/^[A-Za-z0-9-]{1,64}$/)
        .parse(path[1]);
      const found = (
        await (
          await database()
        ).query(
          'SELECT p.id,p.organisation_id,p.code FROM plants p JOIN organisation_memberships m ON m.organisation_id=p.organisation_id AND m.user_id=$1 WHERE lower(p.code)=lower($2)',
          [actor.id, code],
        )
      ).rows[0];
      if (!found) throw new AppError(404, 'Plant identity is not available to this account.');
      return json(found);
    }
    const org = z.uuid().parse(path[0]),
      route = path.slice(1).join('/');
    await requireCapability(actor, org, 'operations.read');
    if (
      method === 'PUT' &&
      path[1] === 'locations' &&
      path[3] === 'floor-plan' &&
      path.length === 4
    ) {
      return json(
        await management.saveFloorPlan(actor, org, z.uuid().parse(path[2]), await binary(request)),
        201,
      );
    }
    if (method === 'PUT' && route === 'imports/detect') {
      return json(await ingestion.detectImportIdentity(actor, org, await binary(request)));
    }
    if (method === 'DELETE' && path[1] === 'views' && path.length === 3)
      return json(await management.removeView(actor, org, z.uuid().parse(path[2])));
    if (method === 'DELETE' && path[1] === 'pins' && path.length === 3)
      return json(await management.removePin(actor, org, z.uuid().parse(path[2])));
    if (method === 'PUT' && path[1] === 'observations' && path.length === 3)
      return json(await receiveOperationsPhoto(actor, org, z.uuid().parse(path[2]), request), 201);
    if (method === 'GET') {
      const search = new URL(request.url).searchParams;
      if (route === 'catalog') return json(await catalog(actor, org));
      if (path[1] === 'upload-receipts' && path.length === 3)
        return json(
          (
            await (
              await database()
            ).query(
              'SELECT photo_id,status FROM media_uploads WHERE id=$1 AND organisation_id=$2 AND actor_id=$3',
              [z.uuid().parse(path[2]), org, actor.id],
            )
          ).rows[0] || null,
        );
      if (route === 'views') return json(await management.savedViews(actor, org));
      if (route === 'locations') return json(await management.locationOperations(actor, org));
      if (route === 'team') return json(await team(actor, org));
      if (route === 'team/operations') return json(await teamOperations(actor, org));
      if (route === 'analytics')
        return json(await operationsAnalytics(actor, org, Object.fromEntries(search)));
      if (route === 'reports') return json(await report(actor, org, Object.fromEntries(search)));
      if (route === 'imports') return json(await ingestion.imports(actor, org));
      if (path[1] === 'imports' && path.length === 3)
        return json(await ingestion.importItems(actor, org, z.uuid().parse(path[2])));
      if (path[1] === 'locations' && path[3] === 'floor-plan' && path.length === 4)
        return json(await management.floorPlan(actor, org, z.uuid().parse(path[2])));
      if (path[1] === 'floor-plans' && path.length === 3)
        return new Response(
          new Uint8Array(await management.floorPlanBytes(actor, org, z.uuid().parse(path[2]))),
          { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' } },
        );
      if (path[1] === 'plants' && path[3] === 'score' && path.length === 4)
        return json(await scoreExplanation(actor, org, z.uuid().parse(path[2])));
      if (path[1] === 'plants' && path[3] === 'compare' && path.length === 4)
        return json(
          await compareObservations(
            actor,
            org,
            z.uuid().parse(path[2]),
            z.uuid().parse(search.get('before')),
            z.uuid().parse(search.get('after')),
          ),
        );
      if (path[1] === 'care-receipts' && path.length === 3) {
        const key = z.uuid().parse(path[2]);
        return json(
          (
            await (
              await database()
            ).query(
              'SELECT id,plant_id,type,occurred_at FROM care_events WHERE organisation_id=$1 AND actor_id=$2 AND idempotency_key=$3',
              [org, actor.id, key],
            )
          ).rows[0] || null,
        );
      }
      if (route === 'snapshot') return json(await snapshot(actor, org));
      if (route === 'fleet') {
        const search = new URL(request.url).searchParams;
        return json(
          await fleet(actor, org, {
            ...Object.fromEntries(search),
            overdue: search.has('overdue') ? search.get('overdue') === 'true' : undefined,
            inspection: search.has('inspection') ? search.get('inspection') === 'true' : undefined,
          }),
        );
      }
      if (route === 'tasks') return json(await today(actor, org));
      if (route === 'sessions') return json(await sessions(actor, org));
      if (path[1] === 'sessions' && path.length === 3) {
        const data = await sessionDetail(actor, org, z.uuid().parse(path[2]));
        if (!data) throw new AppError(404, 'Session not found.');
        return json(data);
      }
      if (path[1] === 'plants' && path.length === 3) {
        const data = await plantDetails(actor, z.uuid().parse(path[2]));
        if (data.plant.organisation_id !== org)
          throw new AppError(403, 'Plant belongs to another workspace.');
        return json(data);
      }
      if (route === 'tags')
        return json(
          (await tags(actor, org)).map((t) => ({
            ...t,
            resolver_url: destination(t.public_token),
          })),
        );
      if (route === 'tags/programming-history') return json(await programmingHistory(actor, org));
      if (route === 'tags/sheet') {
        const ids = z
          .array(z.uuid())
          .min(1)
          .max(16)
          .parse((search.get('ids') || '').split(','));
        const svg = await tagSheet(actor, org, ids);
        return new Response(
          search.get('format') === 'png'
            ? new Uint8Array(await sharp(Buffer.from(svg), { density: 300 }).png().toBuffer())
            : svg,
          {
            headers: {
              'Content-Type': search.get('format') === 'png' ? 'image/png' : 'image/svg+xml',
              'Cache-Control': 'private, no-store',
            },
          },
        );
      }
      if (path[1] === 'tags' && ['artwork', 'preview'].includes(path[3]) && path.length === 4) {
        const tag = (await tags(actor, org)).find((t) => t.id === z.uuid().parse(path[2]));
        if (!tag) throw new AppError(404, 'Tag not found.');
        const design = await tagDesign(
          tag.code,
          tag.name,
          tag.public_token,
          search.get('template') || 'label',
        );
        if (path[3] === 'preview')
          return new Response(
            new Uint8Array(
              await sharp(Buffer.from(design.svg), {
                density: 300,
              })
                .png()
                .toBuffer(),
            ),
            { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } },
          );
        return new Response(design.svg, {
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store' },
        });
      }
    }
    if (method === 'POST') {
      const input = await body(request);
      if (route === 'locations') return json(await createLocation(actor, org, input), 201);
      if (route === 'views') return json(await management.saveView(actor, org, input));
      if (route === 'pins') return json(await management.savePin(actor, org, input));
      if (route === 'issues') return json(await management.reportIssue(actor, org, input), 201);
      if (route === 'team') {
        await addMember(actor, org, input);
        return json({ added: true });
      }
      if (route === 'imports') return json(await ingestion.createImport(actor, org, input), 201);
      if (path[1] === 'import-items' && path.length === 3)
        return json(await ingestion.updateImportItem(actor, org, z.uuid().parse(path[2]), input));
      if (path[1] === 'locations' && path.length === 3)
        return json(await management.updateLocation(actor, org, z.uuid().parse(path[2]), input));
      if (path[1] === 'tags' && path[3] === 'programming' && path.length === 4)
        return json(await management.recordProgramming(actor, org, z.uuid().parse(path[2]), input));
      if (path[1] === 'tags' && path[3] === 'lifecycle' && path.length === 4)
        return json(await tagLifecycle(actor, org, z.uuid().parse(path[2]), input));
      if (route === 'queue/reconcile') return json(await reconcileQueue(actor, org));
      if (route === 'care') return json(await logOperationsCare(actor, org, input));
      if (route === 'observations/sign')
        return json(await reserveOperationsPhoto(actor, org, input));
      if (route === 'sessions') return json(await startSession(actor, org, input), 201);
      if (path[1] === 'sessions' && path[3] === 'finish' && path.length === 4)
        return json(await finishSession(actor, org, z.uuid().parse(path[2]), input));
      if (route === 'tasks') return json(await createTask(actor, org, input), 201);
      if (path[1] === 'tasks' && path.length === 3)
        return json(await updateTask(actor, org, z.uuid().parse(path[2]), input));
      if (route === 'bulk') return json(await bulkChange(actor, org, input));
      if (route === 'bulk-work') return json(await bulkWork(actor, org, input));
      if (path[1] === 'plants' && path[3] === 'lifecycle' && path.length === 4)
        return json(await recordLifecycle(actor, org, z.uuid().parse(path[2]), input));
      if (path[1] === 'alerts' && path.length === 3)
        return json(await transitionAlert(actor, org, z.uuid().parse(path[2]), input));
      if (route === 'plants') return json(await createPlant(actor, org, input), 201);
    }
    throw new AppError(404, 'Operations endpoint not found.');
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json({ error: error.issues[0]?.message || 'Check your input.' }, 400);
    console.error(
      JSON.stringify({
        event: 'operations.request.failed',
        error: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    return json(
      { error: 'The operation could not be completed. Retry when the service is available.' },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
async function binary(request: Request) {
  if (!request.body) throw new AppError(400, 'Choose an image.');
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError(413, 'Use an image smaller than 4 MB.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
