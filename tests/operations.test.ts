import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { database, migrate } from '../src/server/db';
import * as svc from '../src/server/services';
import * as ops from '../src/domain/operations/mutations';
import { fleet, snapshot, sessionDetail, today } from '../src/domain/operations/queries';
import { explainPriority } from '../src/domain/operations/priority';
import type { Actor } from '../src/domain/types';
import * as management from '../src/domain/operations/management';
import * as ingestion from '../src/domain/operations/imports';
import { operationsAnalytics } from '../src/domain/operations/intelligence';
import { uploadPhoto } from '../src/server/media';
import { destination } from '../src/server/tags';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { bulkWork, recordLifecycle } from '../src/domain/operations/bulk-work';
import { tagDesign, tagSheet, tagLifecycle } from '../src/server/operations-tags';
import { runAnalysisBatch } from '../src/server/analysis';
let owner: Actor,
  other: Actor,
  care: Actor,
  org: string,
  foreign: string,
  location: string,
  plant: string,
  second: string;
beforeAll(async () => {
  process.env.NABAT_DATA_DIR = path.resolve(`data/operations-test-${Date.now()}`);
  process.env.ENABLE_DEMO = 'false';
  process.env.AI_PROVIDER = 'development';
  await migrate();
  const account = async (name: string) =>
    (
      await svc.register({
        name,
        email: `${randomUUID()}@test.nabat`,
        password: 'TestPassword2026!',
      })
    ).actor;
  owner = await account('Operations owner');
  other = await account('Other tenant');
  care = await account('Field caretaker');
  org = (await svc.createWorkspace(owner, { name: 'Operations test', kind: 'business' })).id;
  foreign = (await svc.createWorkspace(other, { name: 'Foreign', kind: 'business' })).id;
  location = (await svc.createLocation(owner, org, { name: 'Lobby' })).id;
  const speciesId = (await svc.catalog(owner, org)).species[0].id;
  plant = (await svc.createPlant(owner, org, { name: 'Ficus', speciesId, locationId: location }))
    .id;
  second = (await svc.createPlant(owner, org, { name: 'Palm', speciesId, locationId: location }))
    .id;
  await svc.addMember(owner, org, { email: care.email, userId: care.id, role: 'caretaker' });
});
describe('Operations 1.1', () => {
  it('binds offline care to the account that captured it', async () => {
    await expect(
      ops.logOperationsCare(care, org, {
        plantId: plant,
        type: 'watered',
        expectedActorId: owner.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('explains every priority contribution without inventing missing health', () => {
    const priority = explainPriority({
      score: null,
      delta: -14,
      confidence: 0.25,
      severity: 'critical',
      overdueDays: 2,
      inspectionDays: 0,
    });
    expect(priority.score).toBe(57.5);
    expect(priority.reasons).toHaveLength(3);
  });
  it('rejects cross-tenant reads and caretaker fleet mutations', async () => {
    await expect(snapshot(other, org)).rejects.toMatchObject({ status: 403 });
    await expect(
      ops.bulkChange(care, org, {
        action: 'move',
        targetId: location,
        plants: [{ id: plant, revision: 0 }],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('replays an offline care operation once and preserves captured time', async () => {
    const at = new Date(Date.now() - 3600000).toISOString();
    const input = { plantId: plant, type: 'watered', occurredAt: at, idempotencyKey: randomUUID() };
    const first = await ops.logOperationsCare(care, org, input);
    expect(await ops.logOperationsCare(care, org, input)).toEqual(first);
    const events = (
      await (
        await database()
      ).query<{ occurred_at: Date }>(
        'SELECT occurred_at FROM care_events WHERE idempotency_key=$1',
        [input.idempotencyKey],
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(new Date(events[0].occurred_at).toISOString()).toBe(at);
    await expect(
      ops.logOperationsCare(care, org, { ...input, type: 'inspected' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects future care and foreign plants', async () => {
    await expect(
      ops.logOperationsCare(care, org, {
        plantId: plant,
        type: 'watered',
        occurredAt: new Date(Date.now() + 86400000).toISOString(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ops.logOperationsCare(other, foreign, {
        plantId: plant,
        type: 'watered',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('reconciles overdue care once and consumes actual events from the mobile care service', async () => {
    await (
      await database()
    ).query("UPDATE plants SET created_at=now()-interval '90 days' WHERE id=$1", [second]);
    await ops.reconcileQueue(owner, org);
    await ops.reconcileQueue(owner, org);
    const tasks = (await today(owner, org)).filter(
      (t) => t.plant_id === second && t.source === 'overdue',
    );
    expect(tasks).toHaveLength(1);
    await svc.logCare(care, second, { type: 'watered', idempotencyKey: randomUUID() });
    await ops.reconcileQueue(owner, org);
    expect((await today(owner, org)).find((t) => t.id === tasks[0].id)?.status).toBe('completed');
  });
  it('starts, visits and completes an owned maintenance session with persisted counts', async () => {
    const started = await ops.startSession(care, org, {
      locationId: location,
      plantIds: [plant, second],
      idempotencyKey: randomUUID(),
    });
    await ops.logOperationsCare(care, org, {
      plantId: plant,
      type: 'inspected',
      sessionId: started.id,
      idempotencyKey: randomUUID(),
    });
    await ops.logOperationsCare(care, org, {
      plantId: second,
      type: 'fertilised',
      sessionId: started.id,
      idempotencyKey: randomUUID(),
    });
    await expect(
      ops.finishSession(owner, org, started.id, {
        revision: 0,
        action: 'complete',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    const done = await ops.finishSession(care, org, started.id, {
      revision: 0,
      action: 'complete',
      idempotencyKey: randomUUID(),
    });
    expect(done.summary.plants_visited).toBe(2);
    expect(done.summary.fertilised).toBe(1);
    expect(done.summary.inspected).toBe(1);
    expect((await sessionDetail(care, org, started.id))?.session.status).toBe('completed');
    await expect(
      ops.logOperationsCare(care, org, {
        plantId: plant,
        type: 'watered',
        sessionId: started.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('requires real care evidence for task completion and atomically links care to task', async () => {
    const task = await ops.createTask(owner, org, {
      plantId: plant,
      kind: 'inspected',
      title: 'Inspect Ficus',
      dueAt: new Date().toISOString(),
      assigneeId: care.id,
      idempotencyKey: randomUUID(),
    });
    await expect(
      ops.updateTask(care, org, task.id, {
        revision: 0,
        status: 'completed',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await ops.logOperationsCare(care, org, {
      plantId: plant,
      type: 'inspected',
      taskId: task.id,
      idempotencyKey: randomUUID(),
    });
    expect((await today(owner, org)).find((t) => t.id === task.id)?.status).toBe('completed');
  });
  it('rolls back all of a stale bulk batch and accepts only current workspace targets', async () => {
    const rows = (await fleet(owner, org)).items;
    const input = {
      action: 'assign',
      targetId: care.id,
      plants: rows.map((p) => ({ id: String(p.id), revision: Number(p.operations_revision) })),
      idempotencyKey: randomUUID(),
    };
    await ops.bulkChange(owner, org, input);
    const revisions = (await fleet(owner, org)).items.map((p) => Number(p.operations_revision));
    await expect(
      ops.bulkChange(owner, org, { ...input, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await fleet(owner, org)).items.map((p) => Number(p.operations_revision))).toEqual(
      revisions,
    );
    await expect(
      ops.bulkChange(owner, org, { ...input, targetId: other.id, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('applies the alert lifecycle with revisions, assignment and a resolution note', async () => {
    const id = randomUUID();
    await (
      await database()
    ).query(
      "INSERT INTO alerts(id,organisation_id,plant_id,rule,severity,reason,recommended_action) VALUES($1,$2,$3,'test','critical','Decline','Inspect')",
      [id, org, plant],
    );
    await ops.transitionAlert(owner, org, id, {
      status: 'assigned',
      assigneeId: care.id,
      revision: 0,
      idempotencyKey: randomUUID(),
    });
    await expect(
      ops.transitionAlert(care, org, id, {
        status: 'in_progress',
        revision: 0,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await ops.transitionAlert(care, org, id, {
      status: 'in_progress',
      revision: 1,
      idempotencyKey: randomUUID(),
    });
    await expect(
      ops.transitionAlert(care, org, id, {
        status: 'resolved',
        revision: 2,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await ops.transitionAlert(care, org, id, {
      status: 'resolved',
      revision: 2,
      resolutionNote: 'Inspected roots and corrected drainage.',
      idempotencyKey: randomUUID(),
    });
    await ops.transitionAlert(owner, org, id, {
      status: 'reopened',
      revision: 3,
      idempotencyKey: randomUUID(),
    });
    const alert = (
      await (
        await database()
      ).query<{ status: string; resolved_at: Date | null }>(
        'SELECT status,resolved_at FROM alerts WHERE id=$1',
        [id],
      )
    ).rows[0];
    expect(alert.status).toBe('reopened');
    expect(alert.resolved_at).toBeNull();
  });
  it('paginates and sorts the desktop fleet and exposes complete metrics', async () => {
    const result = await fleet(owner, org, { sort: 'name', direction: 'asc', limit: 1 });
    expect(result.items[0].name).toBe('Ficus');
    expect(result.total).toBe(2);
    expect((await snapshot(owner, org)).metrics.total).toBe(2);
  });
  it('preserves V1.0 transfers while clearing source-workspace operational assignments', async () => {
    const speciesId = (await svc.catalog(owner, org)).species[0].id;
    const moving = (
      await svc.createPlant(owner, org, {
        name: 'Transfer operations fixture',
        speciesId,
        locationId: location,
      })
    ).id;
    const task = await ops.createTask(owner, org, {
      plantId: moving,
      kind: 'inspected',
      title: 'Inspect after transfer',
      assigneeId: care.id,
      dueAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    });
    const transfer = await svc.requestTransfer(owner, moving, foreign);
    await svc.acceptTransfer(other, transfer.id);
    const result = (await today(other, foreign)).find((t) => t.id === task.id);
    expect(result?.assignee_id).toBeNull();
    expect(result?.revision).toBe(1);
    await expect(svc.getPlant(owner, moving)).rejects.toMatchObject({ status: 403 });
  });
  it('links the unchanged mobile care entry point to a manager-assigned field session', async () => {
    const session = await ops.startSession(owner, org, {
      ownerId: care.id,
      plantIds: [plant],
      idempotencyKey: randomUUID(),
    });
    await svc.logCare(care, plant, { type: 'inspected', idempotencyKey: randomUUID() });
    const detail = await sessionDetail(owner, org, session.id);
    expect(detail?.plants[0].visited_at).not.toBeNull();
    expect(detail?.events).toHaveLength(1);
    const ended = await ops.finishSession(care, org, session.id, {
      revision: 0,
      action: 'complete',
      idempotencyKey: randomUUID(),
    });
    expect(ended.summary.inspected).toBe(1);
  });
  it('gives Viewer read access while denying existing web care and photo writes', async () => {
    const viewer = (
      await svc.register({
        name: 'Viewer fixture',
        email: randomUUID() + '@test.nabat',
        password: 'TestPassword2026!',
      })
    ).actor;
    await svc.addMember(owner, org, { email: viewer.email, userId: viewer.id, role: 'viewer' });
    expect((await snapshot(viewer, org)).workspace.role).toBe('viewer');
    await expect(
      svc.logCare(viewer, plant, { type: 'watered', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    const bytes = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#406d32' },
    })
      .png()
      .toBuffer();
    await expect(uploadPhoto(viewer, plant, bytes, 'Viewer denied', false)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('keeps saved views private to the actor and validates location assignment', async () => {
    await management.saveView(owner, org, {
      name: 'Critical fleet',
      filters: { state: 'critical' },
      idempotencyKey: randomUUID(),
    });
    expect(await management.savedViews(owner, org)).toHaveLength(1);
    expect(await management.savedViews(care, org)).toHaveLength(0);
    await expect(
      management.updateLocation(owner, org, location, {
        name: 'Lobby',
        kind: 'zone',
        parentId: location,
        defaultCaretakerId: care.id,
        critical: true,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('stores scoped floor plans and detects concurrent pin movement', async () => {
    const bytes = await sharp({
      create: { width: 160, height: 100, channels: 3, background: '#faf7ef' },
    })
      .png()
      .toBuffer();
    const plan = await management.saveFloorPlan(owner, org, location, bytes);
    expect((await management.floorPlanBytes(owner, org, plan.id)).length).toBeGreaterThan(20);
    await management.savePin(owner, org, {
      plantId: plant,
      locationId: location,
      x: 0.3,
      y: 0.4,
      revision: null,
      idempotencyKey: randomUUID(),
    });
    await expect(
      management.savePin(owner, org, {
        plantId: plant,
        locationId: location,
        x: 0.8,
        y: 0.7,
        revision: null,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(management.floorPlan(other, org, location)).rejects.toMatchObject({ status: 403 });
  });
  it('maps import filenames and own QR identities without following external QR links', async () => {
    const p = await svc.getPlant(owner, plant);
    const batch = await ingestion.createImport(owner, org, {
      files: [{ filename: p.code + '_before.png' }, { filename: 'unmapped.png' }],
      idempotencyKey: randomUUID(),
    });
    const items = await ingestion.importItems(owner, org, batch.id);
    expect(items.filter((i) => i.status === 'ready')).toHaveLength(1);
    const tag = (await svc.tags(owner, org)).find((t) => t.plant_id === plant)!;
    const qr = await QRCode.toBuffer(destination(tag.public_token), { width: 360 });
    expect((await ingestion.detectImportIdentity(owner, org, qr)).candidate?.id).toBe(plant);
    const foreignQr = await QRCode.toBuffer('https://example.com/p/' + tag.public_token, {
      width: 360,
    });
    expect((await ingestion.detectImportIdentity(owner, org, foreignQr)).candidate).toBeNull();
  });
  it('aggregates actual operations data and keeps unmeasured lifecycle rates explicit', async () => {
    const data = await operationsAnalytics(owner, org, { days: 30 });
    expect(Number(data.overview.total)).toBe(2);
    expect(Number(data.operations.completed)).toBeGreaterThan(0);
    expect(data.survivalRate.value).toBeNull();
  });
  it('uses reviewed bulk inspection/scheduling and records genuine lifecycle outcomes', async () => {
    const selected = (await fleet(owner, org)).items.map((p) => ({
      id: p.id,
      revision: p.operations_revision,
    }));
    await bulkWork(owner, org, {
      plants: selected,
      action: 'schedule',
      dueAt: new Date().toISOString(),
      assigneeId: care.id,
      idempotencyKey: randomUUID(),
    });
    const p = (await fleet(owner, org)).items.find((p) => p.id === plant)!;
    await recordLifecycle(owner, org, plant, {
      kind: 'retired',
      outcome: 'died',
      reason: 'Synthetic lifecycle test outcome',
      revision: p.operations_revision,
      idempotencyKey: randomUUID(),
    });
    expect((await fleet(owner, org)).items.some((p) => p.id === plant)).toBe(false);
    const report = await operationsAnalytics(owner, org, { days: 30 });
    expect(report.survivalRate.value).not.toBeNull();
    expect(report.survivalRate.value).toBeLessThan(100);
  });
  it('renders tag templates and keeps replacement history with an idempotent receipt', async () => {
    const tag = (await svc.tags(owner, org)).find((t) => t.plant_id === second)!;
    const design = await tagDesign(tag.code, tag.name, tag.public_token, 'thermal');
    expect(design.widthMm).toBe(60);
    const png = await sharp(Buffer.from(design.svg), { density: 300 }).png().toBuffer();
    expect((await ingestion.detectImportIdentity(owner, org, png)).candidate?.id).toBe(second);
    const sheet = await tagSheet(owner, org, [tag.id]);
    expect(sheet).toContain('210mm');
    const input = { action: 'replace', idempotencyKey: randomUUID() };
    const result = await tagLifecycle(owner, org, tag.id, input);
    expect(await tagLifecycle(owner, org, tag.id, input)).toEqual(result);
    expect((await svc.tags(owner, org)).find((t) => t.id === tag.id)?.state).toBe('replaced');
  });
  it('preserves historical analysis without overwriting a newer current score', async () => {
    const speciesId = (await svc.catalog(owner, org)).species[0].id;
    const created = (
      await svc.createPlant(owner, org, { name: 'Historical input fixture', speciesId })
    ).id;
    const photo = await sharp({
      create: { width: 90, height: 90, channels: 3, background: '#406d32' },
    })
      .png()
      .toBuffer();
    await uploadPhoto(owner, created, photo, 'Current synthetic fixture', true);
    await runAnalysisBatch(1, created);
    const before = (await svc.getPlant(owner, created)).score;
    await uploadPhoto(
      owner,
      created,
      photo,
      'Older synthetic fixture',
      true,
      undefined,
      undefined,
      new Date(Date.now() - 86400000 * 21),
    );
    await runAnalysisBatch(1, created);
    expect((await svc.getPlant(owner, created)).score).toBe(before);
    const rows = (
      await (
        await database()
      ).query<{ historical: boolean }>(
        "SELECT (comparison->>'historicalOnly')::boolean historical FROM visual_analyses WHERE plant_id=$1 ORDER BY created_at DESC LIMIT 1",
        [created],
      )
    ).rows;
    expect(rows[0].historical).toBe(true);
  });
  it('accepts omitted nullable fields from the native client when clearing location responsibility', async () => {
    await management.updateLocation(owner, org, location, {
      name: 'Lobby',
      kind: 'room',
      critical: false,
      idempotencyKey: randomUUID(),
    });
    const row = (
      await (
        await database()
      ).query('SELECT default_caretaker_id,parent_id FROM locations WHERE id=$1', [location])
    ).rows[0];
    expect(row.default_caretaker_id).toBeNull();
    expect(row.parent_id).toBeNull();
  });
  it('paginates a thousand synthetic identities while keeping workspace metrics global', async () => {
    const speciesId = (await svc.catalog(owner, org)).species[0].id;
    await (
      await database()
    ).query(
      "INSERT INTO plants(id,organisation_id,species_id,code,name) SELECT gen_random_uuid(),$1,$2,'SCALE-'||n,'Scale fixture '||n FROM generate_series(1,1000) n",
      [org, speciesId],
    );
    const first = await fleet(owner, org, { limit: 100, sort: 'code', direction: 'asc' }),
      secondPage = await fleet(owner, org, { limit: 100, sort: 'code', direction: 'asc', page: 1 });
    expect(first.total).toBeGreaterThanOrEqual(1000);
    expect(first.items).toHaveLength(100);
    expect(secondPage.items).toHaveLength(100);
    expect(new Set([...first.items, ...secondPage.items].map((p) => p.id)).size).toBe(200);
    const workspace = await snapshot(owner, org);
    expect(workspace.metrics.total).toBe(first.total);
    expect(workspace.metrics.baseline).toBeGreaterThanOrEqual(1000);
  });
});
