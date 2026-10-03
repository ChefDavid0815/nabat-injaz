import { randomUUID } from 'node:crypto';
import { database, ready } from '@/server/db';
import {
  AppError,
  hashPassword,
  verifyPassword,
  createSession,
  rateLimit,
} from '@/server/security';
import type { Actor } from '@/domain/types';
import { registerSchema, loginSchema } from '@/domain/contracts';

export async function register(raw: unknown) {
  await ready();
  const data = registerSchema.parse(raw);
  await rateLimit(`register:${data.email}`, 5, 3600);
  const db = await database();
  const id = randomUUID();
  try {
    await db.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
      id,
      data.email,
      data.name,
      await hashPassword(data.password),
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new AppError(409, 'An account with that email already exists. Sign in instead.');
    throw e;
  }
  return { token: await createSession(id), actor: { id, email: data.email, name: data.name } };
}

export async function login(raw: unknown) {
  await ready();
  const data = loginSchema.parse(raw);
  await rateLimit(`login:${data.email}`, 12, 900);
  const u = (
    await (
      await database()
    ).query<Actor & { password_hash: string }>('SELECT * FROM users WHERE email=$1', [data.email])
  ).rows[0];
  const valid = await verifyPassword(
    data.password,
    u?.password_hash ||
      '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  );
  if (!u || !valid) throw new AppError(401, 'Email or password is incorrect.');
  return { token: await createSession(u.id), actor: { id: u.id, email: u.email, name: u.name } };
}
