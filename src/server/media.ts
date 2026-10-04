import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import sharp, { type Metadata } from 'sharp';
import { put as putBlob, get as getBlob } from '@vercel/blob';
import { dataRoot, database } from './db';
import { AppError, authorize, careRoles } from './security';
import { attachFieldFact } from '@/domain/operations/care-links';
import type { Actor } from '@/domain/types';

let secretPromise: Promise<string> | undefined;
async function secret() {
  if (process.env.SESSION_SECRET) {
    if (process.env.SESSION_SECRET.length < 32)
      throw new Error('SESSION_SECRET must have at least 32 characters.');
    return process.env.SESSION_SECRET;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required.');
  if (!secretPromise)
    secretPromise = (async () => {
      await mkdir(dataRoot(), { recursive: true });
      const file = path.join(dataRoot(), 'signing-secret');
      try {
        return await readFile(file, 'utf8');
      } catch {
        const value = randomBytes(48).toString('hex');
        try {
          await writeFile(file, value, { flag: 'wx', mode: 0o600 });
          return value;
        } catch {
          return readFile(file, 'utf8');
        }
      }
    })();
  return secretPromise;
}
export async function sign(payload: Record<string, unknown>, seconds = 300) {
  const encoded = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + seconds }),
  ).toString('base64url');
  const signature = createHmac('sha256', await secret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}
