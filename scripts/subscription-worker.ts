import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { database } from '../src/server/db';
import { runAnalysisBatch } from '../src/server/analysis';
import { planModelCatalog, PlanAccessError } from '../src/server/chatgpt-plan';

if (process.env.VERCEL) throw Error('Run the subscription worker only on your local computer.');
const cloudEnv = parseEnv(await readFile('.env.vercel.production', 'utf8'));
for (const key of ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID'])
  if (cloudEnv[key]) process.env[key] = cloudEnv[key];
Object.assign(process.env, JSON.parse(await readFile('data/deploy-secrets.json', 'utf8')), {
  NODE_ENV: 'production',
  ENABLE_DEMO: 'false',
  AI_PROVIDER: 'chatgpt-subscription',
  APP_URL: 'https://nabat-injaz.vercel.app',
});
const at = process.argv.indexOf('--workspace');
const workspace = z
  .uuid()
  .parse(at >= 0 ? process.argv[at + 1] : process.env.NABAT_SUBSCRIPTION_WORKSPACE_ID);
if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN)
  throw Error('Connect the real production DB and private Blob before starting.');
const db = await database();
if (!(await db.query('SELECT id FROM organisations WHERE id=$1', [workspace])).rows.length)
  throw Error('The selected NABAT workspace does not exist.');
if (!(await planModelCatalog()).some((m) => m.slug === 'gpt-6.1-sol'))
  throw new PlanAccessError('GPT-6.1 Sol is unavailable in the selected ChatGPT workspace.');
console.log(
  `NABAT subscription worker running for workspace ${workspace}. Model: GPT-6.1 Sol. No API-key or Gateway fallback.`,
);
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
while (!stopping) {
  try {
    const completed = await runAnalysisBatch(1, undefined, Infinity, workspace);
    if (process.argv.includes('--once')) break;
    if (!completed) await new Promise((r) => setTimeout(r, 2000));
  } catch (e) {
    if (e instanceof PlanAccessError) {
      console.error(e.message);
      process.exitCode = 1;
      break;
    }
    console.error('Worker iteration failed; retrying after a bounded delay.');
    await new Promise((r) => setTimeout(r, 10000));
  }
}
process.exit(process.exitCode || 0);
