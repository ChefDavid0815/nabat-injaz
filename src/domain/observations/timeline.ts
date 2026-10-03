import { z } from 'zod';
import { database } from '@/server/db';
import { AppError } from '@/server/security';
import { mediaUrl } from '@/server/media';
import { getPlant } from '@/domain/plants/service';
import type { Actor, Plant, TimelineItem } from '@/domain/types';
export async function plantTimeline(plant: Plant, cursor?: string) {
  let before: { at: string; id: string } | null = null;
  if (cursor) {
    if (cursor.length > 256) throw new AppError(400, 'Timeline cursor is invalid.');
    try {
      before = z
        .object({ at: z.iso.datetime(), id: z.uuid() })
        .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch {
      throw new AppError(400, 'Timeline cursor is invalid.');
    }
  }
  const values: unknown[] = [plant.id, plant.organisation_id];
  if (before) values.push(before.at, before.id);
  const rows = (
    await (
      await database()
    ).query<TimelineItem & { photo_source: string | null }>(
      `WITH events AS (
    SELECT c.id,c.type,c.occurred_at at,concat_ws(' · ',CASE WHEN c.amount_ml IS NOT NULL THEN c.amount_ml::text || ' ml' END,nullif(c.note,'')) note,coalesce(u.name,'Previous caretaker') actor,null::text photo_source,null::text status,null::jsonb features
    FROM care_events c LEFT JOIN organisation_memberships m ON m.user_id=c.actor_id AND m.organisation_id=c.organisation_id LEFT JOIN users u ON u.id=m.user_id WHERE c.plant_id=$1 AND c.organisation_id=$2
    UNION ALL SELECT ph.id,'observation',ph.captured_at,ph.note,null,ph.source,coalesce(j.status,'completed'),a.features FROM plant_photos ph LEFT JOIN analysis_jobs j ON j.photo_id=ph.id LEFT JOIN visual_analyses a ON a.photo_id=ph.id WHERE ph.plant_id=$1 AND ph.organisation_id=$2
    UNION ALL SELECT id,'created',created_at,'An identity begins.',null,null,null,null FROM plants WHERE id=$1 AND organisation_id=$2
  ) SELECT * FROM events ${before ? 'WHERE (at,id)<($3::timestamptz,$4::uuid)' : ''} ORDER BY at DESC,id DESC LIMIT 51`,
      values,
    )
  ).rows;
  const selected = rows.slice(0, 50),
    last = selected.at(-1);
  const items: TimelineItem[] = await Promise.all(
    selected.map(async (row) => {
      const { photo_source, ...event } = row;
      return {
        ...event,
        at: new Date(event.at).toISOString(),
        image:
          event.type === 'observation'
            ? photo_source === 'fixture'
              ? plant.demo_image || undefined
              : await mediaUrl(event.id, true, plant.organisation_id)
            : undefined,
        features: event.features || undefined,
      };
    }),
  );
  return {
    items,
    nextCursor:
      rows.length > 50 && last
        ? Buffer.from(
            JSON.stringify({ at: new Date(last.at).toISOString(), id: last.id }),
          ).toString('base64url')
        : null,
  };
}
export async function timeline(actor: Actor, plantId: string, cursor?: string) {
  return plantTimeline(await getPlant(actor, plantId), cursor);
}
