// Explicit release rehearsal. Uses the existing direct DSN, never prints credentials.
import { parseEnv } from 'node:util';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { seal } from './windows-seal';
import type { SqlClient } from '../src/server/db';
const variables = parseEnv(await readFile('.env.vercel.production', 'utf8'));
Object.assign(process.env, variables);
// Sensitive Vercel values may be intentionally omitted by env pull. This rehearsal
// only inspects signed-URL metadata; it never requests media or authenticates users.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
const raw = variables.DATABASE_URL_UNPOOLED || variables.POSTGRES_URL_NON_POOLING;
if (!raw) throw new Error('A direct production DSN is required.');
const url = new URL(raw);
if (url.hostname.includes('-pooler')) throw new Error('Use the direct migration connection.');
url.searchParams.set('sslmode', 'verify-full');
const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 10000 }),
  client = await pool.connect();
let pending = Promise.resolve();
function serial<T>(action: () => Promise<T>) {
  const result = pending.then(action);
  pending = result.then(
    () => {},
    () => {},
  );
  return result;
}
const wrap: SqlClient = {
  query: async <T>(sql: string, values?: unknown[]) => ({
    rows: (await serial(() => client.query(sql, values))).rows as T[],
  }),
  exec: (sql) => serial(() => client.query(sql)),
  transaction: async (fn) => fn(wrap),
};
globalThis.nabatDb = Promise.resolve(wrap);
const counts = async () =>
  (
    await client.query(
      'SELECT (SELECT count(*)::int FROM plants) plants,(SELECT count(*)::int FROM plant_photos) photos,(SELECT count(*)::int FROM visual_analyses) analyses,(SELECT count(*)::int FROM health_score_snapshots) scores,(SELECT count(*)::int FROM schema_migrations) migrations',
    )
  ).rows[0];
const before = await counts(),
  applied: string[] = [];
const apply = process.argv.includes('--apply');
let backup: string | null = null;
try {
  if (apply) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows;
    const data: Record<string, unknown> = {};
    for (const { tablename } of tables) {
      if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected backup relation.');
      data[tablename] = (await client.query('SELECT * FROM "' + tablename + '"')).rows;
    }
    await client.query('COMMIT');
    await mkdir('data/operations-release-backups', { recursive: true });
    backup = 'data/operations-release-backups/pre-1.1-' + Date.now() + '.json.dpapi';
    await writeFile(
      backup,
      seal(
        Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), before, tables: data })),
      ),
    );
  }
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s'");
  await client.query('SELECT pg_advisory_xact_lock(1742026)');
  for (const name of (await readdir('db/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    if (
      (await client.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rows.length
    )
      continue;
    await client.query(await readFile('db/migrations/' + name, 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    applied.push(name);
  }
  const actor = (
    await client.query(
      "SELECT u.id,u.email,u.name,m.organisation_id FROM users u JOIN organisation_memberships m ON m.user_id=u.id WHERE m.role='owner' ORDER BY m.created_at LIMIT 1",
    )
  ).rows[0];
  if (!actor) throw new Error('No owner workspace exists for the compatibility check.');
  const { snapshot } = await import('../src/domain/operations/queries');
  const projection = await snapshot(actor, actor.organisation_id);
  const inside = await counts();
  if (['plants', 'photos', 'analyses', 'scores'].some((key) => inside[key] !== before[key]))
    throw new Error('Compatibility migration changed historical record counts.');
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  const after = await counts();
  if (!apply && JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('Rehearsal rollback did not preserve the database.');
  const evidence = {
    checkedAt: new Date().toISOString(),
    method: apply
      ? 'Direct TLS connection; encrypted data backup and additive release migrations'
      : 'Direct TLS connection; transactional migration rehearsal and rollback',
    neonBranchCreated: false,
    productionChanged: apply,
    encryptedBackup: backup,
    migrations: applied,
    before,
    after,
    contract: projection.contractVersion,
    workspaceReadable: true,
  };
  await mkdir('docs/qa/operations', { recursive: true });
  await writeFile(
    'docs/qa/operations/' +
      (apply ? 'cloud-migration-release' : 'cloud-migration-rehearsal') +
      '.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
