import { beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { database, migrate } from '../src/server/db';
import * as s from '../src/server/services';
import { actorFromToken, authorize, checkOrigin, rateLimit } from '../src/server/security';
import { uploadPhoto, mediaUrl, verifySignature } from '../src/server/media';
import { runAnalysisBatch, overdueSweep } from '../src/server/analysis';
import type { Actor } from '../src/domain/types';
let a: Actor,
  b: Actor,
  care: Actor,
  orgA: string,
  orgB: string,
  plant: string,
  location: string,
  speciesId: string,
  tagId: string,
  tagToken: string;
beforeAll(async () => {
  process.env.NABAT_DATA_DIR = path.resolve(`data/test-${Date.now()}`);
  process.env.AI_PROVIDER = 'development';
  process.env.ENABLE_DEMO = 'false';
  await fs.mkdir(process.env.NABAT_DATA_DIR, { recursive: true });
  await migrate();
  const suffix = randomUUID();
  const r = await s.register({
    name: 'Test Owner A',
    email: `a-${suffix}@test.nabat`,
    password: 'TestPassword2026!',
  });
  a = r.actor;
  expect(await actorFromToken(r.token)).toEqual(a);
  b = (
    await s.register({
      name: 'Test Owner B',
      email: `b-${suffix}@test.nabat`,
      password: 'TestPassword2026!',
    })
  ).actor;
  care = (
    await s.register({
      name: 'Test Caretaker',
      email: `c-${suffix}@test.nabat`,
      password: 'TestPassword2026!',
    })
  ).actor;
  orgA = (await s.createWorkspace(a, { name: 'Test workspace A', kind: 'business' })).id;
  orgB = (await s.createWorkspace(b, { name: 'Test workspace B', kind: 'business' })).id;
  location = (await s.createLocation(a, orgA, { name: 'Lobby' })).id;
  speciesId = (await s.catalog(a, orgA)).species[0].id;
  plant = (
    await s.createPlant(a, orgA, { name: 'Pilot Monstera', speciesId, locationId: location })
  ).id;
  await s.addMember(a, orgA, { email: care.email, userId: care.id, role: 'caretaker' });
  const tag = (await s.tags(a, orgA)).find((t) => t.plant_id === plant)!;
  tagId = tag.id;
  tagToken = tag.public_token;
});
describe('persisted tenant services', () => {
  it('keeps fleet trends equally weighted when one plant has frequent score snapshots', async () => {
    const db = await database(),
      org = (await s.createWorkspace(b, { name: 'Aggregation workspace', kind: 'business' })).id;
    const low = (await s.createPlant(b, org, { name: 'Low-score fixture', speciesId })).id,
      highPlant = (await s.createPlant(b, org, { name: 'Frequent-score fixture', speciesId })).id;
    const insert = async (id: string, score: number) =>
      db.query(
        "INSERT INTO health_score_snapshots(id,organisation_id,plant_id,score,delta,trend,confidence,composition,reasons,engine_version) VALUES($1,$2,$3,$4,0,'stable',.5,'{}','[]','aggregation-fixture')",
        [randomUUID(), org, id, score],
      );
    await insert(low, 10);
    for (let n = 0; n < 20; n++) await insert(highPlant, 80);
    expect((await s.analytics(b, org)).trend.at(-1)?.score).toBe(45);
  });
  it('paginates lifetime history without dropping or repeating older events', async () => {
    const created = await s.createPlant(b, orgB, { name: 'Long-history fixture', speciesId }),
      db = await database();
    await db.query("UPDATE plants SET created_at=now()-interval '90 days' WHERE id=$1", [
      created.id,
    ]);
    for (let n = 0; n < 65; n++)
      await db.query(
        "INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,note,idempotency_key,occurred_at) VALUES($1,$2,$3,$4,'inspected','Pagination fixture',$5,$6)",
        [randomUUID(), orgB, created.id, b.id, randomUUID(), new Date(Date.now() - n * 3600000)],
      );
    const first = await s.timeline(b, created.id),
      second = await s.timeline(b, created.id, first.nextCursor!);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(16);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(66);
    expect(second.items.at(-1)?.type).toBe('created');
    await expect(s.timeline(a, created.id, first.nextCursor!)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('requires the confirmed account ID for membership provisioning', async () => {
    await expect(
      s.addMember(a, orgA, { email: b.email, userId: randomUUID(), role: 'caretaker' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('authenticates with scrypt and rejects the wrong password', async () => {
    expect((await s.login({ email: a.email, password: 'TestPassword2026!' })).actor).toEqual(a);
    await expect(s.login({ email: a.email, password: 'wrong' })).rejects.toMatchObject({
      status: 401,
    });
    expect(await actorFromToken('forged')).toBeNull();
  });
  it('isolates reads and manager operations from other tenants and caretakers', async () => {
    await expect(s.getPlant(b, plant)).rejects.toMatchObject({ status: 403 });
    await expect(s.plants(b, orgA)).rejects.toMatchObject({ status: 403 });
    await expect(s.createPlant(care, orgA, { name: 'Denied', speciesId })).rejects.toMatchObject({
      status: 403,
    });
    await expect(s.tags(care, orgA)).rejects.toMatchObject({ status: 403 });
    expect((await s.getPlant(care, plant)).id).toBe(plant);
  });
  it('rejects cross-tenant locations in both service and relational constraint', async () => {
    const foreign = (await s.createLocation(b, orgB, { name: 'Foreign' })).id;
    await expect(
      s.createPlant(a, orgA, { name: 'Invalid', speciesId, locationId: foreign }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      (await database()).query('UPDATE plants SET location_id=$2 WHERE id=$1', [plant, foreign]),
    ).rejects.toMatchObject({ code: '23503' });
  });
  it('records care once when a client retries and audits amended details', async () => {
    const key = randomUUID(),
      input = { type: 'watered', idempotencyKey: key, note: 'Checked soil first' };
    const first = await s.logCare(care, plant, input),
      second = await s.logCare(care, plant, input);
    expect(first.id).toBe(second.id);
    expect(second.duplicate).toBe(true);
    await s.amendCare(care, first.id, { note: 'Added measured amount', amountMl: 250 });
    const detail = await s.plantDetails(a, plant);
    expect(detail.timeline.filter((e) => e.type === 'watered')).toHaveLength(1);
    expect(detail.timeline.find((e) => e.id === first.id)?.note).toContain('250 ml');
    await expect(s.amendCare(a, first.id, { note: 'Spoof', amountMl: 1 })).rejects.toMatchObject({
      status: 403,
    });
  });
  it('moves location and preserves the movement event', async () => {
    const next = (await s.createLocation(a, orgA, { name: 'Courtyard', parentId: location })).id;
    await s.logCare(care, plant, { type: 'moved', locationId: next, idempotencyKey: randomUUID() });
    expect((await s.getPlant(a, plant)).location_id).toBe(next);
    expect((await s.plantDetails(a, plant)).timeline.some((e) => e.type === 'moved')).toBe(true);
  });
  it('resolves an opaque tag and limits the public projection', async () => {
    expect(tagToken).not.toContain(plant);
    expect((await s.resolveTag(tagToken)).plant_id).toBe(plant);
    const publicData = await s.publicPassport(plant);
    expect(Object.keys(publicData).sort()).toEqual([
      'code',
      'name',
      'public_passport',
      'scientific_name',
      'species_name',
    ]);
  });
  it('processes a private image into immutable analysis, score and source-linked records', async () => {
    const image = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#447733' },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await uploadPhoto(care, plant, image, 'Initial observation', true);
    const url = await mediaUrl(uploaded.id);
    const payload = await verifySignature(
      new URL(url, 'http://localhost').searchParams.get('token')!,
    );
    expect(payload.photoId).toBe(uploaded.id);
    expect(await runAnalysisBatch()).toBe(1);
    const detail = await s.plantDetails(a, plant);
    expect(detail.analyses).toHaveLength(1);
    expect(detail.plant.score).not.toBeNull();
    expect(detail.plant.trend).toBe('baseline');
    expect(detail.jobs).toHaveLength(0);
    expect((await s.observations(a, plant)).some((o) => o.photo_id === uploaded.id)).toBe(true);
    expect(await runAnalysisBatch()).toBe(0);
    expect((detail.analyses[0] as { provider: string }).provider).toBe('development-fixture');
    await expect(
      uploadPhoto(care, plant, Buffer.from('<svg>bad</svg>'), 'bad', false),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('creates overdue warnings and tracks acknowledgement and resolution', async () => {
    const db = await database();
    await db.query(
      "UPDATE care_events SET occurred_at=now()-interval '45 days' WHERE plant_id=$1 AND type='watered'",
      [plant],
    );
    await overdueSweep();
    const alert = (await s.alerts(a, orgA)).find(
      (x) => x.plant_id === plant && x.status === 'open' && x.reason.includes('cadence'),
    );
    expect(alert).toBeDefined();
    await s.updateAlert(care, alert!.id, 'acknowledged');
    await s.updateAlert(care, alert!.id, 'resolved');
    const statuses = (
      await db.query<{ status: string }>(
        'SELECT status FROM alert_status_events WHERE alert_id=$1 ORDER BY created_at',
        [alert!.id],
      )
    ).rows;
    expect(statuses.map((x) => x.status)).toEqual(['open', 'acknowledged', 'resolved']);
  });
  it('replaces and revokes tags without losing plant history', async () => {
    const replacement = await s.replaceTag(a, tagId);
    await expect(s.resolveTag(tagToken)).rejects.toMatchObject({ status: 410 });
    const newTag = (await s.tags(a, orgA)).find((x) => x.id === replacement.id)!;
    expect((await s.resolveTag(newTag.public_token)).plant_id).toBe(plant);
    await s.replaceTag(a, newTag.id, true);
    await expect(s.resolveTag(newTag.public_token)).rejects.toMatchObject({ status: 410 });
    await s.provisionTag(a, plant);
    expect(
      (await s.tags(a, orgA)).filter((x) => x.plant_id === plant && x.state === 'active'),
    ).toHaveLength(1);
  });
  it('accepts ownership handover atomically and preserves identity, media and history', async () => {
    const before = await s.plantDetails(a, plant);
    const transfer = await s.requestTransfer(a, plant, orgB);
    await expect(s.acceptTransfer(care, transfer.id)).rejects.toMatchObject({ status: 403 });
    await s.acceptTransfer(b, transfer.id);
    await expect(s.getPlant(a, plant)).rejects.toMatchObject({ status: 403 });
    await expect(s.getPlant(care, plant)).rejects.toMatchObject({ status: 403 });
    const after = await s.plantDetails(b, plant);
    expect(after.plant.code).toBe(before.plant.code);
    expect(after.timeline).toHaveLength(before.timeline.length);
    expect(after.analyses).toHaveLength(before.analyses.length);
    expect(after.plant.location_id).toBeNull();
    expect((await s.tags(b, orgB)).some((x) => x.plant_id === plant && x.state === 'active')).toBe(
      true,
    );
    await expect(s.acceptTransfer(b, transfer.id)).rejects.toMatchObject({ status: 409 });
  });
  it('enforces owner-only transfer and plan limits', async () => {
    await expect(authorize(care, orgA, ['owner'])).rejects.toMatchObject({ status: 403 });
    const personal = (await s.createWorkspace(a, { name: 'Personal fixture', kind: 'personal' }))
      .id;
    await expect(
      s.addMember(a, personal, { email: b.email, userId: b.id, role: 'caretaker' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects hostile origins, invalid signatures and rate bursts', async () => {
    expect(() =>
      checkOrigin(
        new Request('http://localhost:3000/api/care', {
          headers: { host: 'localhost:3000', origin: 'https://hostile.example' },
        }),
      ),
    ).toThrow();
    expect(() =>
      checkOrigin(
        new Request('http://0.0.0.0:3000/api/care', {
          headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
        }),
      ),
    ).not.toThrow();
    await expect(verifySignature('forged.value')).rejects.toMatchObject({ status: 403 });
    await rateLimit('fixture-burst', 1);
    await expect(rateLimit('fixture-burst', 1)).rejects.toMatchObject({ status: 429 });
  });
  it('keeps failed observations, bounds retries and recovers with a configured provider', async () => {
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#558844' },
    })
      .jpeg()
      .toBuffer();
    const photo = await uploadPhoto(b, plant, image, 'Retry lifecycle fixture', false),
      db = await database();
    const oldKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PROVIDER = 'openai';
    try {
      for (let n = 0; n < 3; n++) {
        await db.query('UPDATE analysis_jobs SET available_at=now() WHERE photo_id=$1', [photo.id]);
        expect(await runAnalysisBatch(1)).toBe(0);
      }
    } finally {
      process.env.AI_PROVIDER = 'development';
      if (oldKey) process.env.OPENAI_API_KEY = oldKey;
    }
    const job = (
      await db.query<{ id: string; status: string; attempts: number }>(
        'SELECT id,status,attempts FROM analysis_jobs WHERE photo_id=$1',
        [photo.id],
      )
    ).rows[0];
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(3);
    expect(
      (await db.query('SELECT id FROM plant_photos WHERE id=$1', [photo.id])).rows,
    ).toHaveLength(1);
    await db.query(
      "UPDATE analysis_jobs SET status='queued',attempts=0,available_at=now() WHERE id=$1",
      [job.id],
    );
    expect(await runAnalysisBatch(1)).toBe(1);
    expect(
      (await db.query<{ status: string }>('SELECT status FROM analysis_jobs WHERE id=$1', [job.id]))
        .rows[0].status,
    ).toBe('completed');
  });
  it('moves a crashed final-attempt lease to failed instead of leaving it stuck', async () => {
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#669955' },
    })
      .jpeg()
      .toBuffer();
    const photo = await uploadPhoto(b, plant, image, 'Expired lease fixture', false),
      db = await database();
    await db.query(
      "UPDATE analysis_jobs SET status='processing',attempts=3,locked_at=now()-interval '6 minutes' WHERE photo_id=$1",
      [photo.id],
    );
    await runAnalysisBatch(1);
    expect(
      (
        await db.query<{ status: string }>('SELECT status FROM analysis_jobs WHERE photo_id=$1', [
          photo.id,
        ])
      ).rows[0].status,
    ).toBe('failed');
  });
  it('limits a request-triggered analysis batch to the authorized plant', async () => {
    const other = (await s.createPlant(b, orgB, { name: 'Scoped worker fixture', speciesId })).id;
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#447755' },
    })
      .jpeg()
      .toBuffer();
    const first = await uploadPhoto(b, plant, image, 'Older unrelated job', false);
    const second = await uploadPhoto(b, other, image, 'Authorized job', false);
    expect(await runAnalysisBatch(1, other)).toBe(1);
    const jobs = (
      await (
        await database()
      ).query<{ photo_id: string; status: string }>(
        'SELECT photo_id,status FROM analysis_jobs WHERE photo_id=ANY($1::uuid[])',
        [[first.id, second.id]],
      )
    ).rows;
    expect(jobs.find((j) => j.photo_id === first.id)?.status).toBe('queued');
    expect(jobs.find((j) => j.photo_id === second.id)?.status).toBe('completed');
  });
  it('keeps a subscription worker within its explicitly selected workspace', async () => {
    const owned = (await s.createPlant(a, orgA, { name: 'Selected worker workspace', speciesId }))
      .id;
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#557744' },
    })
      .jpeg()
      .toBuffer();
    const photo = await uploadPhoto(a, owned, image, 'Workspace scope fixture', false);
    expect(await runAnalysisBatch(1, undefined, Infinity, orgA)).toBe(1);
    expect(
      (
        await (
          await database()
        ).query<{ status: string }>('SELECT status FROM analysis_jobs WHERE photo_id=$1', [
          photo.id,
        ])
      ).rows[0].status,
    ).toBe('completed');
    expect(
      (
        await (
          await database()
        ).query("SELECT id FROM analysis_jobs WHERE organisation_id=$1 AND status='queued'", [orgB])
      ).rows.length,
    ).toBeGreaterThan(0);
  });
});
