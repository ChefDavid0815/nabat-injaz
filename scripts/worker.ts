import { ready } from '../src/server/db';
import { runAnalysisBatch, overdueSweep } from '../src/server/analysis';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
if (!process.env.DATABASE_URL)
  throw new Error(
    'The standalone worker requires PostgreSQL. Local PGlite analysis runs inside the web process; do not open its data directory in a second process.',
  );
await ready();
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log('NABAT durable analysis worker running.');
let tick = 0;
while (!stopping) {
  await runAnalysisBatch(5);
  if (tick++ % 30 === 0) await overdueSweep();
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
process.exit(0);
