import { randomUUID } from 'node:crypto';
import { database, type SqlClient } from '@/server/db';
import { AppError, digest } from '@/server/security';
import type { Actor } from '@/domain/types';
import { audit } from '@/domain/audit/service';
import { scorePlant } from '@/server/analysis';
import { requireCapability, type Capability } from './authorization';
import {
  careInput,
  startSessionInput,
  sessionActionInput,
  taskInput,
  taskActionInput,
  bulkInput,
  alertInput,
} from './contracts';
import { alertTransitions } from './priority';
import { attachFieldFact } from './care-links';

export async function mutate<T>(
  actor: Actor,
  org: string,
  capability: Capability,
  key: string,
  input: unknown,
  action: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  return (await database()).transaction(async (tx) => {
    await requireCapability(actor, org, capability, tx);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${org}:${actor.id}:${key}`]);
    const fingerprint = digest(JSON.stringify(input));
    const old = (
      await tx.query<{ fingerprint: string; result: T }>(
        'SELECT fingerprint,result FROM operations_mutations WHERE organisation_id=$1 AND actor_id=$2 AND idempotency_key=$3',
        [org, actor.id, key],
      )
    ).rows[0];
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new AppError(409, 'This request key already represents a different operation.');
      return old.result;
    }
    const result = await action(tx);
    await tx.query(
      'INSERT INTO operations_mutations(organisation_id,actor_id,idempotency_key,fingerprint,result) VALUES($1,$2,$3,$4,$5)',
      [org, actor.id, key, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
async function member(tx: SqlClient, org: string, userId: string | null | undefined) {
  if (
    userId &&
    !(
      await tx.query(
        "SELECT id FROM organisation_memberships WHERE organisation_id=$1 AND user_id=$2 AND role<>'viewer'",
        [org, userId],
      )
    ).rows.length
  )
    throw new AppError(400, 'Choose a workspace member with care permissions.');
}
export async function reconcileQueue(actor: Actor, org: string) {
  await requireCapability(actor, org, 'operations.read');
  return (await database()).transaction(async (tx) => {
    await tx.query(
      `INSERT INTO operations_tasks(id,organisation_id,plant_id,kind,title,source,source_key,due_at,assignee_id)
      SELECT gen_random_uuid(),p.organisation_id,p.id,'watered','Check soil moisture before watering','overdue',
      'water:'||p.id||':'||coalesce(c.at,p.created_at)::text,coalesce(c.at,p.created_at)+s.watering_days*interval '1 day',pa.user_id
      FROM plants p JOIN plant_species s ON s.id=p.species_id LEFT JOIN LATERAL(SELECT max(occurred_at) at FROM care_events WHERE plant_id=p.id AND type='watered') c ON true LEFT JOIN plant_assignments pa ON pa.plant_id=p.id AND pa.ended_at IS NULL
      WHERE p.organisation_id=$1 AND p.lifecycle_status='active' AND coalesce(c.at,p.created_at)+s.watering_days*interval '1 day'<=now() ON CONFLICT(organisation_id,source_key) DO NOTHING`,
      [org],
    );
    await tx.query(
      `INSERT INTO operations_tasks(id,organisation_id,plant_id,kind,title,source,source_key,due_at,assignee_id)
      SELECT gen_random_uuid(),a.organisation_id,a.plant_id,'inspected',left(a.recommended_action,180),'alert','alert:'||a.id,a.created_at,coalesce(a.assignee_id,pa.user_id)
      FROM alerts a JOIN plants active_plant ON active_plant.id=a.plant_id AND active_plant.lifecycle_status='active' LEFT JOIN plant_assignments pa ON pa.plant_id=a.plant_id AND pa.ended_at IS NULL WHERE a.organisation_id=$1 AND a.status<>'resolved' ON CONFLICT(organisation_id,source_key) DO NOTHING`,
      [org],
    );
    await tx.query(
      `UPDATE operations_tasks t SET status='completed',completed_at=c.occurred_at,completed_by=c.actor_id,care_event_id=c.id,revision=t.revision+1,updated_at=now()
      FROM care_events c WHERE t.organisation_id=$1 AND t.source='overdue' AND t.status IN ('pending','in_progress') AND c.organisation_id=t.organisation_id AND c.plant_id=t.plant_id AND c.type='watered' AND c.occurred_at>=t.due_at`,
      [org],
    );
    await tx.query(
      `UPDATE operations_tasks t SET status='cancelled',revision=revision+1,updated_at=now() WHERE t.organisation_id=$1 AND t.source='alert' AND t.status IN ('pending','in_progress') AND EXISTS(SELECT 1 FROM alerts a WHERE 'alert:'||a.id=t.source_key AND a.status='resolved')`,
      [org],
    );
    return { reconciled: true };
  });
}

export async function logOperationsCare(actor: Actor, org: string, raw: unknown) {
  const data = careInput.parse(raw);
  if (data.expectedActorId && data.expectedActorId !== actor.id)
    throw new AppError(403, 'Sign in as the account that recorded this offline care.');
  const at = data.occurredAt ? new Date(data.occurredAt) : new Date();
  return mutate(
    actor,
    org,
    'care.write',
    data.idempotencyKey,
    { action: 'care', ...data },
    async (tx) => {
      if (at.getTime() > Date.now() + 5 * 60000 || at.getTime() < Date.now() - 30 * 86400000)
        throw new AppError(400, 'Care time must be within the last 30 days.');
      if (
        !(
          await tx.query(
            "SELECT id FROM plants WHERE id=$1 AND organisation_id=$2 AND lifecycle_status='active' FOR UPDATE",
            [data.plantId, org],
          )
        ).rows.length
      )
        throw new AppError(404, 'Plant not found in this workspace.');
      const old = (
        await tx.query<{
          id: string;
          plant_id: string;
          actor_id: string;
          type: string;
          note: string;
        }>('SELECT * FROM care_events WHERE idempotency_key=$1', [data.idempotencyKey])
      ).rows[0];
      if (
        old &&
        (old.plant_id !== data.plantId ||
          old.actor_id !== actor.id ||
          old.type !== data.type ||
          old.note !== data.note)
      )
        throw new AppError(409, 'This care request key is already in use.');
      if (data.sessionId) {
        const s = (
          await tx.query<{ owner_id: string; status: string }>(
            'SELECT * FROM maintenance_sessions WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
            [data.sessionId, org],
          )
        ).rows[0];
        if (!s || s.status !== 'active' || s.owner_id !== actor.id)
          throw new AppError(409, 'Use your own active maintenance session.');
        if (
          !(
            await tx.query(
              'SELECT plant_id FROM maintenance_session_plants WHERE session_id=$1 AND plant_id=$2',
              [data.sessionId, data.plantId],
            )
          ).rows.length
        )
          throw new AppError(400, 'This plant is outside the maintenance session.');
      }
      const id = old?.id || randomUUID();
      if (!old) {
        await tx.query(
          'INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,note,amount_ml,idempotency_key,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            id,
            org,
            data.plantId,
            actor.id,
            data.type,
            data.note,
            data.amountMl ?? null,
            data.idempotencyKey,
            at,
          ],
        );
        if (data.type === 'watered') {
          const resolved = (
            await tx.query<{ id: string }>(
              "UPDATE alerts SET status='resolved',updated_at=now() WHERE plant_id=$1 AND organisation_id=$2 AND rule='care-overdue' AND status<>'resolved' RETURNING id",
              [data.plantId, org],
            )
          ).rows;
          for (const alert of resolved)
            await tx.query(
              "INSERT INTO alert_status_events(id,alert_id,actor_id,status) VALUES($1,$2,$3,'resolved')",
              [randomUUID(), alert.id, actor.id],
            );
        }
        const latest = (
          await tx.query<{ id: string }>(
            'SELECT a.id FROM visual_analyses a JOIN plant_photos p ON p.id=a.photo_id WHERE a.plant_id=$1 AND a.organisation_id=$2 ORDER BY p.captured_at DESC,a.created_at DESC LIMIT 1',
            [data.plantId, org],
          )
        ).rows[0];
        if (latest) await scorePlant(tx, data.plantId, latest.id);
        await audit(tx, org, actor.id, `care.${data.type}`, id, {
          plantId: data.plantId,
          client: 'operations',
          occurredAt: at.toISOString(),
        });
      }
      if (data.taskId) {
        const task = (
          await tx.query<{
            plant_id: string;
            kind: string;
            status: string;
            assignee_id: string | null;
          }>('SELECT * FROM operations_tasks WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [
            data.taskId,
            org,
          ])
        ).rows[0];
        if (
          !task ||
          task.plant_id !== data.plantId ||
          task.kind !== data.type ||
          !['pending', 'in_progress', 'completed'].includes(task.status)
        )
          throw new AppError(409, 'Care does not match this active task.');
        const workspace = await requireCapability(actor, org, 'care.write', tx);
        if (workspace.role === 'caretaker' && task.assignee_id && task.assignee_id !== actor.id)
          throw new AppError(403, 'This task belongs to another caretaker.');
        if (task.status !== 'completed')
          await tx.query(
            "UPDATE operations_tasks SET status='completed',completed_at=$3,completed_by=$4,care_event_id=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND organisation_id=$2",
            [data.taskId, org, at, actor.id, id],
          );
      }
      if (data.sessionId) {
        await tx.query(
          'INSERT INTO maintenance_session_events(id,session_id,plant_id,care_event_id,type,actor_id,occurred_at,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(care_event_id) DO NOTHING',
          [randomUUID(), data.sessionId, data.plantId, id, data.type, actor.id, at, data.note],
        );
        await tx.query(
          'UPDATE maintenance_session_plants SET visited_at=coalesce(visited_at,$3) WHERE session_id=$1 AND plant_id=$2',
          [data.sessionId, data.plantId, at],
        );
      }
      await attachFieldFact(
        tx,
        actor,
        org,
        data.plantId,
        id,
        data.type,
        at,
        data.note,
        data.sessionId,
      );
      return { id, plantId: data.plantId, occurredAt: at.toISOString() };
    },
  );
}

export async function startSession(actor: Actor, org: string, raw: unknown) {
  const data = startSessionInput.parse(raw);
  return mutate(
    actor,
    org,
    'session.write',
    data.idempotencyKey,
    { action: 'session.start', ...data },
    async (tx) => {
      const ownerId = data.ownerId || actor.id;
      if (ownerId !== actor.id) await requireCapability(actor, org, 'task.manage', tx);
      await member(tx, org, ownerId);
      if (
        data.locationId &&
        !(
          await tx.query('SELECT id FROM locations WHERE id=$1 AND organisation_id=$2', [
            data.locationId,
            org,
          ])
        ).rows.length
      )
        throw new AppError(400, 'Choose a workspace location.');
      const selected = (
        await tx.query<{ id: string; name: string; code: string }>(
          'SELECT id,name,code FROM plants WHERE organisation_id=$1 AND ($2::uuid IS NULL OR location_id=$2) AND ($3::uuid[] IS NULL OR id=ANY($3)) ORDER BY id LIMIT 201 FOR SHARE',
          [org, data.locationId || null, data.plantIds || null],
        )
      ).rows;
      if (
        !selected.length ||
        selected.length > 200 ||
        (data.plantIds && selected.length !== data.plantIds.length)
      )
        throw new AppError(400, 'Choose 1–200 plants within the selected workspace and location.');
      const id = randomUUID();
      await tx.query(
        'INSERT INTO maintenance_sessions(id,organisation_id,location_id,owner_id) VALUES($1,$2,$3,$4)',
        [id, org, data.locationId || null, ownerId],
      );
      for (const p of selected)
        await tx.query(
          'INSERT INTO maintenance_session_plants(session_id,plant_id,plant_name,plant_code) VALUES($1,$2,$3,$4)',
          [id, p.id, p.name, p.code],
        );
      await audit(tx, org, actor.id, 'maintenance.started', id, {
        plants: selected.length,
        locationId: data.locationId,
      });
      return { id, revision: 0, plants: selected.map((p) => p.id) };
    },
  );
}

export async function finishSession(actor: Actor, org: string, id: string, raw: unknown) {
  const data = sessionActionInput.parse(raw);
  return mutate(
    actor,
    org,
    'session.write',
    data.idempotencyKey,
    { operation: 'session.finish', id, ...data },
    async (tx) => {
      const s = (
        await tx.query<{ owner_id: string; status: string; revision: number; started_at: Date }>(
          'SELECT * FROM maintenance_sessions WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
          [id, org],
        )
      ).rows[0];
      if (!s || s.owner_id !== actor.id)
        throw new AppError(403, 'Only the session owner can finish this session.');
      if (s.status !== 'active' || s.revision !== data.revision)
        throw new AppError(409, 'The session changed. Refresh before continuing.');
      const summary = (
        await tx.query(
          `SELECT count(DISTINCT plant_id)::int plants_visited,count(*) FILTER(WHERE type='watered')::int watered,count(*) FILTER(WHERE type='fertilised')::int fertilised,count(*) FILTER(WHERE type='inspected')::int inspected,count(*) FILTER(WHERE type='issue')::int issues,count(*) FILTER(WHERE type='observation')::int observations FROM maintenance_session_events WHERE session_id=$1`,
          [id],
        )
      ).rows[0];
      summary.duration_minutes = Math.max(
        0,
        Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000),
      );
      const status = data.action === 'complete' ? 'completed' : 'cancelled';
      await tx.query(
        'UPDATE maintenance_sessions SET status=$3,ended_at=now(),summary=$4,revision=revision+1 WHERE id=$1 AND organisation_id=$2',
        [id, org, status, JSON.stringify(summary)],
      );
      await audit(tx, org, actor.id, `maintenance.${status}`, id, summary);
      return { id, status, summary, revision: s.revision + 1 };
    },
  );
}

export async function createTask(actor: Actor, org: string, raw: unknown) {
  const data = taskInput.parse(raw);
  return mutate(
    actor,
    org,
    'task.manage',
    data.idempotencyKey,
    { action: 'task.create', ...data },
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
      await member(tx, org, data.assigneeId);
      const id = randomUUID();
      await tx.query(
        "INSERT INTO operations_tasks(id,organisation_id,plant_id,kind,title,source,source_key,due_at,assignee_id,created_by) VALUES($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9)",
        [
          id,
          org,
          data.plantId,
          data.kind,
          data.title,
          `manual:${id}`,
          data.dueAt,
          data.assigneeId || null,
          actor.id,
        ],
      );
      await audit(tx, org, actor.id, 'task.created', id, { plantId: data.plantId });
      return { id, revision: 0 };
    },
  );
}

export async function updateTask(actor: Actor, org: string, id: string, raw: unknown) {
  const data = taskActionInput.parse(raw);
  return mutate(
    actor,
    org,
    'care.write',
    data.idempotencyKey,
    { action: 'task.update', id, ...data },
    async (tx) => {
      const task = (
        await tx.query<{
          revision: number;
          status: string;
          kind: string;
          plant_id: string;
          assignee_id: string | null;
          created_at: Date;
        }>('SELECT * FROM operations_tasks WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [
          id,
          org,
        ])
      ).rows[0];
      if (!task) throw new AppError(404, 'Task not found.');
      if (task.revision !== data.revision || ['completed', 'cancelled'].includes(task.status))
        throw new AppError(409, 'The task changed. Refresh before continuing.');
      const workspace = await requireCapability(actor, org, 'care.write', tx);
      if (data.assigneeId !== undefined || data.status === 'cancelled')
        await requireCapability(actor, org, 'task.manage', tx);
      if (workspace.role === 'caretaker' && task.assignee_id && task.assignee_id !== actor.id)
        throw new AppError(403, 'This task belongs to another caretaker.');
      await member(tx, org, data.assigneeId);
      if (
        data.status === 'completed' &&
        ['watered', 'fertilised', 'inspected', 'repotted'].includes(task.kind)
      ) {
        if (
          !data.careEventId ||
          !(
            await tx.query(
              'SELECT id FROM care_events WHERE id=$1 AND organisation_id=$2 AND plant_id=$3 AND type=$4 AND occurred_at>=$5',
              [data.careEventId, org, task.plant_id, task.kind, task.created_at],
            )
          ).rows.length
        )
          throw new AppError(400, 'Log matching care before completing this task.');
      }
      if (
        data.status === 'completed' &&
        task.kind === 'observation' &&
        !(
          await tx.query(
            'SELECT id FROM observations WHERE organisation_id=$1 AND plant_id=$2 AND captured_at>=$3',
            [org, task.plant_id, task.created_at],
          )
        ).rows.length
      )
        throw new AppError(400, 'Save a new observation before completing this task.');
      await tx.query(
        `UPDATE operations_tasks SET status=$3,revision=revision+1,updated_at=now(),assignee_id=CASE WHEN $4 THEN $5 ELSE assignee_id END,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END,completed_by=CASE WHEN $3='completed' THEN $6 ELSE NULL END,care_event_id=$7 WHERE id=$1 AND organisation_id=$2`,
        [
          id,
          org,
          data.status,
          data.assigneeId !== undefined,
          data.assigneeId || null,
          actor.id,
          data.careEventId || null,
        ],
      );
      await audit(tx, org, actor.id, 'task.updated', id, { status: data.status });
      return { id, revision: task.revision + 1, status: data.status };
    },
  );
}

export async function bulkChange(actor: Actor, org: string, raw: unknown) {
  const data = bulkInput.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'bulk', ...data },
    async (tx) => {
      if (data.action === 'assign') await member(tx, org, data.targetId);
      else if (
        !(
          await tx.query('SELECT id FROM locations WHERE id=$1 AND organisation_id=$2', [
            data.targetId,
            org,
          ])
        ).rows.length
      )
        throw new AppError(400, 'Choose a workspace location.');
      // Stable lock order avoids deadlocks across overlapping batches.
      for (const plant of [...data.plants].sort((a, b) => a.id.localeCompare(b.id))) {
        const p = (
          await tx.query<{ operations_revision: string }>(
            'SELECT operations_revision FROM plants WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
            [plant.id, org],
          )
        ).rows[0];
        if (!p) throw new AppError(404, 'A selected plant is outside this workspace.');
        if (Number(p.operations_revision) !== plant.revision)
          throw new AppError(
            409,
            'A selected plant changed. Refresh the batch before applying it.',
          );
        if (data.action === 'assign') {
          await tx.query(
            'UPDATE plant_assignments SET ended_at=now() WHERE plant_id=$1 AND ended_at IS NULL',
            [plant.id],
          );
          await tx.query(
            'INSERT INTO plant_assignments(id,organisation_id,plant_id,user_id,assigned_by) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), org, plant.id, data.targetId, actor.id],
          );
        } else
          await tx.query('UPDATE plants SET location_id=$3 WHERE id=$1 AND organisation_id=$2', [
            plant.id,
            org,
            data.targetId,
          ]);
        await tx.query(
          'INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,note,location_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            randomUUID(),
            org,
            plant.id,
            actor.id,
            data.action === 'assign' ? 'assigned' : 'moved',
            `Bulk ${data.action} · target ${data.targetId}`,
            data.action === 'move' ? data.targetId : null,
            randomUUID(),
          ],
        );
      }
      await audit(tx, org, actor.id, `fleet.bulk-${data.action}`, data.plants[0].id, {
        plantIds: data.plants.map((p) => p.id),
        targetId: data.targetId,
      });
      return { changed: data.plants.length };
    },
  );
}

export async function transitionAlert(actor: Actor, org: string, id: string, raw: unknown) {
  const data = alertInput.parse(raw);
  return mutate(
    actor,
    org,
    'alert.write',
    data.idempotencyKey,
    { action: 'alert', id, ...data },
    async (tx) => {
      const alert = (
        await tx.query<{ status: string; revision: number; assignee_id: string | null }>(
          'SELECT * FROM alerts WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
          [id, org],
        )
      ).rows[0];
      if (!alert) throw new AppError(404, 'Alert not found.');
      if (
        alert.revision !== data.revision ||
        !alertTransitions[alert.status]?.includes(data.status)
      )
        throw new AppError(409, 'The alert changed or this transition is unavailable.');
      if (data.status === 'assigned' || data.assigneeId !== undefined)
        await requireCapability(actor, org, 'task.manage', tx);
      if (data.status === 'assigned' && !(data.assigneeId || alert.assignee_id))
        throw new AppError(400, 'Choose an assignee.');
      if (data.status === 'resolved' && !data.resolutionNote)
        throw new AppError(400, 'Describe how this alert was resolved.');
      await member(tx, org, data.assigneeId);
      await tx.query(
        'UPDATE alerts SET status=$3,assignee_id=CASE WHEN $4 THEN $5 ELSE assignee_id END,resolution_note=$6,updated_at=now() WHERE id=$1 AND organisation_id=$2',
        [
          id,
          org,
          data.status,
          data.assigneeId !== undefined,
          data.assigneeId || null,
          data.resolutionNote,
        ],
      );
      await tx.query(
        'INSERT INTO alert_status_events(id,alert_id,actor_id,status) VALUES($1,$2,$3,$4)',
        [randomUUID(), id, actor.id, data.status],
      );
      await audit(tx, org, actor.id, `alert.${data.status}`, id, {
        resolutionNote: data.resolutionNote,
      });
      return { id, revision: alert.revision + 1, status: data.status };
    },
  );
}
