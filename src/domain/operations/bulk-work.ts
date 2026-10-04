import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '@/domain/types';
import { AppError } from '@/server/security';
import { mutate } from './mutations';
import { mutationBase } from './contracts';
import { audit } from '@/domain/audit/service';
import { scorePlant } from '@/server/analysis';
import { attachFieldFact } from './care-links';
const schema = mutationBase
  .extend({
    plants: z
      .array(z.object({ id: z.uuid(), revision: z.number().int().nonnegative() }))
      .min(1)
      .max(100),
    action: z.enum(['schedule', 'inspect', 'labels']),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    assigneeId: z.uuid().optional(),
    labels: z.array(z.string().trim().min(1).max(48)).max(20).optional(),
  })
  .refine(
    (d) => new Set(d.plants.map((p) => p.id)).size === d.plants.length,
    'Select each plant once.',
  );
export async function bulkWork(actor: Actor, org: string, raw: unknown) {
  const data = schema.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'bulk-work', ...data },
    async (tx) => {
      if (data.action === 'schedule' && !data.dueAt)
        throw new AppError(400, 'Choose an inspection date.');
      if (
        data.assigneeId &&
        !(
          await tx.query(
            "SELECT id FROM organisation_memberships WHERE organisation_id=$1 AND user_id=$2 AND role<>'viewer'",
            [org, data.assigneeId],
          )
        ).rows.length
      )
        throw new AppError(400, 'Choose a caretaker in this workspace.');
      for (const plant of [...data.plants].sort((a, b) => a.id.localeCompare(b.id))) {
        const row = (
          await tx.query<{ operations_revision: string }>(
            "SELECT operations_revision FROM plants WHERE id=$1 AND organisation_id=$2 AND lifecycle_status='active' FOR UPDATE",
            [plant.id, org],
          )
        ).rows[0];
        if (!row || Number(row.operations_revision) !== plant.revision)
          throw new AppError(409, 'A selected plant changed. Refresh the whole batch.');
        if (data.action === 'schedule')
          await tx.query(
            "INSERT INTO operations_tasks(id,organisation_id,plant_id,kind,title,source,source_key,due_at,assignee_id,created_by) VALUES($1,$2,$3,'inspected','Scheduled fleet inspection','scheduled',$4,$5,$6,$7)",
            [
              randomUUID(),
              org,
              plant.id,
              'bulk:' + data.idempotencyKey + ':' + plant.id,
              data.dueAt,
              data.assigneeId || null,
              actor.id,
            ],
          );
        if (data.action === 'labels') {
          await tx.query('DELETE FROM plant_labels WHERE plant_id=$1 AND organisation_id=$2', [
            plant.id,
            org,
          ]);
          for (const label of new Set(data.labels || []))
            await tx.query(
              'INSERT INTO plant_labels(plant_id,organisation_id,label) VALUES($1,$2,$3)',
              [plant.id, org, label],
            );
          await tx.query(
            'UPDATE plants SET operations_revision=operations_revision+1 WHERE id=$1',
            [plant.id],
          );
        }
        if (data.action === 'inspect') {
          const id = randomUUID();
          await tx.query(
            "INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,note,idempotency_key) VALUES($1,$2,$3,$4,'inspected','Reviewed bulk inspection',$5)",
            [id, org, plant.id, actor.id, randomUUID()],
          );
          await attachFieldFact(tx, actor, org, plant.id, id, 'inspected', new Date());
          const latest = (
            await tx.query<{ id: string }>(
              'SELECT a.id FROM visual_analyses a JOIN plant_photos p ON p.id=a.photo_id WHERE a.plant_id=$1 ORDER BY p.captured_at DESC LIMIT 1',
              [plant.id],
            )
          ).rows[0];
          if (latest) await scorePlant(tx, plant.id, latest.id);
        }
      }
      await audit(tx, org, actor.id, 'fleet.bulk-' + data.action, data.plants[0].id, {
        plants: data.plants.map((p) => p.id),
        dueAt: data.dueAt,
      });
      return { changed: data.plants.length };
    },
  );
}
const lifecycleInput = mutationBase.extend({
  kind: z.enum(['retired', 'replaced']),
  outcome: z.enum(['died', 'replaced', 'relocated', 'other']),
  reason: z.string().trim().min(1).max(1000),
  replacementPlantId: z.uuid().optional(),
  revision: z.number().int().nonnegative(),
});
export async function recordLifecycle(actor: Actor, org: string, id: string, raw: unknown) {
  const data = lifecycleInput.parse(raw);
  return mutate(
    actor,
    org,
    'fleet.manage',
    data.idempotencyKey,
    { operation: 'plant.lifecycle', id, ...data },
    async (tx) => {
      const plant = (
        await tx.query<{ operations_revision: string; lifecycle_status: string }>(
          'SELECT operations_revision,lifecycle_status FROM plants WHERE id=$1 AND organisation_id=$2 FOR UPDATE',
          [id, org],
        )
      ).rows[0];
      if (
        !plant ||
        plant.lifecycle_status !== 'active' ||
        Number(plant.operations_revision) !== data.revision
      )
        throw new AppError(409, 'Plant lifecycle changed. Refresh before recording the outcome.');
      if (
        data.kind === 'replaced' &&
        (!data.replacementPlantId ||
          data.replacementPlantId === id ||
          !(
            await tx.query(
              "SELECT id FROM plants WHERE id=$1 AND organisation_id=$2 AND lifecycle_status='active'",
              [data.replacementPlantId, org],
            )
          ).rows.length)
      )
        throw new AppError(400, 'Choose a different active replacement plant.');
      const event = randomUUID();
      await tx.query(
        'INSERT INTO plant_lifecycle_events(id,organisation_id,plant_id,actor_id,kind,outcome,reason,replacement_plant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          event,
          org,
          id,
          actor.id,
          data.kind,
          data.outcome,
          data.reason,
          data.replacementPlantId || null,
        ],
      );
      await tx.query(
        'UPDATE plants SET lifecycle_status=$3,operations_revision=operations_revision+1 WHERE id=$1 AND organisation_id=$2',
        [id, org, data.kind],
      );
      await tx.query(
        "UPDATE operations_tasks SET status='cancelled',revision=revision+1,updated_at=now() WHERE plant_id=$1 AND status IN ('pending','in_progress')",
        [id],
      );
      await tx.query('DELETE FROM location_plant_pins WHERE plant_id=$1', [id]);
      const alerts = await tx.query<{ id: string }>(
        "UPDATE alerts SET status='resolved',resolved_at=now(),resolution_note=$2 WHERE plant_id=$1 AND status<>'resolved' RETURNING id",
        [id, 'Plant lifecycle outcome: ' + data.reason],
      );
      for (const alert of alerts.rows)
        await tx.query(
          "INSERT INTO alert_status_events(id,alert_id,actor_id,status) VALUES($1,$2,$3,'resolved')",
          [randomUUID(), alert.id, actor.id],
        );
      await tx.query("UPDATE plant_tags SET state='revoked' WHERE plant_id=$1 AND state='active'", [
        id,
      ]);
      await audit(tx, org, actor.id, 'plant.' + data.kind, id, {
        reason: data.reason,
        outcome: data.outcome,
        replacementPlantId: data.replacementPlantId,
      });
      return { id, status: data.kind, event };
    },
  );
}
