import { migrate } from '../src/server/db';
import { seed } from '../src/server/seed';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
await migrate();
await seed();
console.log('Synthetic demo seeded. owner@nabat.demo / NabatDemo2026!');
process.exit(0);
