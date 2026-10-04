import type { Actor, Plant } from '@/domain/types';
import { database } from '@/server/db';
import { plantSelect } from '@/domain/plants/service';
import { catalog } from '@/domain/organisations/service';
import { team } from '@/domain/memberships/service';
import { requireCapability } from './authorization';
import { fleetInput, type OperationTask } from './contracts';
import { explainPriority, healthState, operationsPrioritySql } from './priority';
import { mediaUrl } from '@/server/media';
import { locationOperations } from './management';

export async function fleet(actor: Actor, org: string, raw: unknown = {}) {
  await requireCapability(actor, org, 'operations.read');
  const input = fleetInput.parse(raw),
    db = await database(),
    values: unknown[] = [org];
  const where = ['p.organisation_id=$1'];
  const filter = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replaceAll('?', `$${values.length}`));
  };
  if (input.search)
    filter("(p.name || ' ' || p.code || ' ' || s.common_name) ILIKE ?", `%${input.search}%`);
  if (input.location) filter('p.location_id=?', input.location);
  if (input.assignee) filter('pa.user_id=?', input.assignee);
  if (input.lifecycle !== 'all') filter('p.lifecycle_status=?', input.lifecycle);
  if (input.state)
    where.push(
      {
        healthy: 'h.score>=80',
        watch: 'h.score>=70 AND h.score<80',
        attention: 'h.score>=50 AND h.score<70',
        critical: 'h.score<50',
        baseline: 'h.score IS NULL',
      }[input.state],
    );
  if (input.overdue)
    where.push("coalesce(c.last_watered,p.created_at)<now()-s.watering_days*interval '1 day'");
  if (input.inspection)
    where.push(
      "NOT EXISTS(SELECT 1 FROM care_events inspection WHERE inspection.plant_id=p.id AND inspection.type='inspected' AND inspection.occurred_at>now()-interval '30 days')",
    );
  if (input.noObservationDays)
    filter(
      "NOT EXISTS(SELECT 1 FROM plant_photos recent WHERE recent.plant_id=p.id AND recent.captured_at>now()-?*interval '1 day')",
      input.noObservationDays,
    );
  const select =
    plantSelect
      .replace(
        'ph.id photo_id,ph.source photo_source',
        `inspection.at last_inspected,l.critical critical_location,schedule.due scheduled_work,visual.stress visual_stress,visual.confidence visual_confidence,${operationsPrioritySql} operations_priority,ph.id photo_id,ph.source photo_source`,
      )
      .replace(
        'ph.id photo_id,ph.source photo_source',
        'ph.id photo_id,ph.source photo_source,ph.captured_at last_observation',
      )
      .replace(
        'SELECT id,source FROM plant_photos',
        'SELECT id,source,captured_at FROM plant_photos',
      ) +
    ` LEFT JOIN LATERAL(SELECT max(occurred_at) at FROM care_events WHERE plant_id=p.id AND type='inspected') inspection ON true
      LEFT JOIN LATERAL(SELECT EXISTS(SELECT 1 FROM operations_tasks WHERE plant_id=p.id AND status IN ('pending','in_progress') AND due_at<=now()) due) schedule ON true
      LEFT JOIN LATERAL(SELECT greatest((v.features->'yellowing_estimate'->>'value')::float8,(v.features->'browning_estimate'->>'value')::float8,(v.features->'wilting_signal'->>'value')::float8) stress,(v.features->>'analysis_confidence')::float8 confidence FROM visual_analyses v JOIN plant_photos vp ON vp.id=v.photo_id WHERE v.plant_id=p.id ORDER BY vp.captured_at DESC LIMIT 1) visual ON true` +
    ' WHERE ' +
    where.join(' AND ');
  const sort = {
    priority: 'operations_priority',
    name: 'p.name',
    code: 'p.code',
    score: 'h.score',
    location: 'l.name',
    last_care: 'c.last_serviced',
    species: 's.common_name',
    assignee: 'u.name',
    delta: 'h.delta',
    alerts: 'active_alerts',
    next_care: "coalesce(c.last_watered,p.created_at)+s.watering_days*interval '1 day'",
  }[input.sort];
  const rows = (
    await db.query<
      Plant & {
        operations_revision: number;
        photo_id: string | null;
        photo_source: string | null;
        last_inspected: string | null;
        critical_location: boolean;
        scheduled_work: boolean;
        visual_stress: number | null;
        visual_confidence: number | null;
      }
    >(
      select +
        ` ORDER BY ${sort} ${input.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST,p.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.page * input.limit],
    )
  ).rows;
  const items = await Promise.all(
    rows.map(async (row) => {
      const overdueDays =
        (Date.now() - new Date((row.last_watered || row.created_at) as string).getTime()) /
          86400000 -
        Number(row.watering_days);
      const priority = explainPriority({
        score: row.score === null ? null : Number(row.score),
        delta: row.delta === null ? null : Number(row.delta),
        confidence: row.confidence === null ? null : Number(row.confidence),
        severity: row.alert_severity as string | null,
        overdueDays,
        inspectionDays:
          (Date.now() - new Date(row.last_inspected || row.created_at).getTime()) / 86400000,
        criticalLocation: row.critical_location,
        scheduledWork: row.scheduled_work,
        visualStress: Number(row.visual_stress ?? 0),
        visualConfidence: Number(row.visual_confidence ?? 0),
      });
      return {
        ...row,
        operations_revision: Number(row.operations_revision),
        priority_score: priority.score,
        priority_reasons: priority.reasons,
        priority_components: priority.components,
        health_state: healthState(row.score as number | null),
        overdue_days: Math.max(0, Math.floor(overdueDays)),
        next_care: new Date(
          new Date((row.last_watered || row.created_at) as string).getTime() +
            Number(row.watering_days) * 86400000,
        ).toISOString(),
        image:
          row.photo_id && row.photo_source !== 'fixture'
            ? await mediaUrl(String(row.photo_id), false, org)
            : row.demo_image,
      };
    }),
  );
  const total = (
    await db.query<{ total: number }>(
      'SELECT count(*)::int total FROM (' + select + ') result',
      values,
    )
  ).rows[0].total;
  return { items, total, page: input.page, limit: input.limit };
}

export async function today(actor: Actor, org: string) {
  await requireCapability(actor, org, 'operations.read');
  const db = await database();
  return (
    await db.query<OperationTask>(
      `SELECT t.*,p.name plant_name,p.code plant_code,l.name location_name,u.name assignee_name
    FROM operations_tasks t JOIN plants p ON p.id=t.plant_id AND p.organisation_id=t.organisation_id
    LEFT JOIN locations l ON l.id=p.location_id LEFT JOIN organisation_memberships m ON m.user_id=t.assignee_id AND m.organisation_id=t.organisation_id LEFT JOIN users u ON u.id=m.user_id
    WHERE t.organisation_id=$1 AND ((t.status IN ('pending','in_progress') AND t.due_at<(((now() AT TIME ZONE o.timezone)::date+interval '1 day') AT TIME ZONE o.timezone)) OR (t.completed_at AT TIME ZONE o.timezone)::date=(now() AT TIME ZONE o.timezone)::date)
    ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,t.due_at,t.id LIMIT 500`.replace(
        'FROM operations_tasks t',
        'FROM operations_tasks t JOIN organisations o ON o.id=t.organisation_id',
      ),
      [org],
    )
  ).rows;
}

export async function sessions(actor: Actor, org: string) {
  await requireCapability(actor, org, 'operations.read');
  return (
    await (
      await database()
    ).query(
      `SELECT s.*,u.name owner_name,l.name location_name,
    (SELECT count(*)::int FROM maintenance_session_plants sp WHERE sp.session_id=s.id) plant_count,
    (SELECT count(*)::int FROM maintenance_session_plants sp WHERE sp.session_id=s.id AND sp.visited_at IS NOT NULL) visited_count
    FROM maintenance_sessions s JOIN users u ON u.id=s.owner_id LEFT JOIN locations l ON l.id=s.location_id
    WHERE s.organisation_id=$1 ORDER BY s.started_at DESC LIMIT 50`,
      [org],
    )
  ).rows;
}

export async function teamOperations(actor: Actor, org: string) {
  await requireCapability(actor, org, 'operations.read');
  return (
    await (
      await database()
    ).query(
      `SELECT m.user_id,m.role,u.name,u.email,
    (SELECT count(*)::int FROM plant_assignments a JOIN plants p ON p.id=a.plant_id WHERE a.organisation_id=m.organisation_id AND a.user_id=m.user_id AND a.ended_at IS NULL AND p.lifecycle_status='active') assigned_plants,
    (SELECT count(*)::int FROM operations_tasks t WHERE t.organisation_id=m.organisation_id AND t.assignee_id=m.user_id AND t.status IN ('pending','in_progress')) remaining_tasks,
    (SELECT count(*)::int FROM operations_tasks t WHERE t.organisation_id=m.organisation_id AND t.completed_by=m.user_id AND (t.completed_at AT TIME ZONE o.timezone)::date=(now() AT TIME ZONE o.timezone)::date) completed_today,
    (SELECT count(*)::int FROM care_events c WHERE c.organisation_id=m.organisation_id AND c.actor_id=m.user_id AND c.occurred_at>now()-interval '30 days') care_last_30_days
    FROM organisation_memberships m JOIN users u ON u.id=m.user_id JOIN organisations o ON o.id=m.organisation_id WHERE m.organisation_id=$1 ORDER BY u.name`,
      [org],
    )
  ).rows;
}

export async function sessionDetail(actor: Actor, org: string, id: string) {
  await requireCapability(actor, org, 'operations.read');
  const db = await database();
  const session = (
    await db.query('SELECT * FROM maintenance_sessions WHERE id=$1 AND organisation_id=$2', [
      id,
      org,
    ])
  ).rows[0];
  if (!session) return null;
  return {
    session,
    plants: (
      await db.query(
        'SELECT * FROM maintenance_session_plants WHERE session_id=$1 ORDER BY plant_code',
        [id],
      )
    ).rows,
    events: (
      await db.query(
        'SELECT * FROM maintenance_session_events WHERE session_id=$1 ORDER BY occurred_at',
        [id],
      )
    ).rows,
  };
}

export async function snapshot(actor: Actor, org: string) {
  const workspace = await requireCapability(actor, org, 'operations.read'),
    db = await database();
  const [plants, tasks, maintenance, structure, members, metrics, alerts, recent] =
    await Promise.all([
      fleet(actor, org, { limit: 100 }),
      today(actor, org),
      sessions(actor, org),
      catalog(actor, org),
      team(actor, org),
      db.query(
        `SELECT count(*)::int total, count(*) FILTER(WHERE h.score>=80)::int healthy,
      count(*) FILTER(WHERE h.score>=70 AND h.score<80)::int watch, count(*) FILTER(WHERE h.score>=50 AND h.score<70)::int attention,
      count(*) FILTER(WHERE h.score<50)::int critical,count(*) FILTER(WHERE h.score IS NULL)::int baseline,
      round(avg(h.score),1)::float8 average_health FROM plants p
      LEFT JOIN LATERAL(SELECT score FROM health_score_snapshots WHERE plant_id=p.id ORDER BY created_at DESC LIMIT 1) h ON true WHERE p.organisation_id=$1 AND p.lifecycle_status='active'`,
        [org],
      ),
      db.query(
        `SELECT a.*,p.name plant_name,p.code plant_code,l.name location_name FROM alerts a JOIN plants p ON p.id=a.plant_id AND p.organisation_id=a.organisation_id LEFT JOIN locations l ON l.id=p.location_id WHERE a.organisation_id=$1 ORDER BY CASE WHEN a.status='resolved' THEN 1 ELSE 0 END,a.created_at DESC LIMIT 200`,
        [org],
      ),
      db.query(
        `SELECT c.id,c.type,c.occurred_at,p.name plant_name,p.code plant_code,l.name location_name,c.note FROM care_events c JOIN plants p ON p.id=c.plant_id AND p.organisation_id=c.organisation_id LEFT JOIN locations l ON l.id=p.location_id WHERE c.organisation_id=$1 ORDER BY c.occurred_at DESC LIMIT 12`,
        [org],
      ),
    ]);
  return {
    contractVersion: 'operations/1.1',
    serverTime: new Date().toISOString(),
    workspace,
    actor,
    plants,
    tasks,
    sessions: maintenance,
    locations: await locationOperations(actor, org),
    species: structure.species,
    team: members,
    metrics: metrics.rows[0],
    alerts: alerts.rows,
    recent: recent.rows,
  };
}
