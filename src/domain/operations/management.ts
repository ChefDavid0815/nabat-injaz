import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import type { Actor } from '@/domain/types';
import { database } from '@/server/db';
import { storage } from '@/server/media';
import { AppError, digest } from '@/server/security';
import { audit } from '@/domain/audit/service';
import { requireCapability } from './authorization';
import { mutate } from './mutations';
import { mutationBase, fleetInput } from './contracts';
import { destination } from '@/server/tags';

const viewSchema = mutationBase.extend({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  filters: fleetInput,
  columns: z.array(z.string().max(40)).max(20).default([]),
  groupBy: z.enum(['none', 'location', 'state', 'species', 'assignee']).default('none'),
});
export async function savedViews(actor: Actor, org: string) {
  await requireCapability(actor, org, 'operations.read');
  return (
    await (
      await database()
    ).query(
      'SELECT * FROM operations_saved_views WHERE organisation_id=$1 AND actor_id=$2 ORDER BY name',
      [org, actor.id],
    )
  ).rows;
}
export async function saveView(actor: Actor, org: string, raw: unknown) {
  const data = viewSchema.parse(raw);
  return mutate(
    actor,
    org,
    'operations.read',
    data.idempotencyKey,
    { operation: 'view.save', ...data },
    async (tx) => {
      const id = data.id || randomUUID(),
        filters = { ...data.filters, page: 0, columns: data.columns, groupBy: data.groupBy };
      if (data.id) {
        const updated = await tx.query(
          'UPDATE operations_saved_views SET name=$4,filters=$5 WHERE id=$1 AND organisation_id=$2 AND actor_id=$3 RETURNING id',
          [id, org, actor.id, data.name, JSON.stringify(filters)],
        );
        if (!updated.rows.length) throw new AppError(404, 'Saved view not found.');
      } else
        await tx.query(
          'INSERT INTO operations_saved_views(id,organisation_id,actor_id,name,filters) VALUES($1,$2,$3,$4,$5)',
          [id, org, actor.id, data.name, JSON.stringify(filters)],
        );
      return { id, name: data.name };
    },
  );
}
export async function removeView(actor: Actor, org: string, id: string) {
  await requireCapability(actor, org, 'operations.read');
  await (
    await database()
  ).query('DELETE FROM operations_saved_views WHERE id=$1 AND organisation_id=$2 AND actor_id=$3', [
    z.uuid().parse(id),
    org,
    actor.id,
  ]);
  return { removed: true };
}

