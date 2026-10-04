import { z } from 'zod';

export const OPERATIONS_VERSION = 'operations/1.1';
export const taskKinds = [
  'watered',
  'fertilised',
  'inspected',
  'observation',
  'repotted',
  'follow_up',
] as const;
export const mutationBase = z.object({ idempotencyKey: z.uuid() });
export const careInput = mutationBase.extend({
  expectedActorId: z.uuid().optional(),
  plantId: z.uuid(),
  type: z.enum(['watered', 'fertilised', 'inspected', 'repotted']),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(2000).default(''),
  amountMl: z.number().int().min(0).max(100000).optional(),
  taskId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});
export const startSessionInput = mutationBase.extend({
  ownerId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  plantIds: z.array(z.uuid()).min(1).max(200).optional(),
});
export const sessionActionInput = mutationBase.extend({
  revision: z.number().int().nonnegative(),
  action: z.enum(['complete', 'cancel']),
});
export const taskInput = mutationBase.extend({
  plantId: z.uuid(),
  kind: z.enum(taskKinds),
  title: z.string().trim().min(1).max(180),
  dueAt: z.iso.datetime({ offset: true }),
  assigneeId: z.uuid().nullable().optional(),
});
export const taskActionInput = mutationBase.extend({
  revision: z.number().int().nonnegative(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  careEventId: z.uuid().optional(),
  assigneeId: z.uuid().nullable().optional(),
});
export const bulkInput = mutationBase
  .extend({
    plants: z
      .array(z.object({ id: z.uuid(), revision: z.number().int().nonnegative() }))
      .min(1)
      .max(100),
    action: z.enum(['assign', 'move']),
    targetId: z.uuid(),
  })
  .refine(
    (v) => new Set(v.plants.map((p) => p.id)).size === v.plants.length,
    'Select each plant once.',
  );
export const alertInput = mutationBase.extend({
  revision: z.number().int().nonnegative(),
  status: z.enum(['acknowledged', 'assigned', 'in_progress', 'resolved', 'reopened']),
  assigneeId: z.uuid().nullable().optional(),
  resolutionNote: z.string().trim().max(2000).default(''),
});
export const fleetInput = z.object({
  search: z.string().max(120).default(''),
  location: z.uuid().optional(),
  assignee: z.uuid().optional(),
  state: z.enum(['healthy', 'watch', 'attention', 'critical', 'baseline']).optional(),
  lifecycle: z.enum(['active', 'retired', 'replaced', 'all']).default('active'),
  overdue: z.coerce.boolean().optional(),
  inspection: z.coerce.boolean().optional(),
  sort: z
    .enum([
      'priority',
      'name',
      'code',
      'score',
      'location',
      'last_care',
      'species',
      'assignee',
      'delta',
      'alerts',
      'next_care',
    ])
    .default('priority'),
  noObservationDays: z.coerce.number().int().min(1).max(3650).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FleetInput = z.infer<typeof fleetInput>;
export type OperationTask = {
  id: string;
  plant_id: string;
  kind: string;
  title: string;
  source: string;
  due_at: string;
  status: string;
  revision: number;
  assignee_id: string | null;
  assignee_name: string | null;
  plant_name: string;
  plant_code: string;
  location_name: string | null;
};
