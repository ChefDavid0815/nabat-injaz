import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/server/db';
import { authorize, AppError, careRoles } from '@/server/security';
import type { Actor, Alert } from '@/domain/types';
import { uuid } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';

export async function alerts(actor: Actor, org: string) {
  await authorize(actor, org);
  return (
    await (
      await database()
    ).query<Alert>(
      "SELECT a.*,p.name,p.code,l.name location_name FROM alerts a JOIN plants p ON p.id=a.plant_id LEFT JOIN locations l ON l.id=p.location_id WHERE a.organisation_id=$1 ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,a.created_at DESC LIMIT 200",
      [org],
    )
  ).rows;
}

export async function updateAlert(actor: Actor, id: string, status: string) {
  uuid.parse(id);
  z.enum(['acknowledged', 'resolved']).parse(status);
  const db = await database();
  await db.transaction(async (tx) => {
    const a = (
      await tx.query<{ organisation_id: string; status: string }>(
        'SELECT * FROM alerts WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!a) throw new AppError(404, 'Alert not found.');
    await authorize(actor, a.organisation_id, careRoles, tx);
    if (a.status === 'resolved') throw new AppError(409, 'This alert is already resolved.');
    await tx.query('UPDATE alerts SET status=$2,updated_at=now() WHERE id=$1', [id, status]);
    await tx.query(
      'INSERT INTO alert_status_events(id,alert_id,actor_id,status) VALUES($1,$2,$3,$4)',
      [randomUUID(), id, actor.id, status],
    );
    await audit(tx, a.organisation_id, actor.id, `alert.${status}`, id);
  });
}
