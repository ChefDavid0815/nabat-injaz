import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/server/db';
import { authorize, AppError, managerRoles } from '@/server/security';
import { mediaUrl } from '@/server/media';
import { entitlements } from '@/domain/entitlements';
import type { Actor, Plant, Species } from '@/domain/types';
import { uuid, name, plantSchema } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';
import { locationCheck } from '@/domain/locations/service';
import { plantTimeline } from '@/domain/observations/timeline';

const prioritySql = `(CASE a.severity WHEN 'critical' THEN 50 WHEN 'attention' THEN 30 WHEN 'watch' THEN 12 ELSE 0 END + LEAST(25,greatest(0,-coalesce(h.delta,0)))*coalesce(h.confidence,.5) + LEAST(20,greatest(0,extract(epoch FROM (now()-coalesce(c.last_watered,p.created_at)))/86400-s.watering_days))*2 + greatest(0,100-coalesce(h.score,100))*.1)`;
export const plantSelect = `SELECT p.*,s.common_name species_name,s.scientific_name,s.watering_days,l.name location_name,${prioritySql} priority_score,
 h.score,h.delta,h.confidence,h.trend,h.reasons,c.last_watered,c.last_serviced,a.reason alert_reason,a.severity alert_severity,
 (SELECT count(*)::int FROM alerts x WHERE x.plant_id=p.id AND x.status<>'resolved') active_alerts,
 t.public_token tag_token,pa.user_id assignee_id,u.name assignee_name,ph.id photo_id,ph.source photo_source
 FROM plants p JOIN plant_species s ON s.id=p.species_id LEFT JOIN locations l ON l.id=p.location_id
 LEFT JOIN LATERAL(SELECT * FROM health_score_snapshots WHERE plant_id=p.id ORDER BY created_at DESC LIMIT 1) h ON true
 LEFT JOIN LATERAL(SELECT max(occurred_at) FILTER(WHERE type='watered') last_watered,max(occurred_at) last_serviced FROM care_events WHERE plant_id=p.id) c ON true
 LEFT JOIN LATERAL(SELECT reason,severity FROM alerts WHERE plant_id=p.id AND status<>'resolved' ORDER BY CASE severity WHEN 'critical' THEN 3 WHEN 'attention' THEN 2 ELSE 1 END DESC LIMIT 1) a ON true
 LEFT JOIN plant_tags t ON t.plant_id=p.id AND t.state='active'
 LEFT JOIN plant_assignments pa ON pa.plant_id=p.id AND pa.ended_at IS NULL
 LEFT JOIN organisation_memberships m ON m.user_id=pa.user_id AND m.organisation_id=p.organisation_id
 LEFT JOIN users u ON u.id=m.user_id
 LEFT JOIN LATERAL(SELECT id,source FROM plant_photos WHERE plant_id=p.id ORDER BY captured_at DESC LIMIT 1) ph ON true`;

type PlantRow = Plant & { photo_id: string | null; photo_source: string | null };

async function presentPlant(p: PlantRow): Promise<Plant> {
  const { photo_id, photo_source, ...fields } = p;
  return {
    ...fields,
    priority_reasons: [
      p.alert_severity ? `Alert severity: ${p.alert_severity}` : '',
      p.delta !== null && p.delta < 0
        ? `${Math.abs(p.delta)} point decline, confidence-weighted`
        : '',
      p.last_watered &&
      (Date.now() - new Date(p.last_watered).getTime()) / 86400000 > p.watering_days
        ? 'Soil moisture check overdue'
        : '',
    ].filter(Boolean),
    image:
      photo_id && photo_source !== 'fixture'
        ? await mediaUrl(photo_id, false, p.organisation_id)
        : p.demo_image,
  };
}

