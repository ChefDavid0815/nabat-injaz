import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

export const dataRoot = () => path.resolve(process.env.NABAT_DATA_DIR || './data');
declare global {
  var nabatDb: Promise<SqlClient> | undefined;
}

export async function database(): Promise<SqlClient> {
  if (!globalThis.nabatDb) globalThis.nabatDb = connect();
  return globalThis.nabatDb;
}
async function connect(): Promise<SqlClient> {
  if (process.env.NODE_ENV === 'production') {
    const url = process.env.APP_URL;
    if (!url || new URL(url).protocol !== 'https:')
      throw new Error('Production requires an HTTPS APP_URL.');
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
      throw new Error('Production requires SESSION_SECRET of at least 32 characters.');
    if (process.env.ENABLE_DEMO === 'true')
      throw new Error('Shared demo access must be disabled in production.');
  }
  if (process.env.DATABASE_URL) {
    const connection = new URL(process.env.DATABASE_URL);
    if (['require', 'prefer', 'verify-ca'].includes(connection.searchParams.get('sslmode') || ''))
      connection.searchParams.set('sslmode', 'verify-full');
    const pool = new Pool({ connectionString: connection.toString(), max: 8 });
    const wrap = (query: Pool['query']): SqlClient => ({
      query: async <T>(sql: string, values?: unknown[]) => ({
        rows: (await query(sql, values)).rows as T[],
      }),
      exec: (sql) => query(sql),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const value = await fn(wrap(c.query.bind(c) as Pool['query']));
          await c.query('COMMIT');
          return value;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    });
    return wrap(pool.query.bind(pool));
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Production requires DATABASE_URL.');
  }
  await mkdir(dataRoot(), { recursive: true });
  const pg = new PGlite(path.join(dataRoot(), 'postgres'));
  await pg.waitReady;
  const wrap = (c: Pick<PGlite, 'query' | 'exec' | 'transaction'>): SqlClient => ({
    query: <T>(sql: string, values?: unknown[]) => c.query<T>(sql, values),
    exec: (sql) => c.exec(sql),
    transaction: (fn) => c.transaction((tx) => fn(wrap(tx as unknown as PGlite))),
  });
  return wrap(pg);
}

export async function migrate() {
  const db = await database();
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  for (const name of (await readdir(path.join(process.cwd(), 'db/migrations')))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(1742026)');
      if ((await tx.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rows.length)
        return;
      await tx.exec(await readFile(path.join(process.cwd(), 'db/migrations', name), 'utf8'));
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    });
  }
}

declare global {
  var nabatReady: Promise<void> | undefined;
}
export async function ready() {
  if (!globalThis.nabatReady)
    globalThis.nabatReady = (async () => {
      if (!process.env.DATABASE_URL) await migrate();
      if (
        process.env.ENABLE_DEMO === 'true' ||
        (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production')
      ) {
        const { seed } = await import('./seed');
        await seed();
      }
    })();
  await globalThis.nabatReady;
}
