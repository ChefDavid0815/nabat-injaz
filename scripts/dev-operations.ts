// Isolated local preview. Never loads a cloud connection or changes production data.
import path from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
Object.assign(process.env, { NODE_ENV: 'development' });
process.env.DATABASE_URL = '';
process.env.APP_URL = 'http://127.0.0.1:3001';
process.env.NABAT_DATA_DIR = path.resolve('data/operations-preview');
process.env.ENABLE_DEMO = 'true';
process.env.AI_PROVIDER = 'development';
// Next loads .env.local during prepare; explicit empty values prevent cloud fallback.
for (const name of [
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OPENAI_API_KEY',
  'AI_GATEWAY_API_KEY',
  'WORKSPACE_AGENT_ACCESS_TOKEN',
  'WORKSPACE_AGENT_TRIGGER_ID',
  'WORKSPACE_AGENT_NABAT_WORKSPACE_ID',
])
  process.env[name] = '';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
const { migrate } = await import('../src/server/db');
const { seed } = await import('../src/server/seed');
const { seedOperationsDemo } = await import('../src/server/operations-seed');
const { seedOperationalFixtures } = await import('../src/server/operations-demo');
await migrate();
await seed();
await seedOperationsDemo();
await seedOperationalFixtures();
const { default: next } = await import('next');
const { default: config } = await import('../next.config');
const app = next({
  dev: true,
  hostname: '127.0.0.1',
  port: 3001,
  dir: process.cwd(),
  conf: { ...config, distDir: '.next-operations', allowedDevOrigins: ['127.0.0.1'] },
});
await app.prepare();
const handler = app.getRequestHandler();
createServer((request, response) => {
  void handler(request, response);
}).listen(3001, '127.0.0.1', () =>
  console.log('NABAT Operations preview · http://127.0.0.1:3001 · isolated synthetic database'),
);