export async function plants(
  actor: Actor,
  org: string,
  input: {
    search?: string;
    location?: string;
    state?: string;
    species?: string;
    assignee?: string;
    overdue?: boolean;
    alert?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  await authorize(actor, org);
  const db = await database();
  const values: unknown[] = [org];
  const filters = ['p.organisation_id=$1'];
  const add = (expression: string, value: unknown) => {
    values.push(value);
    filters.push(expression.replace('?', `$${values.length}`));
  };
  if (input.search)
    add(
      "(p.name || ' ' || p.code || ' ' || s.common_name) ILIKE ?",
      `%${input.search.slice(0, 120)}%`,
    );
  if (input.location) {
    uuid.parse(input.location);
    add('p.location_id=?', input.location);
  }
  if (input.species) {
    uuid.parse(input.species);
    add('p.species_id=?', input.species);
  }
  if (input.assignee) {
    uuid.parse(input.assignee);
    add('pa.user_id=?', input.assignee);
  }
  if (input.state) {
    const state = z
      .enum(['healthy', 'watch', 'attention', 'critical', 'baseline'])
      .parse(input.state);
    filters.push(
      {
        healthy: 'h.score>=80',
        watch: 'h.score>=70 AND h.score<80',
        attention: 'h.score>=50 AND h.score<70',
        critical: 'h.score<50',
        baseline: 'h.score IS NULL',
      }[state],
    );
  }
  if (input.overdue)
    filters.push("coalesce(c.last_watered,p.created_at)<now()-s.watering_days*interval '1 day'");
  if (input.alert)
    add(
      "EXISTS(SELECT 1 FROM alerts filter_alert WHERE filter_alert.plant_id=p.id AND filter_alert.status<>'resolved' AND filter_alert.rule=?)",
      input.alert.slice(0, 100),
    );
  const page = z
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(input.page || 0),
    limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(input.limit || 50);
  const query = plantSelect + ' WHERE ' + filters.join(' AND ');
  const total = (
    await db.query<{ count: number }>('SELECT count(*)::int FROM (' + query + ') fleet', values)
  ).rows[0].count;
  const rows = (
    await db.query<PlantRow>(
      query +
        ` ORDER BY priority_score DESC,h.score ASC NULLS LAST,p.code LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, page * limit],
    )
  ).rows;
  return { items: await Promise.all(rows.map(presentPlant)), total, page, limit };
}

export async function getPlant(actor: Actor, id: string) {
  uuid.parse(id);
  const p = (await (await database()).query<PlantRow>(plantSelect + ' WHERE p.id=$1', [id]))
    .rows[0];
  if (!p) throw new AppError(404, 'Plant not found.');
  await authorize(actor, p.organisation_id);
  return presentPlant(p);
}

export async function plantDetails(actor: Actor, id: string) {
  const plant = await getPlant(actor, id),
    db = await database();
  const [species, page, history, analyses, jobs] = await Promise.all([
    db.query<Species>('SELECT * FROM plant_species WHERE id=$1', [plant.species_id]),
    plantTimeline(plant),
    db.query(
      'SELECT * FROM (SELECT id,score,delta,trend,confidence,composition,engine_version,created_at FROM health_score_snapshots WHERE plant_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 100) recent ORDER BY created_at ASC',
      [id, plant.organisation_id],
    ),
    db.query(
      'SELECT id,provider,model,contract_version,features,comparison,created_at FROM visual_analyses WHERE plant_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 10',
      [id, plant.organisation_id],
    ),
    db.query(
      "SELECT id,status,attempts,error,photo_id FROM analysis_jobs WHERE plant_id=$1 AND organisation_id=$2 AND status IN ('queued','processing','failed') ORDER BY created_at DESC",
      [id, plant.organisation_id],
    ),
  ]);
  return {
    plant,
    species: species.rows[0],
    timeline: page.items,
    timelineCursor: page.nextCursor,
    history: history.rows,
    analyses: analyses.rows,
    jobs: jobs.rows,
  };
}

export async function createPlant(actor: Actor, org: string, raw: unknown) {
  const input = plantSchema.parse(raw),
    db = await database(),
    id = randomUUID(),
    code = `NAB-${randomBytes(4).toString('hex').toUpperCase()}`;
  await db.transaction(async (tx) => {
    const w = await authorize(actor, org, managerRoles, tx);
    await tx.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE', [org]);
    const count = (
      await tx.query<{ n: number }>('SELECT count(*)::int n FROM plants WHERE organisation_id=$1', [
        org,
      ])
    ).rows[0].n;
    if (count >= entitlements[w.plan].plants)
      throw new AppError(409, 'Your workspace plant limit has been reached.');
    if (
      !(await tx.query('SELECT id FROM plant_species WHERE id=$1', [input.speciesId])).rows.length
    )
      throw new AppError(400, 'Select a known species.');
    await locationCheck(tx, org, input.locationId);
    await tx.query(
      'INSERT INTO plants(id,organisation_id,code,name,species_id,location_id,origin,acquired_at,public_passport,age_months_estimate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        org,
        code,
        input.name,
        input.speciesId,
        input.locationId || null,
        input.origin,
        input.acquiredAt || null,
        input.publicPassport,
        input.ageMonthsEstimate ?? null,
      ],
    );
    await tx.query(
      'INSERT INTO plant_tags(id,organisation_id,plant_id,public_token) VALUES($1,$2,$3,$4)',
      [randomUUID(), org, id, randomBytes(24).toString('base64url')],
    );
    await audit(tx, org, actor.id, 'plant.created', id);
  });
  return { id, code };
}

export async function updatePlant(actor: Actor, id: string, raw: unknown) {
  const data = z
      .object({ name, origin: z.string().max(250), publicPassport: z.boolean() })
      .parse(raw),
    p = await getPlant(actor, id),
    db = await database();
  await db.transaction(async (tx) => {
    await authorize(actor, p.organisation_id, managerRoles, tx);
    await tx.query(
      'UPDATE plants SET name=$2,origin=$3,public_passport=$4 WHERE id=$1 AND organisation_id=$5',
      [id, data.name, data.origin, data.publicPassport, p.organisation_id],
    );
    await audit(tx, p.organisation_id, actor.id, 'plant.updated', id);
  });
}
