import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  credentialDirectory,
  readCredentials,
  createPlanAuthorization,
  consumePlanCallback,
  exchangePlanCode,
  planModelCatalog,
} from '../src/server/chatgpt-plan';

const dir = credentialDirectory();
await mkdir(dir, { recursive: true, mode: 0o700 });
const hostFile = path.join(dir, 'host-id');
let hostId: string;
try {
  hostId = await readFile(hostFile, 'utf8');
} catch {
  hostId = `urn:uuid:${randomUUID()}`;
  await writeFile(hostFile, hostId, { flag: 'wx', mode: 0o600 });
}
const old = await readCredentials().catch(() => null);
const transaction: { pending?: ReturnType<typeof createPlanAuthorization> } = {};
function begin(port: number) {
  const pending = createPlanAuthorization(
    hostId,
    `http://127.0.0.1:${port}/auth/callback`,
    process.argv.includes('--new-account') ? undefined : old?.client_id,
  );
  transaction.pending = pending;
  return pending;
}
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('X-Frame-Options', 'DENY');
  const address = server.address();
  if (!address || typeof address === 'string') return response.end();
  if (request.headers.host !== `127.0.0.1:${address.port}` || request.method !== 'GET') {
    response.statusCode = 400;
    return response.end('Invalid callback request.');
  }
  const url = new URL(request.url || '/', `http://127.0.0.1:${address.port}`);
  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    );
    return response.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NABAT · Connect ChatGPT subscription</title><style>body{margin:0;background:#f7f6ef;color:#153d32;font:17px/1.65 system-ui;display:grid;min-height:100vh;place-items:center}main{max-width:560px;padding:32px}h1{font:42px/1.1 Georgia,serif}a{display:inline-block;border-radius:8px;background:#153d32;color:white;padding:13px 22px;text-decoration:none;margin:12px 0}small{display:block;color:#506258}a:focus-visible{outline:3px solid #ad571d;outline-offset:4px}</style><main><b>NABAT</b><h1>Connect your ChatGPT subscription.</h1><p>Use your Business Premium plan with GPT-6.1 Sol in this local analysis worker. Choose the correct workspace and allow subscription usage. Keep extra paid credits disabled.</p><a href="/connect">Continue with ChatGPT</a><small>Credentials remain protected on this computer. Vercel receives analysis results, not your subscription tokens. Availability depends on OpenAI account and workspace policy.</small></main></html>`,
    );
  }
  if (url.pathname === '/connect') {
    const pending = begin(address.port);
    await writeFile(path.join(dir, 'authorization-url.txt'), pending.url, { mode: 0o600 });
    response.statusCode = 302;
    response.setHeader('Location', pending.url);
    return response.end();
  }
  if (url.pathname !== '/auth/callback') {
    response.statusCode = 404;
    return response.end('NABAT local ChatGPT authorization callback.');
  }
  try {
    const pending = transaction.pending;
    if (!pending) throw new Error('Authorization is still preparing.');
    const { code, clientId } = consumePlanCallback(pending, url);
    const credentials = await exchangePlanCode(pending, code, clientId);
    const models = await planModelCatalog();
    const available = models.some((m) => m.slug === 'gpt-6.1-sol');
    await writeFile(
      path.join(dir, 'connection-status.json'),
      JSON.stringify({
        connected: true,
        requestedModel: 'gpt-6.1-sol',
        modelAvailable: available,
        checkedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    console.log(
      `ChatGPT subscription connected. GPT-6.1 Sol available: ${available}. Credentials are protected locally.`,
    );
    response.end(
      available
        ? 'NABAT connected to your ChatGPT subscription. GPT-6.1 Sol is available. You may close this page.'
        : 'Subscription connected, but GPT-6.1 Sol is unavailable in the selected account/workspace.',
    );
    void credentials;
    server.close();
  } catch (e) {
    response.statusCode = 400;
    response.end(
      'NABAT could not complete the subscription connection. Check the terminal for the next step.',
    );
    console.error(e instanceof Error ? e.message : 'Subscription connection failed.');
  }
});
await new Promise<void>((resolve) =>
  server.listen(Number(process.env.NABAT_CHATGPT_CALLBACK_PORT) || 14557, '127.0.0.1', resolve),
);
const address = server.address();
if (!address || typeof address === 'string') throw Error('Callback listener failed');
const pending = begin(address.port);
await writeFile(path.join(dir, 'authorization-url.txt'), pending.url, { mode: 0o600 });
console.log(
  `NABAT subscription connection page: http://127.0.0.1:${address.port}/. Continue with ChatGPT starts a fresh ten-minute authorization attempt. Complete authorization personally in your Business Premium workspace.`,
);
