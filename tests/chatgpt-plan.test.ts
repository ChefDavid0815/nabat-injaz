import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createPlanAuthorization,
  consumePlanCallback,
  verifyPlanIdentity,
  readPlanStream,
  saveCredentials,
  readCredentials,
} from '../src/server/chatgpt-plan';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verifyKeys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  const publicKey = await exportJWK(keys.publicKey);
  verifyKeys = createLocalJWKSet({
    keys: [{ ...publicKey, kid: 'test', alg: 'RS256', use: 'sig' }],
  });
});
const pending = () =>
  createPlanAuthorization('urn:uuid:test', 'http://127.0.0.1:1455/auth/callback');
const callback = (p: ReturnType<typeof pending>) =>
  new URL(`${p.redirectUri}?state=${p.state}&code=fixture&client_id=oaiapp_test`);
describe('subscription credential and stream boundaries', () => {
  it('protects stored subscription credentials and preserves a usable round trip', async () => {
    const old = process.env.NABAT_CHATGPT_DIR;
    process.env.NABAT_CHATGPT_DIR = path.resolve(`data/test-chatgpt-${Date.now()}`);
    const credentials = {
      client_id: 'oaiapp_test',
      subject: 'fixture',
      ext_agent_host_id: 'urn:uuid:test',
      access_token: 'fixture-access-secret',
      refresh_token: 'fixture-refresh-secret',
      id_token: 'fixture-id-token',
      scopes: ['chatgpt.tokens.use.direct'],
      expires_at: Date.now() + 3600000,
    };
    try {
      await saveCredentials(credentials);
      expect(await readCredentials()).toEqual(credentials);
      const file = await readFile(path.join(process.env.NABAT_CHATGPT_DIR, 'active.json'), 'utf8');
      expect(file).not.toContain(credentials.access_token);
      if (process.platform === 'win32') expect(JSON.parse(file).protection).toBe('windows-dpapi');
    } finally {
      if (old) process.env.NABAT_CHATGPT_DIR = old;
      else delete process.env.NABAT_CHATGPT_DIR;
    }
  });
  it('uses PKCE, a stable host and subscription permission without an API key', () => {
    const p = pending(),
      url = new URL(p.url);
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(p.verifier).digest('base64url'),
    );
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(url.searchParams.get('ext_agent_host_id')).toBe('urn:uuid:test');
    expect(url.toString()).not.toContain(p.verifier);
  });
  it('rejects missing, forged, expired and reused callback state', () => {
    const p = pending();
    expect(() => consumePlanCallback(p, new URL(p.redirectUri))).toThrow();
    const wrong = callback(p);
    wrong.searchParams.set('state', 'forged');
    expect(() => consumePlanCallback(p, wrong)).toThrow();
    expect(consumePlanCallback(p, callback(p)).clientId).toBe('oaiapp_test');
    expect(() => consumePlanCallback(p, callback(p))).toThrow();
    const old = pending();
    old.expiresAt = 0;
    expect(() => consumePlanCallback(old, callback(old))).toThrow();
  });
  it('rejects denied consent and a changed returning registration', () => {
    const p = pending(),
      url = callback(p);
    url.searchParams.set('error', 'access_denied');
    expect(() => consumePlanCallback(p, url)).toThrow('declined');
    const returning = createPlanAuthorization('urn:uuid:test', p.redirectUri, 'oaiapp_original');
    expect(() => consumePlanCallback(returning, callback(returning))).toThrow('registration');
  });
  it('verifies signature, issuer, audience, nonce and expiry', async () => {
    const sign = (
      issuer = 'https://auth.openai.com',
      audience = 'oaiapp_test',
      nonce = 'nonce',
      expired = false,
    ) =>
      new SignJWT({ nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject('fixture-subject')
        .setIssuedAt()
        .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 60 : '5m')
        .sign(keys.privateKey);
    expect((await verifyPlanIdentity(await sign(), 'oaiapp_test', 'nonce', verifyKeys)).sub).toBe(
      'fixture-subject',
    );
    for (const token of [
      await sign('https://example.test'),
      await sign(undefined, 'wrong'),
      await sign(undefined, undefined, 'wrong'),
      await sign(undefined, undefined, undefined, true),
    ])
      await expect(verifyPlanIdentity(token, 'oaiapp_test', 'nonce', verifyKeys)).rejects.toThrow();
    const token = await sign();
    await expect(
      verifyPlanIdentity(token.slice(0, -4) + 'AAAA', 'oaiapp_test', 'nonce', verifyKeys),
    ).rejects.toThrow();
  });
  it('handles UTF-8 and CRLF split across arbitrary SSE chunks', async () => {
    const bytes = new TextEncoder().encode(
      'data: ' +
        JSON.stringify({ type: 'response.output_text.delta', delta: '{"evidence":"绿叶"}' }) +
        '\r\n\r\ndata: ' +
        JSON.stringify({ type: 'response.completed' }) +
        '\r\n\r\n',
    );
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    expect(await readPlanStream(new Response(stream))).toBe('{"evidence":"绿叶"}');
  });
  it('does not treat partial output or failed admission as successful analysis', async () => {
    await expect(
      readPlanStream(
        new Response(
          'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '{}' }) + '\n\n',
        ),
      ),
    ).rejects.toThrow('response.completed');
    await expect(
      readPlanStream(
        Response.json(
          { error: { code: 'subscription_sharing_user_not_eligible' } },
          { status: 403 },
        ),
      ),
    ).rejects.toMatchObject({
      retryable: false,
      stopWorker: true,
      status: 403,
      code: 'subscription_sharing_user_not_eligible',
    });
  });
});
