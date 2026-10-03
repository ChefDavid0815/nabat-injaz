import { randomUUID, randomBytes } from 'node:crypto';
import { database, ready } from '@/server/db';
import { authorize, AppError, managerRoles } from '@/server/security';
import type { Actor } from '@/domain/types';
import { uuid } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';
import { getPlant } from '@/domain/plants/service';

export async function tags(actor: Actor, org: string) {
  await authorize(actor, org, managerRoles);
  return (
    await (
      await database()
    ).query<{
      id: string;
      plant_id: string;
      public_token: string;
      state: string;
      name: string;
      code: string;
      activated_at: string;
      last_interaction_at: string | null;
      replaced_by: string | null;
    }>(
      'SELECT t.*,p.name,p.code FROM plant_tags t JOIN plants p ON p.id=t.plant_id WHERE t.organisation_id=$1 ORDER BY t.activated_at DESC',
      [org],
    )
  ).rows;
}

export async function replaceTag(actor: Actor, id: string, revokeOnly = false) {
  uuid.parse(id);
  const db = await database();
  return db.transaction(async (tx) => {
    const tag = (
      await tx.query<{ organisation_id: string; plant_id: string; state: string }>(
        'SELECT * FROM plant_tags WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!tag) throw new AppError(404, 'Tag not found.');
    await authorize(actor, tag.organisation_id, managerRoles, tx);
    if (tag.state !== 'active') throw new AppError(409, 'This tag is no longer active.');
    await tx.query('UPDATE plant_tags SET state=$2 WHERE id=$1', [
      id,
      revokeOnly ? 'revoked' : 'replaced',
    ]);
    if (revokeOnly) {
      await audit(tx, tag.organisation_id, actor.id, 'tag.revoked', id);
      return { id };
    }
    const newId = randomUUID();
    await tx.query(
      'INSERT INTO plant_tags(id,organisation_id,plant_id,public_token) VALUES($1,$2,$3,$4)',
      [newId, tag.organisation_id, tag.plant_id, randomBytes(24).toString('base64url')],
    );
    await tx.query('UPDATE plant_tags SET replaced_by=$2 WHERE id=$1', [id, newId]);
    await audit(tx, tag.organisation_id, actor.id, 'tag.replaced', id, { newId });
    return { id: newId };
  });
}

export async function provisionTag(actor: Actor, plantId: string) {
  const plant = await getPlant(actor, plantId);
  const db = await database();
  await db.transaction(async (tx) => {
    await authorize(actor, plant.organisation_id, managerRoles, tx);
    const current = (
      await tx.query('SELECT id FROM plants WHERE id=$1 AND organisation_id=$2 FOR UPDATE', [
        plantId,
        plant.organisation_id,
      ])
    ).rows[0];
    if (!current) throw new AppError(409, 'Plant ownership changed. Reload before provisioning.');
    const id = randomUUID();
    const added = await tx.query(
      "INSERT INTO plant_tags(id,organisation_id,plant_id,public_token) VALUES($1,$2,$3,$4) ON CONFLICT(plant_id) WHERE state='active' DO NOTHING RETURNING id",
      [id, plant.organisation_id, plantId, randomBytes(24).toString('base64url')],
    );
    if (added.rows.length) {
      await tx.query(
        "UPDATE plant_tags SET replaced_by=$2 WHERE id=(SELECT id FROM plant_tags WHERE plant_id=$1 AND state='revoked' AND replaced_by IS NULL ORDER BY activated_at DESC LIMIT 1)",
        [plantId, id],
      );
      await audit(tx, plant.organisation_id, actor.id, 'tag.provisioned', id, { plantId });
    }
  });
}

export async function resolveTag(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw new AppError(404, 'Plant identity not found.');
  await ready();
  const db = await database();
  const tag = (
    await db.query<{ plant_id: string; organisation_id: string; state: string; id: string }>(
      'SELECT id,plant_id,organisation_id,state FROM plant_tags WHERE public_token=$1',
      [token],
    )
  ).rows[0];
  if (!tag) throw new AppError(404, 'Plant identity not found.');
  if (tag.state !== 'active')
    throw new AppError(410, 'This tag was retired. Ask the caretaker for the current tag.');
  await db.query(
    "UPDATE plant_tags SET last_interaction_at=now() WHERE id=$1 AND (last_interaction_at IS NULL OR last_interaction_at<now()-interval '1 minute')",
    [tag.id],
  );
  return tag;
}

export async function publicPassport(plantId: string) {
  return (
    await (
      await database()
    ).query<{
      name: string;
      code: string;
      species_name: string;
      scientific_name: string;
      public_passport: boolean;
    }>(
      'SELECT p.name,p.code,p.public_passport,s.common_name species_name,s.scientific_name FROM plants p JOIN plant_species s ON s.id=p.species_id WHERE p.id=$1',
      [plantId],
    )
  ).rows[0];
}
