import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type SqlClient } from '@/server/db';
import { authorize, AppError, managerRoles } from '@/server/security';
import type { Actor } from '@/domain/types';
import { uuid, name } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';

export async function locationCheck(tx: SqlClient, org: string, location?: string | null) {
  if (
    location &&
    !(
      await tx.query('SELECT id FROM locations WHERE id=$1 AND organisation_id=$2', [location, org])
    ).rows.length
  )
    throw new AppError(400, 'Select a location in this workspace.');
}

export async function createLocation(actor: Actor, org: string, raw: unknown) {
  const data = z.object({ name, parentId: uuid.nullable().optional() }).parse(raw),
    db = await database(),
    id = randomUUID();
  await db.transaction(async (tx) => {
    await authorize(actor, org, managerRoles, tx);
    await locationCheck(tx, org, data.parentId);
    await tx.query('INSERT INTO locations(id,organisation_id,name,parent_id) VALUES($1,$2,$3,$4)', [
      id,
      org,
      data.name,
      data.parentId || null,
    ]);
    await audit(tx, org, actor.id, 'location.created', id);
  });
  return { id };
}
