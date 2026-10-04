import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import jsQR from 'jsqr';
import type { Actor } from '@/domain/types';
import { database } from '@/server/db';
import { AppError } from '@/server/security';
import { requireCapability } from './authorization';
import { mutationBase } from './contracts';
import { mutate } from './mutations';
const batchInput = mutationBase.extend({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(240),
        capturedAt: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export async function imports(actor: Actor, org: string) {
  await requireCapability(actor, org, 'care.write');
  const db = await database();
  return (
    await db.query(
      'SELECT b.*,count(i.id)::int files,count(i.id) FILTER(WHERE i.status=$3)::int saved,count(i.id) FILTER(WHERE i.status=$4)::int review FROM photo_import_batches b LEFT JOIN photo_import_items i ON i.batch_id=b.id WHERE b.organisation_id=$1 AND b.actor_id=$2 GROUP BY b.id ORDER BY b.created_at DESC LIMIT 20',
      [org, actor.id, 'saved', 'needs_review'],
    )
  ).rows;
}
export async function importItems(actor: Actor, org: string, id: string) {
  await requireCapability(actor, org, 'care.write');
  return (
    await (
      await database()
    ).query(
      'SELECT i.*,p.name plant_name,p.code plant_code FROM photo_import_items i JOIN photo_import_batches b ON b.id=i.batch_id LEFT JOIN plants p ON p.id=i.plant_id AND p.organisation_id=b.organisation_id WHERE b.id=$1 AND b.organisation_id=$2 AND b.actor_id=$3 ORDER BY i.filename',
      [id, org, actor.id],
    )
  ).rows;
}
export async function createImport(actor: Actor, org: string, raw: unknown) {
  const data = batchInput.parse(raw);
  return mutate(
    actor,
    org,
    'care.write',
    data.idempotencyKey,
    { operation: 'import.create', ...data },
    async (tx) => {
      const batchId = randomUUID();
      await tx.query(
        'INSERT INTO photo_import_batches(id,organisation_id,actor_id) VALUES($1,$2,$3)',
        [batchId, org, actor.id],
      );
      const plants = (
        await tx.query<{ id: string; code: string }>(
          'SELECT id,code FROM plants WHERE organisation_id=$1',
          [org],
        )
      ).rows;
      for (const file of data.files) {
        const tokens = new Set(
          (file.filename.match(/[A-Z]+-[A-Z0-9]+/gi) || []).map((v) => v.toUpperCase()),
        );
        const matches = plants.filter((p) => tokens.has(p.code.toUpperCase()));
        const matched = matches.length === 1 ? matches[0] : null;
        await tx.query(
          'INSERT INTO photo_import_items(id,batch_id,filename,plant_id,status,captured_at) VALUES($1,$2,$3,$4,$5,$6)',
          [
            randomUUID(),
            batchId,
            file.filename.split(/[\\/]/).at(-1),
            matched?.id || null,
            matched ? 'ready' : 'needs_review',
            file.capturedAt || null,
          ],
        );
      }
      return { id: batchId };
    },
  );
}
const itemInput = mutationBase.extend({
  revision: z.number().int().nonnegative(),
  plantId: z.uuid().nullable().default(null),
  photoId: z.uuid().optional(),
  error: z.string().max(300).optional(),
  capturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export async function updateImportItem(actor: Actor, org: string, id: string, raw: unknown) {
  const data = itemInput.parse(raw);
  return mutate(
    actor,
    org,
    'care.write',
    data.idempotencyKey,
    { operation: 'import.item', id, ...data },
    async (tx) => {
      const item = (
        await tx.query<{ revision: number; status: string; batch_id: string }>(
          'SELECT i.* FROM photo_import_items i JOIN photo_import_batches b ON b.id=i.batch_id WHERE i.id=$1 AND b.organisation_id=$2 AND b.actor_id=$3 FOR UPDATE OF i',
          [id, org, actor.id],
        )
      ).rows[0];
      if (!item) throw new AppError(404, 'Import item not found.');
      if (item.revision !== data.revision || item.status === 'saved')
        throw new AppError(409, 'The import item changed.');
      if (
        data.plantId &&
        !(
          await tx.query('SELECT id FROM plants WHERE id=$1 AND organisation_id=$2', [
            data.plantId,
            org,
          ])
        ).rows.length
      )
        throw new AppError(400, 'Choose a plant in this workspace.');
      if (
        data.photoId &&
        !(
          await tx.query(
            'SELECT id FROM plant_photos WHERE id=$1 AND organisation_id=$2 AND plant_id=$3 AND actor_id=$4',
            [data.photoId, org, data.plantId, actor.id],
          )
        ).rows.length
      )
        throw new AppError(400, 'The saved observation does not match this import item.');
      const status = data.photoId
        ? 'saved'
        : data.error
          ? 'failed'
          : data.plantId
            ? 'ready'
            : 'needs_review';
      await tx.query(
        'UPDATE photo_import_items SET plant_id=$2,status=$3,photo_id=$4,error=$5,revision=revision+1,captured_at=CASE WHEN $6 THEN $7::timestamptz ELSE captured_at END,updated_at=now() WHERE id=$1',
        [
          id,
          data.plantId,
          status,
          data.photoId || null,
          data.error || null,
          data.capturedAt !== undefined,
          data.capturedAt || null,
        ],
      );
      await tx.query(
        "UPDATE photo_import_batches SET status='completed' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM photo_import_items WHERE batch_id=$1 AND status<>'saved')",
        [item.batch_id],
      );
      return { id, status, revision: item.revision + 1 };
    },
  );
}
export async function detectImportIdentity(actor: Actor, org: string, bytes: Buffer) {
  await requireCapability(actor, org, 'care.write');
  if (bytes.length > 4 * 1024 * 1024) throw new AppError(413, 'Use a photo smaller than 4 MB.');
  const image = await sharp(bytes, { limitInputPixels: 40000000 })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!image) return { candidate: null, reason: 'unsupported_image' };
  const qr = jsQR(new Uint8ClampedArray(image.data), image.info.width, image.info.height);
  if (!qr) return { candidate: null, reason: 'no_qr' };
  let url: URL;
  try {
    url = new URL(qr.data);
  } catch {
    return { candidate: null, reason: 'unrecognised_qr' };
  }
  if (url.origin !== new URL(process.env.APP_URL || 'http://localhost:3000').origin)
    return { candidate: null, reason: 'external_qr' };
  const token = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{24,64})$/)?.[1];
  if (!token) return { candidate: null, reason: 'unrecognised_qr' };
  const plant = (
    await (
      await database()
    ).query(
      'SELECT p.id,p.name,p.code FROM plant_tags t JOIN plants p ON p.id=t.plant_id WHERE t.public_token=$1 AND t.state=$2 AND t.organisation_id=$3',
      [token, 'active', org],
    )
  ).rows[0];
  return { candidate: plant || null, reason: plant ? 'qr' : 'retired_or_foreign_identity' };
}
