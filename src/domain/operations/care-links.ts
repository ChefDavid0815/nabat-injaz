import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@/server/db';
import type { Actor } from '@/domain/types';
export async function attachFieldFact(
  tx: SqlClient,
  actor: Actor,
  org: string,
  plantId: string,
  id: string,
  type: string,
  at: Date,
  note = '',
  explicitSession?: string,
) {
  if (!['watered', 'fertilised', 'inspected', 'repotted', 'moved', 'observation'].includes(type))
    return null;
  const exists = (
    await tx.query<{ present: boolean }>(
      "SELECT to_regclass('location_floor_plans') IS NOT NULL present",
    )
  ).rows[0].present;
  if (!exists) return null;
  const session = (
    await tx.query<{ id: string }>(
      "SELECT s.id FROM maintenance_sessions s JOIN maintenance_session_plants p ON p.session_id=s.id AND p.plant_id=$3 WHERE s.organisation_id=$1 AND s.owner_id=$2 AND s.status='active' AND s.started_at<=$4::timestamptz+interval '5 minutes' AND ($5::uuid IS NULL OR s.id=$5) ORDER BY s.started_at DESC LIMIT 1 FOR UPDATE OF s",
      [org, actor.id, plantId, at, explicitSession || null],
    )
  ).rows[0];
  if (session) {
    await tx.query(
      'INSERT INTO maintenance_session_events(id,session_id,plant_id,care_event_id,observation_id,type,actor_id,occurred_at,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
      [
        randomUUID(),
        session.id,
        plantId,
        type === 'observation' ? null : id,
        type === 'observation' ? id : null,
        type,
        actor.id,
        at,
        note,
      ],
    );
    await tx.query(
      'UPDATE maintenance_session_plants SET visited_at=coalesce(visited_at,$3) WHERE session_id=$1 AND plant_id=$2',
      [session.id, plantId, at],
    );
  }
  await tx.query(
    "UPDATE operations_tasks SET status='completed',completed_at=$5,completed_by=$2,care_event_id=CASE WHEN $6='observation' THEN NULL ELSE $4::uuid END,revision=revision+1,updated_at=now() WHERE organisation_id=$1 AND plant_id=$3 AND kind=$6 AND status IN ('pending','in_progress') AND due_at<=$5::timestamptz AND (assignee_id IS NULL OR assignee_id=$2)",
    [org, actor.id, plantId, type === 'observation' ? null : id, at, type],
  );
  return session?.id || null;
}
