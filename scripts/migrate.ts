import { migrate } from '../src/server/db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
await migrate();
console.log('Database migrations applied.');
process.exit(0);
