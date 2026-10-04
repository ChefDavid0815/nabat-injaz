import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '@/domain/types';
import { database } from './db';
import { AppError, rateLimit } from './security';
import { getPlant } from '@/domain/plants/service';
import { uploadPhoto } from './media';
import { requireCapability } from '@/domain/operations/authorization';
const metadataSchema = z.object({
  plantId: z.uuid(),
  note: z.string().max(2000).default(''),
  matchedView: z.boolean().default(false),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
});
export async function reserveOperationsPhoto(actor: Actor, org: string, raw: unknown) {
  const data = metadataSchema.parse(raw);
  await requireCapability(actor, org, 'care.write');
  const plant = await getPlant(actor, data.plantId);
  if (plant.organisation_id !== org) throw new AppError(403, 'Plant belongs to another workspace.');
  await rateLimit(`upload:${actor.id}`, 120, 3600);
  const id = randomUUID();
  await (
    await database()
  ).query(
    "INSERT INTO media_uploads(id,organisation_id,plant_id,actor_id,expires_at,metadata) VALUES($1,$2,$3,$4,now()+interval '5 minutes',$5)",
    [id, org, data.plantId, actor.id, JSON.stringify(data)],
  );
  return {
    route: `${org}/observations/${id}`,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
}
export async function receiveOperationsPhoto(
  actor: Actor,
  org: string,
  id: string,
  request: Request,
) {
  await requireCapability(actor, org, 'care.write');
  const db = await database();
  const reservation = (
    await db.query<{
      plant_id: string;
      status: string;
      photo_id: string | null;
      metadata: unknown;
    }>(
      'SELECT * FROM media_uploads WHERE id=$1 AND actor_id=$2 AND organisation_id=$3 AND expires_at>now()',
      [id, actor.id, org],
    )
  ).rows[0];
  if (!reservation) throw new AppError(403, 'Upload reservation expired. Choose the photo again.');
  if (reservation.status === 'completed') return { id: reservation.photo_id, duplicate: true };
  const data = metadataSchema.parse(reservation.metadata),
    plant = await getPlant(actor, reservation.plant_id);
  if (plant.organisation_id !== org) throw new AppError(409, 'Plant ownership changed.');
  if (!request.body) throw new AppError(400, 'Choose a photograph.');
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError(413, 'Use a prepared photo smaller than 4 MB.');
    }
    chunks.push(value);
  }
  if (
    !(
      await db.query(
        "UPDATE media_uploads SET status='processing' WHERE id=$1 AND status='issued' AND expires_at>now() RETURNING id",
        [id],
      )
    ).rows.length
  )
    throw new AppError(409, 'Upload is already processing. Reload the plant shortly.');
  try {
    return await uploadPhoto(
      actor,
      reservation.plant_id,
      Buffer.concat(chunks),
      data.note,
      data.matchedView,
      undefined,
      id,
      data.capturedAt ? new Date(data.capturedAt) : undefined,
    );
  } catch (error) {
    await db.query("UPDATE media_uploads SET status='issued' WHERE id=$1 AND status='processing'", [
      id,
    ]);
    throw error;
  }
}
