import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const credentialSchema = z.object({
  client_id: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().optional(),
  ext_agent_host_id: z.string(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1),
  scopes: z.array(z.string()),
  expires_at: z.number(),
});
export type PlanCredentials = z.infer<typeof credentialSchema>;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string(),
});
export class PlanAccessError extends Error {
  readonly retryable = false;
  readonly stopWorker = true;
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PlanAccessError';
  }
}
export function credentialDirectory() {
  if (process.env.VERCEL)
    throw new PlanAccessError('ChatGPT subscription credentials belong only in the local worker.');
  return path.resolve(process.env.NABAT_CHATGPT_DIR || 'data/chatgpt');
}
async function dpapi(input: Buffer, decrypt: boolean) {
  const action = decrypt ? 'Unprotect' : 'Protect';
  const code = `Add-Type -AssemblyName System.Security; $payload=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[System.Security.Cryptography.ProtectedData]::${action}($payload,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.on('error', () => reject(new Error('Windows credential protection failed.')));
    child.on('exit', (c) =>
      c === 0
        ? resolve(Buffer.from(output.trim(), 'base64'))
        : reject(new Error('Windows credential protection failed.')),
    );
    child.stdin.end(input.toString('base64'));
  });
}
export async function saveCredentials(credentials: PlanCredentials) {
  const dir = credentialDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const plain = Buffer.from(JSON.stringify(credentialSchema.parse(credentials)));
  const protection = process.platform === 'win32' ? 'windows-dpapi' : 'owner-permissions';
  const data = protection === 'windows-dpapi' ? await dpapi(plain, false) : plain;
  const registrations = path.join(dir, 'registrations');
  await mkdir(registrations, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(
      registrations,
      `${createHash('sha256').update(credentials.client_id).digest('hex')}.json`,
    ),
    JSON.stringify({ protection, data: data.toString('base64') }),
    { mode: 0o600 },
  );
  const temporary = path.join(dir, `credentials-${randomBytes(12).toString('hex')}.tmp`);
  await writeFile(temporary, JSON.stringify({ protection, data: data.toString('base64') }), {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temporary, path.join(dir, 'active.json'));
}
export async function readCredentials() {
  let record: { protection: string; data: string };
  try {
    record = JSON.parse(await readFile(path.join(credentialDirectory(), 'active.json'), 'utf8'));
  } catch {
    throw new PlanAccessError('Connect your ChatGPT subscription in the local worker first.');
  }
  const bytes = Buffer.from(record.data, 'base64');
  const plain = record.protection === 'windows-dpapi' ? await dpapi(bytes, true) : bytes;
  return credentialSchema.parse(JSON.parse(plain.toString('utf8')));
}
export function createPlanAuthorization(hostId: string, redirectUri: string, clientId?: string) {
  const state = randomBytes(32).toString('base64url'),
    nonce = randomBytes(32).toString('base64url'),
    verifier = randomBytes(64).toString('base64url');
  const url = new URL(`${issuer}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId || 'dynamic_agent_client',
    ...(!clientId ? { agent_name_hint: 'NABAT Local Analysis' } : {}),
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }).toString();
  return {
    url: url.toString(),
    state,
    nonce,
    verifier,
    redirectUri,
    hostId,
    clientId,
    expiresAt: Date.now() + 600000,
    consumed: false,
  };
}
export type PlanAuthorization = ReturnType<typeof createPlanAuthorization>;
export function consumePlanCallback(pending: PlanAuthorization, callback: URL) {
  const received = Buffer.from(callback.searchParams.get('state') || ''),
    expected = Buffer.from(pending.state);
  if (
    pending.consumed ||
    pending.expiresAt <= Date.now() ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new PlanAccessError('The sign-in attempt expired or could not be verified.');
  pending.consumed = true;
  if (callback.searchParams.has('error'))
    throw new PlanAccessError('ChatGPT authorization was declined.');
  const clientId = callback.searchParams.get('client_id') || pending.clientId;
  if (
    !clientId ||
    clientId === 'dynamic_agent_client' ||
    (pending.clientId && clientId !== pending.clientId)
  )
    throw new PlanAccessError('The ChatGPT client registration could not be verified.');
  const code = callback.searchParams.get('code');
  if (!code) throw new PlanAccessError('The callback did not include an authorization code.');
  return { code, clientId };
}
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export async function verifyPlanIdentity(
  token: string,
  clientId: string,
  nonce?: string,
  keys: JWTVerifyGetKey = jwks,
) {
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: clientId,
    requiredClaims: ['sub', 'exp', 'iat'],
    clockTolerance: 5,
  });
  if (nonce && payload.nonce !== nonce)
    throw new PlanAccessError('The identity token did not match this sign-in attempt.');
  return payload;
}
async function readTokens(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = typeof body.error === 'string' ? body.error : body.error?.code;
    throw new PlanAccessError(
      'ChatGPT subscription authorization needs attention. Reconnect or check workspace policy.',
      response.status,
      code,
      response.headers.get('x-request-id') || undefined,
    );
  }
  const tokens = tokenSchema.parse(await response.json());
  if (!tokens.scope.split(' ').includes('chatgpt.tokens.use.direct'))
    throw new PlanAccessError('The account did not grant ChatGPT subscription usage.');
  return tokens;
}
export async function exchangePlanCode(pending: PlanAuthorization, code: string, clientId: string) {
  const tokens = await readTokens(
    await fetch(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(30000),
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource,
      }),
    }),
  );
  if (!tokens.id_token) throw new PlanAccessError('ChatGPT returned no identity token.');
  const identity = await verifyPlanIdentity(tokens.id_token, clientId, pending.nonce);
  const credentials: PlanCredentials = {
    client_id: clientId,
    subject: identity.sub!,
    ...(typeof identity.email === 'string' ? { email: identity.email } : {}),
    ext_agent_host_id: pending.hostId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    scopes: tokens.scope.split(' '),
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  await saveCredentials(credentials);
  return credentials;
}
export async function planAccessToken() {
  let credentials = await readCredentials();
  if (credentials.expires_at > Date.now() + 120000) return credentials.access_token;
  const lockPath = path.join(credentialDirectory(), 'refresh.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch {
    throw new PlanAccessError(
      'Another worker is refreshing this subscription. Keep only one local worker running.',
    );
  }
  try {
    credentials = await readCredentials();
    if (credentials.expires_at > Date.now() + 120000) return credentials.access_token;
    const tokens = await readTokens(
      await fetch(`${issuer}/api/accounts/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(30000),
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: credentials.client_id,
          refresh_token: credentials.refresh_token,
          resource,
        }),
      }),
    );
    if (tokens.id_token) {
      const identity = await verifyPlanIdentity(tokens.id_token, credentials.client_id);
      if (identity.sub !== credentials.subject)
        throw new PlanAccessError('The refreshed ChatGPT account changed. Reconnect explicitly.');
    }
    const refreshed = {
      ...credentials,
      ...tokens,
      id_token: tokens.id_token || credentials.id_token,
      scopes: tokens.scope.split(' '),
      expires_at: Date.now() + tokens.expires_in * 1000,
    };
    await saveCredentials(refreshed);
    return refreshed.access_token;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
export async function planModelCatalog() {
  const r = await fetch(`${resource}/models`, {
    headers: { Authorization: `Bearer ${await planAccessToken()}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw new PlanAccessError('The subscription model catalog could not be read.', r.status);
  const body = z
    .object({
      models: z.array(
        z.object({
          slug: z.string(),
          display_name: z.string().optional(),
          visibility: z.string().optional(),
        }),
      ),
    })
    .parse(await r.json());
  return body.models.filter((m) => m.visibility === 'list');
}
export async function readPlanStream(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new PlanAccessError(
      'ChatGPT subscription analysis is unavailable. Check plan permissions or usage limits.',
      response.status,
      body.error?.code,
      response.headers.get('x-request-id') || undefined,
    );
  }
  if (!response.body) throw new Error('The analysis stream was missing.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    text = '',
    completed = false,
    total = 0;
  const event = (block: string) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    const e = JSON.parse(data);
    if (e.type === 'response.output_text.delta') text += e.delta;
    if (e.type === 'response.failed' || e.type === 'error')
      throw new PlanAccessError(
        'ChatGPT subscription analysis failed. Check account eligibility and usage.',
        undefined,
        e.response?.error?.code || e.code,
      );
    if (e.type === 'response.completed') completed = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2 * 1024 * 1024) throw new Error('The analysis stream exceeded its size limit.');
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        event(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
  } finally {
    await reader.cancel();
  }
  if (!completed || !text) throw new Error('The analysis stream ended before response.completed.');
  return text;
}
