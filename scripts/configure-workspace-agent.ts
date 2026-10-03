import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';

const project = JSON.parse(await readFile('.vercel/project.json', 'utf8'));
if (project.projectName !== 'nabat-injaz') throw Error('Unexpected Vercel target.');
const nonce = randomBytes(32).toString('hex');
const port = 14558,
  origin = `http://127.0.0.1:${port}`;
const cli = path.join(process.env.APPDATA || '', 'npm/node_modules/vercel/dist/index.js');
const inputSchema = z.object({
  trigger: z.string().regex(/^agtch_[A-Za-z0-9_-]+$/),
  workspace: z.uuid(),
  token: z.string().min(20).max(4096),
  budget: z.literal('confirmed'),
});
let saving = false;
async function setSecret(key: string, value: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        'env',
        'add',
        key,
        'production',
        '--sensitive',
        '--force',
        '--yes',
        '--scope',
        project.orgId,
      ],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
    );
    child.on('error', () => reject(new Error(`Could not configure ${key}.`)));
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Could not configure ${key}.`)),
    );
    child.stdin.end(value);
  });
}
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.statusCode = 400;
    return res.end('Invalid local host.');
  }
  if (req.method === 'GET' && req.url === '/')
    return res.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NABAT · Connect Workspace Agent</title><style>body{margin:0;background:#f7f6ef;color:#153d32;font:16px/1.55 system-ui}main{max-width:640px;margin:64px auto;padding:28px}h1{font:38px/1.1 Georgia}label{display:block;margin:20px 0 6px}input:not([type=checkbox]){box-sizing:border-box;width:100%;padding:13px;font:inherit;border:1px solid #bdc9bf;border-radius:7px}button{margin-top:24px;padding:14px 22px;background:#153d32;color:white;border:0;border-radius:8px;font:inherit}small{display:block;color:#526258}.check{display:flex;align-items:start;gap:10px}.check input{margin-top:5px}input:focus-visible,button:focus-visible{outline:3px solid #ad571d;outline-offset:3px}</style><main><b>NABAT</b><h1>Connect your Workspace Agent.</h1><p>Target: <strong>nabat-injaz.vercel.app</strong>. Model: <strong>GPT-5.6 Luna</strong>. The workspace access token is sent to this project's encrypted Vercel server configuration. It never enters chat or source files.</p><form method="post" action="/configure"><input type="hidden" name="nonce" value="${nonce}"><label>API channel trigger ID<input name="trigger" placeholder="agtch_…" required autocomplete="off"></label><label>NABAT workspace ID<input name="workspace" placeholder="Copy from your NABAT Settings" required autocomplete="off"></label><label>Workspace Agent access token<input name="token" type="password" required autocomplete="off"></label><label class="check"><input name="budget" type="checkbox" value="confirmed" required><span>I verified GPT-5.6 Luna and the intended Business allowance, with no extra credit purchases or auto top-up.</span></label><small>This scopes dispatch to one NABAT workspace. No model API key or billing fallback is configured. Connection activation remains pending deployment and a real end-to-end check.</small><button type="submit">Save encrypted server configuration</button></form></main></html>`,
    );
  if (
    req.method !== 'POST' ||
    req.url !== '/configure' ||
    req.headers.origin !== origin ||
    !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
  ) {
    res.statusCode = 403;
    return res.end('Request not permitted.');
  }
  if (saving) {
    res.statusCode = 409;
    return res.end('Configuration is already in progress.');
  }
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 12000) {
      res.statusCode = 413;
      res.end('Request is too large.');
      return;
    }
    chunks.push(chunk);
  }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const received = Buffer.from(fields.get('nonce') || ''),
    expected = Buffer.from(nonce);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    res.statusCode = 403;
    return res.end('The setup attempt could not be verified.');
  }
  try {
    const input = inputSchema.parse(Object.fromEntries(fields));
    saving = true;
    for (const [key, value] of Object.entries({
      WORKSPACE_AGENT_TRIGGER_ID: input.trigger,
      WORKSPACE_AGENT_ACCESS_TOKEN: input.token,
      WORKSPACE_AGENT_NABAT_WORKSPACE_ID: input.workspace,
      WORKSPACE_AGENT_BUDGET_CONFIRMED: 'true',
    }))
      await setSecret(key, value);
    await writeFile(
      'data/workspace-agent-configuration.json',
      JSON.stringify({
        configured: true,
        triggerId: input.trigger,
        workspaceId: input.workspace,
        model: 'gpt-5.6-luna',
        savedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    res.end(
      '<p>NABAT Workspace Agent configuration saved encrypted on Vercel. No live analysis has been started. Return to Codex to complete deployment and the end-to-end check.</p>',
    );
    server.close();
    console.log(
      'Workspace Agent configuration saved. No token was printed or stored in local source files.',
    );
  } catch {
    saving = false;
    res.statusCode = 400;
    res.end(
      '<p>Check the fields or Vercel CLI sign-in, then return to the setup page. Configuration was not activated.</p>',
    );
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`NABAT protected Workspace Agent setup: ${origin}/`),
);
