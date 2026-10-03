import { database } from '@/server/db';
import { authorize } from '@/server/security';
import type { Actor } from '@/domain/types';
import { plantSelect } from '@/domain/plants/service';

export async function analytics(actor: Actor, org: string) {
  const workspace = await authorize(actor, org);
  const db = await database();
  const [summary, trend, breakdown, activity] = await Promise.all([
    db.query<{
      total: number;
      healthy: number;
      watch: number;
      attention: number;
      critical: number;
      baseline: number;
      average: number | null;
      overdue: number;
      serviced: number;
      unresolved: number;
    }>(
      `SELECT count(*)::int total,count(*) FILTER(WHERE h.score>=80)::int healthy,count(*) FILTER(WHERE h.score>=70 AND h.score<80)::int watch,count(*) FILTER(WHERE h.score>=50 AND h.score<70)::int attention,count(*) FILTER(WHERE h.score<50)::int critical,count(*) FILTER(WHERE h.score IS NULL)::int baseline,round(avg(h.score))::int average,count(*) FILTER(WHERE coalesce(c.last_watered,p.created_at)<now()-s.watering_days*interval '1 day')::int overdue,count(*) FILTER(WHERE c.last_serviced>now()-interval '1 day')::int serviced,(SELECT count(*)::int FROM alerts WHERE organisation_id=$1 AND status<>'resolved') unresolved FROM (${plantSelect} WHERE p.organisation_id=$1) p LEFT JOIN LATERAL(SELECT p.score) h ON true LEFT JOIN LATERAL(SELECT p.last_watered,p.last_serviced) c ON true JOIN plant_species s ON s.id=p.species_id`,
      [org],
    ),
    db.query<{ week: string; score: number }>(
      `SELECT w.week AT TIME ZONE $2 week,round(avg(h.score))::int score,count(h.score)::int observed_plants FROM generate_series(date_trunc('week',now() AT TIME ZONE $2)-interval '8 weeks',date_trunc('week',now() AT TIME ZONE $2),interval '1 week') w(week) JOIN plants p ON p.organisation_id=$1 AND p.created_at<(w.week+interval '1 week') AT TIME ZONE $2 LEFT JOIN LATERAL(SELECT score FROM health_score_snapshots WHERE plant_id=p.id AND organisation_id=$1 AND created_at<LEAST(now(),(w.week+interval '1 week') AT TIME ZONE $2) ORDER BY created_at DESC LIMIT 1) h ON true GROUP BY w.week HAVING count(h.score)>0 ORDER BY w.week`,
      [org, workspace.timezone],
    ),
    db.query(
      'SELECT l.id,l.name,l.parent_id,count(p.id)::int plants FROM locations l LEFT JOIN plants p ON p.location_id=l.id WHERE l.organisation_id=$1 GROUP BY l.id ORDER BY l.name',
      [org],
    ),
    db.query<{ watered: number; observations: number }>(
      "SELECT (SELECT count(*)::int FROM care_events WHERE organisation_id=$1 AND type='watered' AND occurred_at>(date_trunc('day',now() AT TIME ZONE $2) AT TIME ZONE $2)) watered,(SELECT count(*)::int FROM plant_photos WHERE organisation_id=$1 AND captured_at>(date_trunc('day',now() AT TIME ZONE $2) AT TIME ZONE $2)) observations",
      [org, workspace.timezone],
    ),
  ]);
  return {
    summary: summary.rows[0],
    trend: trend.rows,
    locations: breakdown.rows,
    activity: activity.rows[0],
  };
}
