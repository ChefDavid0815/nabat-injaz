import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/server/db';
import { authorize, adminRoles } from '@/server/security';
import { ensureSpecies } from '@/server/seed';
import type { Actor, Workspace, Species, Location } from '@/domain/types';
import { name, workspaceSchema } from '@/domain/contracts';
import { audit } from '@/domain/audit/service';

export async function workspaces(actor: Actor) {
  return (
    await (
      await database()
    ).query<Workspace>(
      'SELECT o.*,m.role FROM organisation_memberships m JOIN organisations o ON o.id=m.organisation_id WHERE m.user_id=$1 ORDER BY o.created_at',
      [actor.id],
    )
  ).rows;
}

export async function createWorkspace(actor: Actor, raw: unknown) {
  const data = workspaceSchema.parse(raw),
    id = randomUUID(),
    db = await database();
  await ensureSpecies();
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO organisations(id,name,kind,plan) VALUES($1,$2,$3,$4)', [
      id,
      data.name,
      data.kind,
      data.kind === 'business' ? 'business' : 'personal',
    ]);
    await tx.query(
      "INSERT INTO organisation_memberships(id,organisation_id,user_id,role) VALUES($1,$2,$3,'owner')",
      [randomUUID(), id, actor.id],
    );
    await audit(tx, id, actor.id, 'workspace.created', id);
  });
  return { id };
}

export async function catalog(actor: Actor, org: string) {
  await authorize(actor, org);
  const db = await database();
  return {
    species: (await db.query<Species>('SELECT * FROM plant_species ORDER BY common_name')).rows,
    locations: (
      await db.query<Location>(
        'SELECT id,name,parent_id FROM locations WHERE organisation_id=$1 ORDER BY name',
        [org],
      )
    ).rows,
  };
}

export async function workspaceSettings(actor: Actor, org: string, raw: unknown) {
  const data = z
      .object({
        name,
        timezone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, 'Use a valid IANA timezone.'),
      })
      .parse(raw),
    db = await database();
  await db.transaction(async (tx) => {
    await authorize(actor, org, adminRoles, tx);
    await tx.query('UPDATE organisations SET name=$2,timezone=$3 WHERE id=$1', [
      org,
      data.name,
      data.timezone,
    ]);
    await audit(tx, org, actor.id, 'workspace.updated', org);
  });
}