export async function verifySignature(token: string) {
  if (token.length > 4096) throw new AppError(403, 'Invalid or expired media link.');
  const [data, sig] = token.split('.');
  const expected = createHmac('sha256', await secret())
    .update(data || '')
    .digest();
  const actual = Buffer.from(sig || '', 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError(403, 'Invalid or expired media link.');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as Record<string, unknown>;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000)
    throw new AppError(403, 'Invalid or expired media link.');
  return payload;
}
export interface MediaStorage {
  put(key: string, data: Buffer, type: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
class LocalStorage implements MediaStorage {
  private resolve(key: string) {
    const root = path.join(dataRoot(), 'media'),
      file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid object key');
    return file;
  }
  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}
class S3Storage implements MediaStorage {
  private client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
  });
  async put(key: string, data: Buffer, type: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: type,
        ServerSideEncryption: 'AES256',
      }),
    );
  }
  async get(key: string) {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    if (!r.Body) throw new Error('Media object is missing');
    return Buffer.from(await r.Body.transformToByteArray());
  }
}
class VercelBlobStorage implements MediaStorage {
  async put(key: string, data: Buffer, type: string) {
    await putBlob(key, data, {
      access: 'private',
      contentType: type,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  }
  async get(key: string) {
    const result = await getBlob(key, {
      access: 'private',
      useCache: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result?.stream) throw new Error('Private media object is missing.');
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
}
export function storage(): MediaStorage {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
    return new VercelBlobStorage();
  if (process.env.S3_BUCKET) return new S3Storage();
  if (process.env.NODE_ENV === 'production')
    throw new Error('Production requires private Blob or S3 storage.');
  return new LocalStorage();
}
export async function mediaUrl(photoId: string, thumb = false, organisationId?: string) {
  const photo = (
    await (
      await database()
    ).query<{ organisation_id: string }>('SELECT organisation_id FROM plant_photos WHERE id=$1', [
      photoId,
    ])
  ).rows[0];
  if (!photo) throw new AppError(404, 'Photo not found.');
  if (organisationId && photo.organisation_id !== organisationId)
    throw new AppError(409, 'Plant ownership changed. Reload the record.');
  return `/api/media/${photoId}?token=${await sign({ purpose: 'read', photoId, thumb, organisationId: photo.organisation_id })}`;
}
export async function uploadPhoto(
  actor: Actor,
  plantId: string,
  body: Buffer,
  note: string,
  matchedView: boolean,
  careEventId?: string,
  uploadId?: string,
  capturedAt?: Date,
) {
  if (
    capturedAt &&
    (capturedAt.getTime() > Date.now() + 300000 ||
      capturedAt.getTime() < Date.now() - 3650 * 86400000)
  )
    throw new AppError(400, 'Capture date must be within the last ten years.');
  if (body.length > 10 * 1024 * 1024 || body.length < 32)
    throw new AppError(400, 'Use an image smaller than 10 MB.');
  const db = await database();
  const plant = (
    await db.query<{ organisation_id: string }>('SELECT organisation_id FROM plants WHERE id=$1', [
      plantId,
    ])
  ).rows[0];
  if (!plant) throw new AppError(404, 'Plant not found.');
  await authorize(actor, plant.organisation_id, careRoles);
  let metadata: Metadata;
  try {
    metadata = await sharp(body, { limitInputPixels: 40000000 }).metadata();
  } catch {
    throw new AppError(400, 'This file is not a supported photograph. Use JPEG, PNG or WebP.');
  }
  if (
    !['jpeg', 'png', 'webp'].includes(metadata.format || '') ||
    (metadata.pages && metadata.pages > 1)
  )
    throw new AppError(400, 'Use a still JPEG, PNG or WebP photograph.');
  const main = await sharp(body, { limitInputPixels: 40000000 })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(main.data)
    .resize(360, 360, { fit: 'cover' })
    .webp({ quality: 78 })
    .toBuffer();
  const id = randomUUID(),
    base = `${plant.organisation_id}/${plantId}/${id}`;
  const key = `${base}/observation.webp`,
    thumbnail = `${base}/thumbnail.webp`,
    original = `${base}/original.${metadata.format}`;
  const objects = storage();
  await Promise.all([
    objects.put(key, main.data, 'image/webp'),
    objects.put(thumbnail, thumb, 'image/webp'),
    objects.put(original, body, `image/${metadata.format}`),
  ]);
  await db.transaction(async (tx) => {
    await authorize(actor, plant.organisation_id, careRoles, tx);
    const stillOwned = (
      await tx.query('SELECT id FROM plants WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [
        plantId,
        plant.organisation_id,
      ])
    ).rows[0];
    if (!stillOwned) throw new AppError(409, 'Plant ownership changed. Reload before uploading.');
    if (
      careEventId &&
      !(
        await tx.query(
          'SELECT id FROM care_events WHERE id=$1 AND plant_id=$2 AND organisation_id=$3',
          [careEventId, plantId, plant.organisation_id],
        )
      ).rows.length
    )
      throw new AppError(400, 'This care event does not belong to this plant.');
    await tx.query(
      "INSERT INTO plant_photos(id,organisation_id,plant_id,actor_id,object_key,thumbnail_key,mime_type,bytes,width,height,note,original_metadata) VALUES($1,$2,$3,$4,$5,$6,'image/webp',$7,$8,$9,$10,$11)",
      [
        id,
        plant.organisation_id,
        plantId,
        actor.id,
        key,
        thumbnail,
        body.length,
        main.info.width,
        main.info.height,
        note,
        JSON.stringify({
          originalKey: original,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          format: metadata.format,
          orientation: metadata.orientation,
          matchedView,
        }),
      ],
    );
    await tx.query(
      'INSERT INTO analysis_jobs(id,organisation_id,plant_id,photo_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), plant.organisation_id, plantId, id],
    );
    await tx.query(
      "INSERT INTO observations(id,organisation_id,plant_id,actor_id,source,photo_id,note) VALUES($1,$2,$3,$4,'photo',$1,$5)",
      [id, plant.organisation_id, plantId, actor.id, note],
    );
    if (capturedAt) {
      await tx.query('UPDATE plant_photos SET captured_at=$2 WHERE id=$1', [id, capturedAt]);
      await tx.query('UPDATE observations SET captured_at=$2 WHERE id=$1', [id, capturedAt]);
    }
    await attachFieldFact(
      tx,
      actor,
      plant.organisation_id,
      plantId,
      id,
      'observation',
      capturedAt || new Date(),
      note,
    );
    if (careEventId)
      await tx.query('UPDATE plant_photos SET care_event_id=$2 WHERE id=$1', [id, careEventId]);
    if (uploadId) {
      const committed = await tx.query(
        "UPDATE media_uploads SET status='completed',photo_id=$2 WHERE id=$1 AND actor_id=$3 AND plant_id=$4 AND status='processing' RETURNING id",
        [uploadId, id, actor.id, plantId],
      );
      if (!committed.rows.length) throw new AppError(409, 'Upload reservation was not available.');
    }
    await tx.query(
      "INSERT INTO audit_events(id,organisation_id,actor_id,action,entity_id) VALUES($1,$2,$3,'observation.created',$4)",
      [randomUUID(), plant.organisation_id, actor.id, id],
    );
  });
  return { id, status: 'queued' };
}
