import { NextResponse, after } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { database, ready } from '@/server/db';
import {
  actorFromToken,
  AppError,
  checkOrigin,
  digest,
  rateLimit,
  authorize,
  managerRoles,
  sessionCookieName,
} from '@/server/security';
import * as svc from '@/server/services';
import { sign, verifySignature, uploadPhoto, storage } from '@/server/media';
import { runAnalysisBatch, overdueSweep } from '@/server/analysis';
import { tagArtwork } from '@/server/tags';
import { DEMO_PASSWORD } from '@/server/seed';
import type { Actor } from '@/domain/types';
import { errorMonitor, traceHook } from '@/server/observability';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function user(): Promise<Actor> {
  const actor = await actorFromToken((await cookies()).get(sessionCookieName())?.value);
  if (!actor) throw new AppError(401, 'Sign in to continue.');
  return actor;
}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError(415, 'Send a JSON request.');
  if (Number(request.headers.get('content-length')) > 32000)
    throw new AppError(413, 'The request is too large.');
  if (!request.body) throw new AppError(400, 'The request body is missing.');
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32000) {
      await reader.cancel();
      throw new AppError(413, 'The request is too large.');
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, 'The request is not valid JSON.');
  }
}
async function session(token: string) {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 86400,
  });
}
async function boundedImage(request: Request) {
  const maximum = process.env.VERCEL ? 4 * 1024 * 1024 : 10 * 1024 * 1024;
  const tooLarge = process.env.VERCEL
    ? 'Use a prepared photo smaller than 4 MB.'
    : 'Use a photo smaller than 10 MB.';
  if (Number(request.headers.get('content-length')) > maximum) throw new AppError(413, tooLarge);
  if (!request.body) throw new AppError(400, 'Choose a photograph.');
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError(413, tooLarge);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function handler(request: Request, context: Context) {
  const id = randomUUID();
  const started = performance.now();
  try {
    await ready();
    const p = (await context.params).path,
      route = p.join('/'),
      url = new URL(request.url),
      method = request.method;
    if (route === 'health' && method === 'GET') {
      await (await database()).query('SELECT 1');
      return json({ status: 'ok', version: '1.0.0' });
    }
    if (route === 'worker' && ['GET', 'POST'].includes(method)) {
      const expected = method === 'GET' ? process.env.CRON_SECRET : process.env.WORKER_SECRET,
        received = request.headers.get('authorization')?.replace(/^Bearer /, '');
      if (
        !expected ||
        expected.length < 32 ||
        !received ||
        Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
      )
        throw new AppError(401, 'Worker authentication failed.');
      const completed =
        process.env.ANALYSIS_RUNTIME === 'external'
          ? 0
          : await runAnalysisBatch(25, undefined, Date.now() + 180000);
      await overdueSweep();
      return json({ completed });
    }
    if (method !== 'GET') checkOrigin(request);
    if (['auth/login', 'auth/register', 'auth/demo'].includes(route) && method === 'POST') {
      await rateLimit(
        `auth-ip:${request.headers.get('x-forwarded-for')?.split(',')[0] || 'local'}`,
        30,
        900,
      );
      if (
        route === 'auth/demo' &&
        process.env.ENABLE_DEMO !== 'true' &&
        (process.env.DATABASE_URL || process.env.NODE_ENV === 'production')
      )
        throw new AppError(404, 'Demo access is disabled.');
      const result =
        route === 'auth/register'
          ? await svc.register(await body(request))
          : await svc.login(
              route === 'auth/demo'
                ? { email: 'owner@nabat.demo', password: DEMO_PASSWORD }
                : await body(request),
            );
      await session(result.token);
      return json({ actor: result.actor });
    }
    if (route === 'auth/logout' && method === 'POST') {
      const jar = await cookies(),
        token = jar.get(sessionCookieName())?.value;
      if (token)
        await (await database()).query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
      jar.delete(sessionCookieName());
      jar.delete('nabat_workspace');
      return json({ ok: true });
    }
    if (p[0] === 'media' && p[1] && method === 'GET') {
      svc.uuid.parse(p[1]);
      const payload = await verifySignature(url.searchParams.get('token') || '');
      if (payload.purpose !== 'read' || payload.photoId !== p[1])
        throw new AppError(403, 'Invalid media link.');
      const photo = (
        await (
          await database()
        ).query<{
          object_key: string;
          thumbnail_key: string;
          source: string;
          organisation_id: string;
        }>('SELECT object_key,thumbnail_key,source,organisation_id FROM plant_photos WHERE id=$1', [
          p[1],
        ])
      ).rows[0];
      if (!photo || photo.source === 'fixture' || payload.organisationId !== photo.organisation_id)
        throw new AppError(404, 'Media not found.');
      return new NextResponse(
        new Uint8Array(await storage().get(payload.thumb ? photo.thumbnail_key : photo.object_key)),
        { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' } },
      );
    }
    const actor = await user();
    await rateLimit(`api:${actor.id}`, 240, 60);
    if (route === 'bootstrap' && method === 'GET') {
      const workspaces = await svc.workspaces(actor);
      const selected = (await cookies()).get('nabat_workspace')?.value;
      return json({
        actor,
        workspaces,
        workspace: workspaces.find((w) => w.id === selected) || workspaces[0] || null,
        analysisProvider: process.env.AI_PROVIDER || 'development',
      });
    }
    if (route === 'workspaces' && method === 'POST') {
      const result = await svc.createWorkspace(actor, await body(request));
      (await cookies()).set('nabat_workspace', result.id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      return json(result, 201);
    }
    if (route === 'workspaces/select' && method === 'POST') {
      const data = z.object({ id: svc.uuid }).parse(await body(request));
      await authorize(actor, data.id);
      (await cookies()).set('nabat_workspace', data.id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      return json({ ok: true });
    }
    if (route === 'locale' && method === 'POST') {
      const data = z.object({ locale: z.enum(['en', 'ar']) }).parse(await body(request));
      (await cookies()).set('nabat_locale', data.locale, {
        sameSite: 'lax',
        path: '/',
        maxAge: 31536000,
      });
      return json({ ok: true });
    }
    if (p[0] === 'workspaces' && p[1]) {
      const org = svc.uuid.parse(p[1]),
        feature = p[2];
      if (feature === 'catalog' && method === 'GET') return json(await svc.catalog(actor, org));
      if (feature === 'plants' && method === 'GET')
        return json(
          await svc.plants(actor, org, {
            search: url.searchParams.get('search') || undefined,
            location: url.searchParams.get('location') || undefined,
            state: url.searchParams.get('state') || undefined,
            species: url.searchParams.get('species') || undefined,
            assignee: url.searchParams.get('assignee') || undefined,
            overdue: url.searchParams.get('overdue') === 'true',
            alert: url.searchParams.get('alert') || undefined,
            page: Number(url.searchParams.get('page')) || 0,
          }),
        );
      if (feature === 'plants' && method === 'POST')
        return json(await svc.createPlant(actor, org, await body(request)), 201);
      if (feature === 'alerts' && method === 'GET') return json(await svc.alerts(actor, org));
      if (feature === 'analytics' && method === 'GET') return json(await svc.analytics(actor, org));
      if (feature === 'locations' && method === 'POST')
        return json(await svc.createLocation(actor, org, await body(request)), 201);
      if (feature === 'team' && method === 'GET') return json(await svc.team(actor, org));
      if (feature === 'team' && method === 'POST') {
        await svc.addMember(actor, org, await body(request));
        return json({ ok: true });
      }
      if (feature === 'tags' && method === 'GET') return json(await svc.tags(actor, org));
      if (feature === 'transfers' && method === 'GET') return json(await svc.transfers(actor, org));
      if (feature === 'settings' && method === 'PATCH') {
        await svc.workspaceSettings(actor, org, await body(request));
        return json({ ok: true });
      }
      if (feature === 'audit' && method === 'GET') {
        await authorize(actor, org, ['owner', 'admin']);
        return json(
          (
            await (
              await database()
            ).query(
              'SELECT id,action,entity_id,created_at FROM audit_events WHERE organisation_id=$1 ORDER BY created_at DESC LIMIT 100',
              [org],
            )
          ).rows,
        );
      }
    }
    if (p[0] === 'plants' && p[1]) {
      const plantId = svc.uuid.parse(p[1]);
      if (p[2] === 'timeline' && method === 'GET')
        return json(
          await svc.timeline(actor, plantId, url.searchParams.get('cursor') || undefined),
        );
      if (p.length === 2 && method === 'GET') {
        const details = await svc.plantDetails(actor, plantId);
        if (process.env.VERCEL && process.env.ANALYSIS_RUNTIME !== 'external')
          after(async () => {
            await runAnalysisBatch(1, plantId);
          });
        return json(details);
      }
      if (p.length === 2 && method === 'PATCH') {
        await svc.updatePlant(actor, plantId, await body(request));
        return json({ ok: true });
      }
      if (p[2] === 'care' && method === 'POST')
        return json(await svc.logCare(actor, plantId, await body(request)), 201);
      if (p[2] === 'assignment' && method === 'POST') {
        const d = z.object({ userId: svc.uuid }).parse(await body(request));
        await svc.assignPlant(actor, plantId, d.userId);
        return json({ ok: true });
      }
      if (p[2] === 'transfer' && method === 'POST') {
        const d = z.object({ organisationId: svc.uuid }).parse(await body(request));
        return json(await svc.requestTransfer(actor, plantId, d.organisationId), 201);
      }
      if (p[2] === 'tag' && method === 'POST') {
        await svc.provisionTag(actor, plantId);
        return json({ ok: true });
      }
    }
    if (p[0] === 'alerts' && p[1] && method === 'PATCH') {
      const d = z
        .object({ status: z.enum(['acknowledged', 'resolved']) })
        .parse(await body(request));
      await svc.updateAlert(actor, p[1], d.status);
      return json({ ok: true });
    }
    if (p[0] === 'care' && p[1] && method === 'PATCH') {
      await svc.amendCare(actor, p[1], await body(request));
      return json({ ok: true });
    }
    if (p[0] === 'tags' && p[1]) {
      if (p[2] === 'artwork' && method === 'GET') {
        const tag = (
          await (
            await database()
          ).query<{ organisation_id: string; code: string; public_token: string; state: string }>(
            'SELECT t.*,p.code FROM plant_tags t JOIN plants p ON p.id=t.plant_id WHERE t.id=$1',
            [svc.uuid.parse(p[1])],
          )
        ).rows[0];
        if (!tag) throw new AppError(404, 'Tag not found.');
        await authorize(actor, tag.organisation_id, managerRoles);
        if (tag.state !== 'active') throw new AppError(410, 'Only active tags can be printed.');
        return new NextResponse(await tagArtwork(tag.code, tag.public_token), {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Content-Disposition': `attachment; filename="${tag.code}-tag.svg"`,
            'Cache-Control': 'private, no-store',
          },
        });
      }
      if (method === 'POST') {
        const d = z.object({ action: z.enum(['replace', 'revoke']) }).parse(await body(request));
        return json(await svc.replaceTag(actor, p[1], d.action === 'revoke'));
      }
    }
    if (route === 'observations/sign' && method === 'POST') {
      const d = z
        .object({
          plantId: svc.uuid,
          note: z.string().max(2000),
          matchedView: z.boolean(),
          careEventId: svc.uuid.optional(),
        })
        .parse(await body(request));
      const plant = await svc.getPlant(actor, d.plantId);
      await rateLimit(`upload:${actor.id}`, 30, 3600);
      const uploadId = randomUUID();
      await (
        await database()
      ).query(
        "INSERT INTO media_uploads(id,organisation_id,plant_id,actor_id,expires_at,metadata) VALUES($1,$2,$3,$4,now()+interval '5 minutes',$5)",
        [
          uploadId,
          plant.organisation_id,
          d.plantId,
          actor.id,
          JSON.stringify({ note: d.note, matchedView: d.matchedView, careEventId: d.careEventId }),
        ],
      );
      return json({
        url: `/api/observations/upload?token=${await sign({ purpose: 'upload', actorId: actor.id, uploadId, plantId: d.plantId }, 300)}`,
      });
    }
    if (route === 'observations/upload' && method === 'PUT') {
      const payload = await verifySignature(url.searchParams.get('token') || '');
      if (payload.purpose !== 'upload' || payload.actorId !== actor.id)
        throw new AppError(403, 'Invalid upload destination.');
      const d = z
        .object({
          plantId: svc.uuid,
          uploadId: svc.uuid,
        })
        .parse(payload);
      const db = await database();
      await svc.getPlant(actor, d.plantId);
      const reservation = (
        await db.query<{ status: string; photo_id: string | null; metadata: unknown }>(
          'SELECT status,photo_id,metadata FROM media_uploads WHERE id=$1 AND actor_id=$2 AND plant_id=$3 AND expires_at>now()',
          [d.uploadId, actor.id, d.plantId],
        )
      ).rows[0];
      if (!reservation)
        throw new AppError(403, 'Upload destination expired. Choose the photo again.');
      if (reservation.status === 'completed')
        return json({ id: reservation.photo_id, status: 'queued', duplicate: true });
      const metadata = z
        .object({
          note: z.string().max(2000),
          matchedView: z.boolean(),
          careEventId: svc.uuid.optional(),
        })
        .parse(reservation.metadata);
      const bytes = await boundedImage(request);
      const claim = await db.query(
        "UPDATE media_uploads SET status='processing' WHERE id=$1 AND status='issued' AND expires_at>now() RETURNING id",
        [d.uploadId],
      );
      if (!claim.rows.length)
        throw new AppError(
          409,
          'This upload is already in progress. Reload the plant record shortly.',
        );
      let result;
      try {
        result = await uploadPhoto(
          actor,
          d.plantId,
          bytes,
          metadata.note,
          metadata.matchedView,
          metadata.careEventId,
          d.uploadId,
        );
      } catch (e) {
        await db.query(
          "UPDATE media_uploads SET status='issued' WHERE id=$1 AND status='processing'",
          [d.uploadId],
        );
        throw e;
      }
      if (process.env.ANALYSIS_RUNTIME !== 'external')
        after(async () => {
          await runAnalysisBatch(1, d.plantId);
        });
      return json(result, 201);
    }
    if (p[0] === 'jobs' && p[1] && method === 'POST') {
      const job = (
        await (
          await database()
        ).query<{ organisation_id: string; status: string; plant_id: string }>(
          'SELECT organisation_id,status,plant_id FROM analysis_jobs WHERE id=$1',
          [svc.uuid.parse(p[1])],
        )
      ).rows[0];
      if (!job) throw new AppError(404, 'Analysis job not found.');
      await authorize(actor, job.organisation_id);
      if (job.status !== 'failed')
        throw new AppError(409, 'This analysis is not ready for a retry.');
      await (
        await database()
      ).query(
        "UPDATE analysis_jobs SET status='queued',attempts=0,error=null,available_at=now() WHERE id=$1",
        [p[1]],
      );
      if (process.env.ANALYSIS_RUNTIME !== 'external')
        after(async () => {
          await runAnalysisBatch(1, job.plant_id);
        });
      return json({ ok: true });
    }
    if (p[0] === 'transfers' && p[1] && method === 'POST') {
      await svc.acceptTransfer(actor, p[1]);
      return json({ ok: true });
    }
    throw new AppError(404, 'This endpoint was not found.');
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message || 'Check the submitted fields.', requestId: id },
        400,
      );
    if (error instanceof AppError)
      return json({ error: error.message, requestId: id }, error.status);
    const code = (error as { code?: string }).code;
    if (code === '23505') return json({ error: 'This record already exists.', requestId: id }, 409);
    errorMonitor.capture({
      requestId: id,
      code: code || 'internal',
      route: new URL(request.url).pathname,
    });
    return json(
      { error: 'The request could not be completed. Please try again.', requestId: id },
      500,
    );
  } finally {
    if (request.method !== 'GET')
      traceHook.span(
        'http.request',
        { requestId: id, route: new URL(request.url).pathname, method: request.method },
        Math.round(performance.now() - started),
      );
  }
}
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