export async function locationOperations(actor: Actor, org: string) {
  await requireCapability(actor, org, 'operations.read');
  return (
    await (
      await database()
    ).query(
      "SELECT l.*,u.name default_caretaker_name,count(p.id)::int plant_count,round(avg(h.score),1)::float8 average_health,count(p.id) FILTER(WHERE h.score<50)::int critical_count,count(p.id) FILTER(WHERE h.score BETWEEN 50 AND 69)::int attention_count,(SELECT count(*)::int FROM alerts a JOIN plants ap ON ap.id=a.plant_id WHERE ap.location_id=l.id AND a.organisation_id=l.organisation_id AND a.status<>'resolved') open_alerts FROM locations l LEFT JOIN plants p ON p.location_id=l.id AND p.organisation_id=l.organisation_id AND p.lifecycle_status='active' LEFT JOIN LATERAL(SELECT score FROM health_score_snapshots WHERE plant_id=p.id ORDER BY created_at DESC LIMIT 1) h ON true LEFT JOIN organisation_memberships m ON m.user_id=l.default_caretaker_id AND m.organisation_id=l.organisation_id LEFT JOIN users u ON u.id=m.user_id WHERE l.organisation_id=$1 GROUP BY l.id,u.name ORDER BY l.name",
      [org],
    )
  ).rows;
}
const locationSchema = mutationBase.extend({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['site', 'building', 'floor', 'zone', 'room', 'area']),
  defaultCaretakerId: z.uuid().nullable().default(null),
  critical: z.boolean(),
  parentId: z.uuid().nullable().default(null),
});
export async function updateLocation(actor: Actor, org: string, id: string, raw: unknown) {
  const data = locationSchema.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'location.update', id, ...data },
    async (tx) => {
      if (
        data.defaultCaretakerId &&
        !(
          await tx.query(
            "SELECT id FROM organisation_memberships WHERE organisation_id=$1 AND user_id=$2 AND role<>'viewer'",
            [org, data.defaultCaretakerId],
          )
        ).rows.length
      )
        throw new AppError(400, 'Choose a caretaker with care permissions.');
      if (data.parentId) {
        const parents = await tx.query(
          'WITH RECURSIVE ancestors AS(SELECT id,parent_id FROM locations WHERE id=$1 AND organisation_id=$2 UNION ALL SELECT l.id,l.parent_id FROM locations l JOIN ancestors a ON l.id=a.parent_id WHERE l.organisation_id=$2) SELECT id FROM ancestors',
          [data.parentId, org],
        );
        if (!parents.rows.length || parents.rows.some((row) => row.id === id))
          throw new AppError(400, 'Location hierarchy cannot contain a cycle.');
      }
      const result = await tx.query(
        'UPDATE locations SET name=$3,kind=$4,default_caretaker_id=$5,critical=$6,parent_id=$7 WHERE id=$1 AND organisation_id=$2 RETURNING id',
        [id, org, data.name, data.kind, data.defaultCaretakerId, data.critical, data.parentId],
      );
      if (!result.rows.length) throw new AppError(404, 'Location not found.');
      await audit(tx, org, actor.id, 'location.operations-updated', id, { kind: data.kind });
      return { id };
    },
  );
}
export async function floorPlan(actor: Actor, org: string, locationId: string) {
  await requireCapability(actor, org, 'operations.read');
  const db = await database();
  const plan =
    (
      await db.query(
        'SELECT id,width,height,created_at FROM location_floor_plans WHERE organisation_id=$1 AND location_id=$2',
        [org, locationId],
      )
    ).rows[0] || null;
  const pins = (
    await db.query(
      'SELECT pin.*,p.name,p.code,h.score FROM location_plant_pins pin JOIN plants p ON p.id=pin.plant_id AND p.organisation_id=pin.organisation_id LEFT JOIN LATERAL(SELECT score FROM health_score_snapshots WHERE plant_id=p.id ORDER BY created_at DESC LIMIT 1) h ON true WHERE pin.organisation_id=$1 AND pin.location_id=$2 ORDER BY p.code',
      [org, locationId],
    )
  ).rows;
  return { plan, pins };
}
export async function floorPlanBytes(actor: Actor, org: string, id: string) {
  await requireCapability(actor, org, 'operations.read');
  const record = (
    await (
      await database()
    ).query<{ object_key: string }>(
      'SELECT object_key FROM location_floor_plans WHERE id=$1 AND organisation_id=$2',
      [id, org],
    )
  ).rows[0];
  if (!record) throw new AppError(404, 'Floor plan not found.');
  return storage().get(record.object_key);
}
export async function saveFloorPlan(actor: Actor, org: string, locationId: string, bytes: Buffer) {
  await requireCapability(actor, org, 'fleet.manage');
  if (bytes.length > 4 * 1024 * 1024)
    throw new AppError(413, 'Use a floor plan smaller than 4 MB.');
  const metadata = await sharp(bytes, { limitInputPixels: 20000000 })
    .metadata()
    .catch(() => null);
  if (
    !metadata ||
    !['jpeg', 'png', 'webp'].includes(metadata.format || '') ||
    (metadata.pages || 1) > 1
  )
    throw new AppError(400, 'Choose a still PNG, JPEG or WebP floor plan.');
  const db = await database();
  if (
    !(
      await db.query('SELECT id FROM locations WHERE id=$1 AND organisation_id=$2', [
        locationId,
        org,
      ])
    ).rows.length
  )
    throw new AppError(404, 'Location not found.');
  const output = await sharp(bytes)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  const id = randomUUID(),
    key = org + '/floor-plans/' + id + '.webp';
  await storage().put(key, output.data, 'image/webp');
  await db.transaction(async (tx) => {
    await requireCapability(actor, org, 'fleet.manage', tx);
    await tx.query(
      'INSERT INTO location_floor_plans(id,organisation_id,location_id,object_key,width,height,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(location_id,organisation_id) DO UPDATE SET id=excluded.id,object_key=excluded.object_key,width=excluded.width,height=excluded.height,created_by=excluded.created_by,created_at=now()',
      [id, org, locationId, key, output.info.width, output.info.height, actor.id],
    );
    await audit(tx, org, actor.id, 'location.floor-plan-saved', locationId, { planId: id });
  });
  return { id };
}
const pinSchema = mutationBase.extend({
  plantId: z.uuid(),
  locationId: z.uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  revision: z.number().int().nonnegative().nullable().default(null),
});
export async function savePin(actor: Actor, org: string, raw: unknown) {
  const data = pinSchema.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'pin.save', ...data },
    async (tx) => {
      if (
        !(
          await tx.query(
            'SELECT id FROM plants WHERE id=$1 AND organisation_id=$2 AND location_id=$3 FOR UPDATE',
            [data.plantId, org, data.locationId],
          )
        ).rows.length
      )
        throw new AppError(400, 'Select a plant in this location.');
      const old = (
        await tx.query<{ revision: number }>(
          'SELECT revision FROM location_plant_pins WHERE plant_id=$1 FOR UPDATE',
          [data.plantId],
        )
      ).rows[0];
      if ((old && old.revision !== data.revision) || (!old && data.revision !== null))
        throw new AppError(409, 'The pin changed. Refresh the map.');
      await tx.query(
        'INSERT INTO location_plant_pins(plant_id,organisation_id,location_id,x,y) VALUES($1,$2,$3,$4,$5) ON CONFLICT(plant_id) DO UPDATE SET x=excluded.x,y=excluded.y,revision=location_plant_pins.revision+1,updated_at=now()',
        [data.plantId, org, data.locationId, data.x, data.y],
      );
      await audit(tx, org, actor.id, 'location.pin-positioned', data.plantId, {
        locationId: data.locationId,
      });
      return { plantId: data.plantId, revision: old ? old.revision + 1 : 0 };
    },
  );
}
export async function removePin(actor: Actor, org: string, plantId: string) {
  await requireCapability(actor, org, 'fleet.manage');
  await (
    await database()
  ).query('DELETE FROM location_plant_pins WHERE plant_id=$1 AND organisation_id=$2', [
    plantId,
    org,
  ]);
  return { removed: true };
}

