import { randomUUID } from 'node:crypto';
import { type SqlClient } from '@/server/db';

export async function audit(
  tx: SqlClient,
  org: string,
  actor: string,
  action: string,
  entityId: string,
  payload: Record<string, unknown> = {},
) {
  await tx.query(
    'INSERT INTO audit_events(id,organisation_id,actor_id,action,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), org, actor, action, entityId, JSON.stringify(payload)],
  );
}
