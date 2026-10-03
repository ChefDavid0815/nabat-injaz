import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/server/db';
import { authorize, AppError, managerRoles, adminRoles } from '@/server/security';
import { entitlements } from '@/domain/entitlements';
import type { Actor, Workspace } from '@/domain/types';
import { uuid } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';
import { getPlant } from '@/domain/plants/service';

export async function team(actor: Actor, org: string) {
  await authorize(actor, org);
  return (
    await (
      await database()
    ).query<{ id: string; user_id: string; name: string; email: string; role: Workspace['role'] }>(
      'SELECT m.id,m.user_id,m.role,u.name,u.email FROM organisation_memberships m JOIN users u ON u.id=m.user_id WHERE m.organisation_id=$1 ORDER BY m.created_at',
      [org],
    )
  ).rows;
}

export async function addMember(actor: Actor, org: string, raw: unknown) {
  const data = z
      .object({
        email: z.email().transform((v) => v.toLowerCase()),
        userId: uuid,
        role: z.enum(['admin', 'manager', 'caretaker']),
      })
      .parse(raw),
    db = await database();
  await db.transaction(async (tx) => {
    const w = await authorize(actor, org, adminRoles, tx);
    await tx.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE', [org]);
    const n = (
      await tx.query<{ n: number }>(
        'SELECT count(*)::int n FROM organisation_memberships WHERE organisation_id=$1',
        [org],
      )
    ).rows[0].n;
    if (n >= entitlements[w.plan].team)
      throw new AppError(409, 'Your workspace team limit has been reached.');
    const user = (
      await tx.query<{ id: string }>('SELECT id FROM users WHERE email=$1 AND id=$2', [
        data.email,
        data.userId,
      ])
    ).rows[0];
    if (!user)
      throw new AppError(
        400,
        'Ask this teammate to share their account ID from Settings, and confirm their email.',
      );
    const id = randomUUID();
    await tx.query(
      'INSERT INTO organisation_memberships(id,organisation_id,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(organisation_id,user_id) DO NOTHING',
      [id, org, user.id, data.role],
    );
    await audit(tx, org, actor.id, 'member.added', id);
  });
}

export async function assignPlant(actor: Actor, id: string, userId: string) {
  uuid.parse(userId);
  const p = await getPlant(actor, id),
    db = await database();
  await db.transaction(async (tx) => {
    await authorize(actor, p.organisation_id, managerRoles, tx);
    await tx.query('SELECT id FROM plants WHERE id=$1 FOR UPDATE', [id]);
    if (
      !(
        await tx.query(
          'SELECT id FROM organisation_memberships WHERE user_id=$1 AND organisation_id=$2',
          [userId, p.organisation_id],
        )
      ).rows.length
    )
      throw new AppError(400, 'Choose a member of this workspace.');
    await tx.query(
      'UPDATE plant_assignments SET ended_at=now() WHERE plant_id=$1 AND ended_at IS NULL',
      [id],
    );
    await tx.query(
      'INSERT INTO plant_assignments(id,organisation_id,plant_id,user_id,assigned_by) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), p.organisation_id, id, userId, actor.id],
    );
    const event = randomUUID();
    await tx.query(
      "INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,note,idempotency_key) VALUES($1,$2,$3,$4,'assigned','Caretaker assignment changed.',$5)",
      [event, p.organisation_id, id, actor.id, randomUUID()],
    );
    await audit(tx, p.organisation_id, actor.id, 'plant.assigned', id, { userId });
  });
}
