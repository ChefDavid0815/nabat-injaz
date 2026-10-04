import { z } from 'zod';
import type { Actor } from '@/domain/types';
import { database } from '@/server/db';
import { getPlant } from '@/domain/plants/service';
import { requireCapability } from './authorization';
import { mediaUrl } from '@/server/media';
import { AppError } from '@/server/security';

export async function scoreExplanation(actor: Actor, org: string, plantId: string) {
  const plant = await getPlant(actor, plantId);
  if (plant.organisation_id !== org) throw new AppError(403, 'Plant belongs to another workspace.');
  const rows = (
    await (
      await database()
    ).query<{
      id: string;
      score: number;
      confidence: string | number;
      composition: Record<string, number>;
      engine_version: string;
      reasons: unknown;
      created_at: Date;
    }>(
      'SELECT * FROM health_score_snapshots WHERE plant_id=$1 AND organisation_id=$2 ORDER BY created_at DESC LIMIT 2',
      [plantId, org],
    )
  ).rows;
  if (!rows.length)
    return { current: null, changes: [], boundary: 'A visual baseline has not been established.' };
  const [current, previous] = rows;
  const comparable = previous?.engine_version === current.engine_version;
  const labels: Record<string, string> = {
    visual: 'Visual condition',
    trajectory: 'Visual trajectory',
    growth: 'Growth signals',
    care: 'Care consistency',
    stress: 'Stress indicators',
    confidence: 'Observation confidence',
    base: 'Score baseline',
    watering: 'Watering consistency',
    fertilising: 'Recent fertilising',
    relocation: 'Recent movement',
    browningTrajectory: 'Browning trajectory',
    leafLossTrajectory: 'Leaf-loss trajectory',
    canopyTrajectory: 'Canopy proxy trajectory',
    visual_condition: 'Visual condition',
  };
  const components = Object.entries(current.composition)
    .filter(([, v]) => typeof v === 'number')
    .map(([key, value]) => ({
      key,
      label: labels[key] || key.replaceAll('_', ' '),
      value,
      change:
        comparable && typeof previous.composition[key] === 'number'
          ? value - previous.composition[key]
          : null,
    }));
  return {
    current: { ...current, confidence: Number(current.confidence) },
    components,
    changes: components.filter((c) => c.change !== null && Math.abs(c.change) > 0.01),
    boundary: comparable
      ? null
      : 'A new engine or baseline boundary prevents a numerical component comparison.',
    reasons: current.reasons,
  };
}
export async function compareObservations(
  actor: Actor,
  org: string,
  plantId: string,
  beforeId: string,
  afterId: string,
) {
  const plant = await getPlant(actor, plantId);
  if (plant.organisation_id !== org) throw new AppError(403, 'Plant belongs to another workspace.');
  z.uuid().parse(beforeId);
  z.uuid().parse(afterId);
  const rows = (
    await (
      await database()
    ).query<{
      id: string;
      source: string;
      captured_at: Date;
      note: string;
      original_metadata: Record<string, unknown>;
      width: number;
      height: number;
      features: Record<string, unknown> | null;
      provider: string | null;
      model: string | null;
      contract_version: string | null;
      score: number | null;
    }>(
      'SELECT p.id,p.source,p.captured_at,p.note,p.original_metadata,p.width,p.height,a.features,a.provider,a.model,a.contract_version,h.score FROM plant_photos p LEFT JOIN visual_analyses a ON a.photo_id=p.id LEFT JOIN LATERAL(SELECT score FROM health_score_snapshots WHERE analysis_id=a.id ORDER BY created_at LIMIT 1) h ON true WHERE p.plant_id=$1 AND p.organisation_id=$2 AND p.id=ANY($3::uuid[])',
      [plantId, org, [beforeId, afterId]],
    )
  ).rows;
  if (!rows.some((p) => p.id === beforeId) || !rows.some((p) => p.id === afterId))
    throw new AppError(404, 'Choose two observations from this plant.');
  const present = async (id: string) => {
    const row = rows.find((p) => p.id === id)!;
    return {
      ...row,
      image: row.source === 'fixture' ? plant.demo_image : await mediaUrl(row.id, false, org),
    };
  };
  const before = await present(beforeId),
    after = await present(afterId);
  const sameProvider =
    before.provider === after.provider &&
    before.model === after.model &&
    before.contract_version === after.contract_version;
  const matched = !!before.original_metadata.matchedView && !!after.original_metadata.matchedView;
  const comparable =
    !!before.features &&
    !!after.features &&
    sameProvider &&
    matched &&
    before.features.comparable === true &&
    after.features.comparable === true;
  return {
    before,
    after,
    comparable,
    reason:
      !before.features || !after.features
        ? 'Analysis is not available for both observations.'
        : !sameProvider
          ? 'Provider versions differ.'
          : !matched
            ? 'Lighting or viewpoint was not marked as comparable.'
            : !comparable
              ? 'The provider did not establish comparability.'
              : null,
  };
}
const analyticsInput = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  location: z.uuid().optional(),
  species: z.uuid().optional(),
});
export async function operationsAnalytics(actor: Actor, org: string, raw: unknown = {}) {
  const workspace = await requireCapability(actor, org, 'operations.read'),
    input = analyticsInput.parse(raw),
    db = await database();
  const values = [org, input.days, input.location || null, input.species || null];
  const scope =
    'p.organisation_id=$1 AND $2::integer BETWEEN 1 AND 365 AND ($3::uuid IS NULL OR p.location_id=$3) AND ($4::uuid IS NULL OR p.species_id=$4)';
  const latest =
    'SELECT p.id,p.name,p.code,p.location_id,p.species_id,s.common_name species_name,l.name location_name,h.score,h.delta FROM plants p JOIN plant_species s ON s.id=p.species_id LEFT JOIN locations l ON l.id=p.location_id LEFT JOIN LATERAL(SELECT score,delta FROM health_score_snapshots WHERE plant_id=p.id ORDER BY created_at DESC LIMIT 1) h ON true WHERE ' +
    scope +
    " AND p.lifecycle_status='active'";
  const [overview, care, risk, locations, species, sessions, trend] = await Promise.all([
    db.query(
      'SELECT count(*)::int total,count(score)::int observed,round(avg(score),1)::float8 average_health,count(*) FILTER(WHERE score<50)::int critical,count(*) FILTER(WHERE delta<=-8)::int rapid_decline FROM(' +
        latest +
        ') f',
      values,
    ),
    db.query(
      "SELECT c.type,count(*)::int actions,l.id location_id,l.name location_name,m.user_id actor_id,coalesce(u.name,'Previous caretaker') actor_name FROM care_events c JOIN plants p ON p.id=c.plant_id AND p.organisation_id=c.organisation_id LEFT JOIN locations l ON l.id=p.location_id LEFT JOIN organisation_memberships m ON m.user_id=c.actor_id AND m.organisation_id=c.organisation_id LEFT JOIN users u ON u.id=m.user_id WHERE " +
        scope +
        " AND c.occurred_at>now()-$2*interval '1 day' GROUP BY c.type,l.id,l.name,m.user_id,u.name ORDER BY actions DESC",
      values,
    ),
    db.query(
      'SELECT a.rule,a.severity,count(*)::int alerts FROM alerts a JOIN plants p ON p.id=a.plant_id AND p.organisation_id=a.organisation_id WHERE ' +
        scope +
        " AND a.status<>'resolved' GROUP BY a.rule,a.severity ORDER BY alerts DESC",
      values,
    ),
    db.query(
      'SELECT location_id id,coalesce(location_name,$5) name,count(*)::int plants,round(avg(score),1)::float8 average_health,count(*) FILTER(WHERE score<50)::int critical FROM(' +
        latest +
        ') f GROUP BY location_id,location_name ORDER BY average_health NULLS LAST',
      [...values, 'Unplaced'],
    ),
    db.query(
      'SELECT species_id id,species_name name,count(*)::int plants,round(avg(score),1)::float8 average_health FROM(' +
        latest +
        ') f GROUP BY species_id,species_name ORDER BY average_health NULLS LAST',
      values,
    ),
    db.query(
      "SELECT count(*)::int sessions,count(*) FILTER(WHERE status='completed')::int completed,coalesce(sum((summary->>'plants_visited')::int),0)::int visited,coalesce(sum((summary->>'duration_minutes')::int),0)::int minutes FROM maintenance_sessions WHERE organisation_id=$1 AND started_at>now()-$2*interval '1 day' AND ($3::uuid IS NULL OR location_id=$3)",
      values.slice(0, 3),
    ),
    db.query(
      "SELECT date_trunc('day',h.created_at AT TIME ZONE $5) AS period,round(avg(h.score),1)::float8 score,count(DISTINCT h.plant_id)::int plants FROM(SELECT DISTINCT ON (plant_id,date_trunc('day',created_at AT TIME ZONE $5)) plant_id,score,created_at FROM health_score_snapshots WHERE organisation_id=$1 AND created_at>now()-$2*interval '1 day' ORDER BY plant_id,date_trunc('day',created_at AT TIME ZONE $5),created_at DESC) h JOIN plants p ON p.id=h.plant_id WHERE " +
        scope +
        ' GROUP BY period ORDER BY period',
      [...values, workspace.timezone],
    ),
  ]);
  const tasks = (
    await db.query(
      "SELECT count(*)::int scheduled,count(*) FILTER(WHERE t.status='completed')::int completed FROM operations_tasks t JOIN plants p ON p.id=t.plant_id AND p.organisation_id=t.organisation_id WHERE " +
        scope +
        " AND t.due_at BETWEEN now()-$2*interval '1 day' AND now()",
      values,
    )
  ).rows[0];
  const alerts = (
    await db.query(
      'SELECT round(avg(extract(epoch FROM (a.resolved_at-a.created_at))/3600),2)::float8 resolution_hours FROM alerts a JOIN plants p ON p.id=a.plant_id AND p.organisation_id=a.organisation_id WHERE ' +
        scope +
        " AND a.resolved_at>now()-$2*interval '1 day'",
      values,
    )
  ).rows[0];
  return {
    range: input,
    timezone: workspace.timezone,
    overview: overview.rows[0],
    tasks,
    alertResolutionHours: alerts.resolution_hours,
    care: care.rows,
    risk: risk.rows,
    locations: locations.rows,
    species: species.rows,
    operations: sessions.rows[0],
    trend: trend.rows,
    survivalRate: await lifecycleRate(actor, org, input, 'survival'),
    replacementRate: await lifecycleRate(actor, org, input, 'replacement'),
  };
}
async function lifecycleRate(
  actor: Actor,
  org: string,
  input: z.infer<typeof analyticsInput>,
  kind: string,
) {
  await requireCapability(actor, org, 'operations.read');
  const row = (
    await (
      await database()
    ).query<{ active: number; deaths: number; replacements: number; outcomes: number }>(
      "SELECT (SELECT count(*)::int FROM plants p WHERE p.organisation_id=$1 AND p.lifecycle_status='active' AND ($3::uuid IS NULL OR p.location_id=$3) AND ($4::uuid IS NULL OR p.species_id=$4)) active,count(*) FILTER(WHERE e.outcome='died')::int deaths,count(*) FILTER(WHERE e.kind='replaced')::int replacements,count(*)::int outcomes FROM plant_lifecycle_events e JOIN plants p ON p.id=e.plant_id AND p.organisation_id=e.organisation_id WHERE e.organisation_id=$1 AND e.kind IN ('retired','replaced') AND e.occurred_at>now()-$2*interval '1 day' AND ($3::uuid IS NULL OR p.location_id=$3) AND ($4::uuid IS NULL OR p.species_id=$4)",
      [org, input.days, input.location || null, input.species || null],
    )
  ).rows[0];
  const numerator = kind === 'survival' ? row.active : row.replacements,
    denominator = kind === 'survival' ? row.active + row.deaths : row.active + row.replacements;
  return {
    value: row.outcomes && denominator ? Math.round((numerator / denominator) * 1000) / 10 : null,
    reason: row.outcomes
      ? kind === 'survival'
        ? 'Based on active identities and reported deaths in this range.'
        : 'Based on active identities and reported replacements in this range.'
      : 'No recorded lifecycle outcome cohort is available.',
  };
}
export async function report(actor: Actor, org: string, raw: unknown = {}) {
  const data = await operationsAnalytics(actor, org, raw),
    workspace = await requireCapability(actor, org, 'operations.read');
  const attention = (
    await (
      await database()
    ).query(
      'SELECT p.id,p.name,p.code,l.name location_name,h.score,h.delta FROM plants p LEFT JOIN locations l ON l.id=p.location_id JOIN LATERAL(SELECT score,delta FROM health_score_snapshots WHERE plant_id=p.id ORDER BY created_at DESC LIMIT 1) h ON true WHERE p.organisation_id=$1 AND (h.score<70 OR h.delta<=-8) ORDER BY h.score LIMIT 100',
      [org],
    )
  ).rows;
  return {
    title: data.range.days <= 7 ? 'Weekly plant health report' : 'Operations report',
    organisation: workspace.name,
    generatedAt: new Date().toISOString(),
    data,
    attention,
    definitions: [
      'Health averages use the latest saved score per plant.',
      'Survival and replacement require recorded lifecycle outcomes.',
      'Signal estimates are not calibrated biological measurements.',
    ],
  };
}