const issueSchema = mutationBase.extend({
  plantId: z.uuid(),
  note: z.string().trim().min(1).max(2000),
  severity: z.enum(['watch', 'attention', 'critical']),
  sessionId: z.uuid().optional(),
});
export async function reportIssue(actor: Actor, org: string, raw: unknown) {
  const data = issueSchema.parse(raw);
  return mutate(
    actor,
    org,
    'care.write',
    data.idempotencyKey,
    { operation: 'issue.report', ...data },
    async (tx) => {
      if (
        !(
          await tx.query('SELECT id FROM plants WHERE id=$1 AND organisation_id=$2', [
            data.plantId,
            org,
          ])
        ).rows.length
      )
        throw new AppError(404, 'Plant not found.');
      const id = randomUUID(),
        alertId = randomUUID();
      await tx.query(
        'INSERT INTO plant_issues(id,organisation_id,plant_id,actor_id,note,severity) VALUES($1,$2,$3,$4,$5,$6)',
        [id, org, data.plantId, actor.id, data.note, data.severity],
      );
      await tx.query(
        "INSERT INTO alerts(id,organisation_id,plant_id,rule,severity,reason,recommended_action,source_id) VALUES($1,$2,$3,$4,$5,$6,'Review the reported issue and schedule a follow-up.',$7)",
        [alertId, org, data.plantId, 'field-issue:' + id, data.severity, data.note, id],
      );
      await tx.query(
        "INSERT INTO alert_status_events(id,alert_id,actor_id,status) VALUES($1,$2,$3,'open')",
        [randomUUID(), alertId, actor.id],
      );
      if (data.sessionId) {
        const session = (
          await tx.query(
            "SELECT s.id FROM maintenance_sessions s JOIN maintenance_session_plants p ON p.session_id=s.id WHERE s.id=$1 AND s.organisation_id=$2 AND s.owner_id=$3 AND s.status='active' AND p.plant_id=$4",
            [data.sessionId, org, actor.id, data.plantId],
          )
        ).rows[0];
        if (!session) throw new AppError(409, 'Use your own active session.');
        await tx.query(
          "INSERT INTO maintenance_session_events(id,session_id,plant_id,type,actor_id,note) VALUES($1,$2,$3,'issue',$4,$5)",
          [id, data.sessionId, data.plantId, actor.id, data.note],
        );
        await tx.query(
          'UPDATE maintenance_session_plants SET visited_at=coalesce(visited_at,now()) WHERE session_id=$1 AND plant_id=$2',
          [data.sessionId, data.plantId],
        );
      }
      await audit(tx, org, actor.id, 'issue.reported', id, { plantId: data.plantId });
      return { id, alertId };
    },
  );
}
const programmingSchema = mutationBase.extend({
  reader: z.string().min(1).max(160),
  uid: z.string().regex(/^[0-9A-Fa-f]{4,40}$/),
  verification: z.enum(['simulated', 'client_read_back']),
  url: z.url(),
});
export async function recordProgramming(actor: Actor, org: string, tagId: string, raw: unknown) {
  const data = programmingSchema.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'tag.programmed', tagId, ...data },
    async (tx) => {
      const tag = (
        await tx.query<{ public_token: string; state: string }>(
          'SELECT public_token,state FROM plant_tags WHERE id=$1 AND organisation_id=$2 FOR SHARE',
          [tagId, org],
        )
      ).rows[0];
      if (!tag || tag.state !== 'active' || destination(tag.public_token) !== data.url)
        throw new AppError(409, 'The tag identity changed. Reload Tag Studio.');
      const id = randomUUID();
      await tx.query(
        'INSERT INTO tag_programming_events(id,organisation_id,tag_id,actor_id,reader,uid,resolver_hash,verification) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          org,
          tagId,
          actor.id,
          data.reader,
          data.uid.toUpperCase(),
          digest(data.url),
          data.verification,
        ],
      );
      await audit(tx, org, actor.id, 'tag.programming-recorded', tagId, {
        verification: data.verification,
        programmingId: id,
      });
      return { id, verification: data.verification };
    },
  );
}
