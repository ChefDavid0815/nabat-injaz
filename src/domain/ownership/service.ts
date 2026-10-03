import { randomUUID } from 'node:crypto';
import { database } from '@/server/db';
import { authorize, AppError, adminRoles } from '@/server/security';
import { entitlements } from '@/domain/entitlements';
import type { Actor, Workspace } from '@/domain/types';
import { uuid } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';
import { getPlant } from '@/domain/plants/service';

export async function transfers(actor: Actor, org: string) {
  await authorize(actor, org, adminRoles);
  return (
    await (
      await database()
    ).query(
      'SELECT t.*,p.name plant_name,p.code,o.name from_name,d.name to_name FROM ownership_transfers t JOIN plants p ON p.id=t.plant_id JOIN organisations o ON o.id=t.from_organisation_id JOIN organisations d ON d.id=t.to_organisation_id WHERE t.from_organisation_id=$1 OR t.to_organisation_id=$1 ORDER BY t.created_at DESC LIMIT 100',
      [org],
    )
  ).rows;
}

export async function requestTransfer(actor: Actor, plantId: string, targetOrg: string) {
  uuid.parse(targetOrg);
  const p = await getPlant(actor, plantId),
    db = await database(),
    id = randomUUID();
  await db.transaction(async (tx) => {
    await authorize(actor, p.organisation_id, ['owner'], tx);
    if (targetOrg === p.organisation_id)
      throw new AppError(400, 'Choose a different destination workspace.');
    if (!(await tx.query('SELECT id FROM organisations WHERE id=$1', [targetOrg])).rows.length)
      throw new AppError(400, 'Destination workspace was not found.');
    await tx.query(
      'INSERT INTO ownership_transfers(id,plant_id,from_organisation_id,to_organisation_id,requested_by) VALUES($1,$2,$3,$4,$5)',
      [id, plantId, p.organisation_id, targetOrg, actor.id],
    );
    await audit(tx, p.organisation_id, actor.id, 'transfer.requested', id, { plantId });
  });
  return { id };
}

export async function acceptTransfer(actor: Actor, id: string) {
  uuid.parse(id);
  const db = await database();
  await db.transaction(async (tx) => {
    const t = (
      await tx.query<{
        plant_id: string;
        from_organisation_id: string;
        to_organisation_id: string;
        status: string;
      }>('SELECT * FROM ownership_transfers WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!t) throw new AppError(404, 'Transfer not found.');
    await authorize(actor, t.to_organisation_id, ['owner'], tx);
    if (t.status !== 'pending') throw new AppError(409, 'This transfer is no longer pending.');
    const p = (
      await tx.query<{ organisation_id: string }>(
        'SELECT organisation_id FROM plants WHERE id=$1 FOR UPDATE',
        [t.plant_id],
      )
    ).rows[0];
    if (p.organisation_id !== t.from_organisation_id)
      throw new AppError(409, 'The plant owner has changed.');
    const w = (
      await tx.query<Workspace>('SELECT * FROM organisations WHERE id=$1 FOR UPDATE', [
        t.to_organisation_id,
      ])
    ).rows[0];
    const count = (
      await tx.query<{ n: number }>('SELECT count(*)::int n FROM plants WHERE organisation_id=$1', [
        t.to_organisation_id,
      ])
    ).rows[0].n;
    if (count >= entitlements[w.plan].plants)
      throw new AppError(409, 'Destination plant limit has been reached.');
    await tx.query(
      'UPDATE plant_assignments SET ended_at=now() WHERE plant_id=$1 AND ended_at IS NULL',
      [t.plant_id],
    );
    await tx.query('UPDATE care_events SET location_id=null WHERE plant_id=$1', [t.plant_id]);
    await tx.query('UPDATE plants SET organisation_id=$2,location_id=null WHERE id=$1', [
      t.plant_id,
      t.to_organisation_id,
    ]);
    await tx.query(
      "UPDATE ownership_transfers SET status='accepted',accepted_by=$2,accepted_at=now() WHERE id=$1",
      [id, actor.id],
    );
    await audit(tx, t.from_organisation_id, actor.id, 'transfer.released', id, {
      plantId: t.plant_id,
    });
    await audit(tx, t.to_organisation_id, actor.id, 'transfer.accepted', id, {
      plantId: t.plant_id,
    });
  });
}
