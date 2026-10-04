import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/server/db';
import { authorize, AppError, careRoles } from '@/server/security';
import { attachFieldFact } from '@/domain/operations/care-links';
import { scorePlant } from '@/server/analysis';
import type { Actor } from '@/domain/types';
import { uuid, careSchema } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';
import { getPlant } from '@/domain/plants/service';
import { locationCheck } from '@/domain/locations/service';

export async function logCare(actor: Actor, id: string, raw: unknown) {
  const data = careSchema.parse(raw),
    plant = await getPlant(actor, id),
    db = await database();
  return db.transaction(async (tx) => {
    await tx.query('SELECT id FROM plants WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [
      id,
      plant.organisation_id,
    ]);
    await authorize(actor, plant.organisation_id, careRoles, tx);
    const old = (
      await tx.query<{ id: string; plant_id: string; actor_id: string; organisation_id: string }>(
        'SELECT * FROM care_events WHERE idempotency_key=$1',
        [data.idempotencyKey],
      )
    ).rows[0];
    if (old) {
      if (
        old.plant_id !== id ||
        old.actor_id !== actor.id ||
        old.organisation_id !== plant.organisation_id
      )
        throw new AppError(409, 'That request key is already used.');
      return { id: old.id, duplicate: true };
    }
    if (data.type === 'moved' && !data.locationId)
      throw new AppError(400, 'Choose the destination location.');
    await locationCheck(tx, plant.organisation_id, data.locationId);
    let note = data.note;
    if (data.type === 'moved') {
      const destination = (
        await tx.query<{ name: string }>(
          'SELECT name FROM locations WHERE id=$1 AND organisation_id=$2',
          [data.locationId, plant.organisation_id],
        )
      ).rows[0];
      note = `Moved from ${plant.location_name || 'Unplaced'} to ${destination.name}.${data.note ? ' ' + data.note : ''}`;
    }
    const careId = randomUUID();
    await tx.query(
      'INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,amount_ml,note,location_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        careId,
        plant.organisation_id,
        id,
        actor.id,
        data.type,
        data.amountMl ?? null,
        note,
        data.locationId || null,
        data.idempotencyKey,
      ],
    );
    if (data.type === 'moved')
      await tx.query('UPDATE plants SET location_id=$2 WHERE id=$1', [id, data.locationId]);
    if (data.type === 'watered') {
      const alerts = (
        await tx.query<{ id: string }>(
          "UPDATE alerts SET status='resolved',updated_at=now() WHERE plant_id=$1 AND rule='care-overdue' AND status<>'resolved' RETURNING id",
          [id],
        )
      ).rows;
      for (const alert of alerts)
        await tx.query(
          "INSERT INTO alert_status_events(id,alert_id,actor_id,status) VALUES($1,$2,$3,'resolved')",
          [randomUUID(), alert.id, actor.id],
        );
    }
    const analysis = (
      await tx.query<{ id: string }>(
        'SELECT a.id FROM visual_analyses a JOIN plant_photos p ON p.id=a.photo_id WHERE a.plant_id=$1 ORDER BY p.captured_at DESC,a.created_at DESC LIMIT 1',
        [id],
      )
    ).rows[0];
    if (analysis) await scorePlant(tx, id, analysis.id);
    await audit(tx, plant.organisation_id, actor.id, `care.${data.type}`, careId, { plantId: id });
    await attachFieldFact(
      tx,
      actor,
      plant.organisation_id,
      id,
      careId,
      data.type,
      new Date(),
      note,
    );
    return { id: careId, duplicate: false };
  });
}

export async function amendCare(actor: Actor, id: string, raw: unknown) {
  uuid.parse(id);
  const data = z
      .object({
        note: z.string().trim().max(2000),
        amountMl: z.number().int().min(0).max(100000).nullable(),
      })
      .parse(raw),
    db = await database();
  await db.transaction(async (tx) => {
    const event = (
      await tx.query<{
        organisation_id: string;
        actor_id: string;
        occurred_at: Date;
        note: string;
        amount_ml: number | null;
      }>('SELECT * FROM care_events WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!event) throw new AppError(404, 'Care event not found.');
    await authorize(actor, event.organisation_id, careRoles, tx);
    if (event.actor_id !== actor.id || Date.now() - event.occurred_at.getTime() > 10 * 60000)
      throw new AppError(403, 'Only the person who logged care can add details within 10 minutes.');
    await tx.query('UPDATE care_events SET note=$2,amount_ml=$3 WHERE id=$1', [
      id,
      data.note,
      data.amountMl,
    ]);
    await audit(tx, event.organisation_id, actor.id, 'care.details-added', id, {
      previousNote: event.note,
      previousAmount: event.amount_ml,
    });
  });
}
