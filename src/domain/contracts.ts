import { z } from 'zod';

export const uuid = z.uuid();

export const name = z.string().trim().min(1).max(120);

export const registerSchema = z.object({
  name,
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
});

export const loginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const workspaceSchema = z.object({ name, kind: z.enum(['personal', 'business']) });

export const plantSchema = z.object({
  name,
  speciesId: uuid,
  locationId: uuid.nullable().optional(),
  origin: z.string().trim().max(250).default(''),
  acquiredAt: z.iso.date().nullable().optional(),
  ageMonthsEstimate: z.number().int().min(0).max(3000).nullable().optional(),
  publicPassport: z.boolean().default(true),
});

export const careSchema = z.object({
  type: z.enum(['watered', 'fertilised', 'repotted', 'moved', 'inspected']),
  amountMl: z.number().int().min(0).max(100000).nullable().optional(),
  note: z.string().trim().max(2000).default(''),
  locationId: uuid.nullable().optional(),
  idempotencyKey: uuid,
});
