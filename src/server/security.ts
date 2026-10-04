import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { database, ready, type SqlClient } from './db';
import type { Actor, Role, Workspace } from '@/domain/types';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const sessionCookieName = () =>
  process.env.NODE_ENV === 'production' ? '__Host-nabat_session' : 'nabat_session';
const scryptAsync = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':');
  const test = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash || '', 'hex');
  return expected.length === test.length && timingSafeEqual(expected, test);
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await (
    await database()
  ).query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [digest(token), userId],
  );
  return token;
}
export async function actorFromToken(token?: string): Promise<Actor | null> {
  if (!token || token.length > 128) return null;
  await ready();
  return (
    (
      await (
        await database()
      ).query<Actor>(
        'SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
        [digest(token)],
      )
    ).rows[0] || null
  );
}
export async function authorize(
  actor: Actor,
  org: string,
  roles?: Role[],
  db?: SqlClient,
): Promise<Workspace> {
  const w = (
    await (db || (await database())).query<Workspace>(
      'SELECT o.*,m.role FROM organisation_memberships m JOIN organisations o ON o.id=m.organisation_id WHERE m.user_id=$1 AND o.id=$2',
      [actor.id, org],
    )
  ).rows[0];
  if (!w || (roles && !roles.includes(w.role)))
    throw new AppError(403, 'You do not have permission for this workspace action.');
  return w;
}
export async function rateLimit(key: string, limit = 60, seconds = 60) {
  const db = await database();
  const row = (
    await db.query<{ hits: number }>(
      `INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.hits+1 END,
    reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.reset_at END RETURNING hits`,
      [digest(key), seconds],
    )
  ).rows[0];
  if (row.hits > limit) throw new AppError(429, 'Too many requests. Try again shortly.');
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : `${new URL(request.url).protocol}//${request.headers.get('host') || new URL(request.url).host}`;
  const origin = request.headers.get('origin');
  if (!origin || origin !== expected) throw new AppError(403, 'Request origin is not allowed.');
}
export const managerRoles: Role[] = ['owner', 'admin', 'manager'];
export const adminRoles: Role[] = ['owner', 'admin'];
export const careRoles: Role[] = ['owner', 'admin', 'manager', 'caretaker'];
