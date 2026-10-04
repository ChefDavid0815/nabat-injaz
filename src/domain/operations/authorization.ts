import type { Actor } from '@/domain/types';
import type { SqlClient } from '@/server/db';
import { authorize, AppError } from '@/server/security';

export type Capability =
  | 'operations.read'
  | 'care.write'
  | 'session.write'
  | 'task.manage'
  | 'fleet.manage'
  | 'alert.write';
const capabilities: Record<string, Capability[]> = {
  owner: [
    'operations.read',
    'care.write',
    'session.write',
    'task.manage',
    'fleet.manage',
    'alert.write',
  ],
  admin: [
    'operations.read',
    'care.write',
    'session.write',
    'task.manage',
    'fleet.manage',
    'alert.write',
  ],
  manager: [
    'operations.read',
    'care.write',
    'session.write',
    'task.manage',
    'fleet.manage',
    'alert.write',
  ],
  caretaker: ['operations.read', 'care.write', 'session.write', 'alert.write'],
  viewer: ['operations.read'],
};
export async function requireCapability(
  actor: Actor,
  org: string,
  capability: Capability,
  tx?: SqlClient,
) {
  const workspace = await authorize(actor, org, undefined, tx);
  if (!capabilities[workspace.role]?.includes(capability))
    throw new AppError(403, 'Your role cannot perform this operation.');
  return workspace;
}
