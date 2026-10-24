import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ChatGptAuth, RESOURCE } from '../server/auth.ts';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

/** Local OAuth issuer: real authorization codes, PKCE verification, JWT signatures and rotating sessions. */
async function issuer() {
  const dir = mkdtempSync(join(tmpdir(), 'mybot-oauth-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'local-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, URLSearchParams>();
  let counter = 0; let refreshes = 0; let activeRefresh = ''; let base = ''; let fault = '';
  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url!, base);
    if (url.pathname === '/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; }
    if (url.pathname === '/discovery') { res.end(JSON.stringify({ revocation_endpoint: `${base}/revoke` })); return; }
    if (url.pathname === '/authorize') {
      const code = `code-${++counter}`; codes.set(code, url.searchParams);
      const redirect = new URL(url.searchParams.get('redirect_uri')!);
      redirect.search = new URLSearchParams({ code, state: url.searchParams.get('state')!, client_id: 'issued-local-client' }).toString();
      res.writeHead(302, { location: redirect.href }).end(); return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    if (url.pathname === '/revoke') { activeRefresh = ''; res.end(); return; }
    if (url.pathname !== '/token') { res.writeHead(404).end(); return; }
    if (form.get('client_id') !== 'issued-local-client' || form.get('resource') !== RESOURCE) { res.writeHead(400).end(); return; }
    let nonce: string | undefined;
    if (form.get('grant_type') === 'authorization_code') {
      const attempt = codes.get(form.get('code')!); codes.delete(form.get('code')!);
      if (!attempt || attempt.get('redirect_uri') !== form.get('redirect_uri')
        || createHash('sha256').update(form.get('code_verifier')!).digest('base64url') !== attempt.get('code_challenge')) { res.writeHead(400).end(); return; }
      nonce = fault === 'nonce' ? 'wrong-nonce' : attempt.get('nonce')!;
    } else {
      if (form.get('refresh_token') !== activeRefresh || !activeRefresh) { res.writeHead(400).end(); return; }
      refreshes++;
    }
    activeRefresh = `local-refresh-${++counter}`;
    const signingKey = fault === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey;
    const idToken = await new SignJWT({ nonce, email: 'operator@example.test' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setSubject('local-user').setIssuer(fault === 'issuer' ? 'https://wrong.test' : base)
      .setAudience(fault === 'audience' ? 'other-client' : 'issued-local-client').setIssuedAt()
      .setExpirationTime(fault === 'expiry' ? Math.floor(Date.now() / 1000) - 60 : '1h').sign(signingKey);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ access_token: `local-access-${counter}`, refresh_token: activeRefresh, id_token: idToken,
      token_type: 'Bearer', expires_in: 3600, scope: fault === 'scope' ? 'openid' : 'openid resource.invoke chatgpt.tokens.use.direct offline_access' }));
  })().catch(() => res.writeHead(500).end()); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const endpoints = { issuer: base, authorize: `${base}/authorize`, token: `${base}/token`, jwks: `${base}/jwks`, discovery: `${base}/discovery` };
  const auth = new ChatGptAuth(dir, endpoints); cleanup.push(() => auth.cancel());
  return { auth, dir, endpoints, refreshes: () => refreshes, invalid: (reason: string) => { fault = reason; } };
}

it('registers with PKCE, validates identity, persists and resumes without exposing credentials in status', async () => {
  const { auth, dir, endpoints } = await issuer();
  const login = await auth.begin(); const url = new URL(login.url);
  expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect((await fetch(login.url)).ok).toBe(true);
  expect(auth.status()).toMatchObject({ signedIn: true, email: 'operator@example.test' });
  expect(JSON.stringify(auth.status())).not.toMatch(/local-access|local-refresh|idToken/);
  expect(await new ChatGptAuth(dir, endpoints).accessToken()).toMatch(/^local-access-/);
  const second = await auth.begin();
  expect(new URL(second.url).searchParams.get('client_id')).toBe('issued-local-client');
  expect(new URL(second.url).searchParams.get('ext_agent_host_id')).toBe(url.searchParams.get('ext_agent_host_id'));
});

it('rejects invalid state without consuming the legitimate login', async () => {
  const { auth } = await issuer(); const { url } = await auth.begin();
  const callback = new URL(new URL(url).searchParams.get('redirect_uri')!);
  callback.search = 'code=untrusted&state=wrong&client_id=untrusted';
  expect((await fetch(callback)).status).toBe(400);
  expect(auth.status().pending).toBe(true);
  expect((await fetch(url)).ok).toBe(true);
});

it.each(['nonce', 'scope', 'signature', 'issuer', 'audience', 'expiry'])('rejects a token with wrong %s and keeps credentials absent', async failure => {
  const local = await issuer(); local.invalid(failure);
  const login = await local.auth.begin();
  expect((await fetch(login.url)).status).toBe(400);
  expect(local.auth.status().signedIn).toBe(false);
  expect(local.auth.status().pending).toBe(false);
});

it('serializes rotating refresh tokens across two account instances and persists both replacements together', async () => {
  const local = await issuer(); await fetch((await local.auth.begin()).url);
  const file = join(local.dir, 'chatgpt-auth', 'account.json');
  const stored = JSON.parse(readFileSync(file, 'utf8')); stored.expiresAt = 0; writeFileSync(file, JSON.stringify(stored));
  const other = new ChatGptAuth(local.dir, local.endpoints);
  const values = await Promise.all([local.auth.accessToken(), other.accessToken()]);
  expect(values[0]).toBe(values[1]); expect(local.refreshes()).toBe(1);
  const updated = JSON.parse(readFileSync(file, 'utf8'));
  expect(updated.refreshToken).not.toBe(stored.refreshToken);
  expect(updated.accessToken).toBe(values[0]);
});

it('revokes on logout, removes tokens and preserves the issued registration and host', async () => {
  const local = await issuer(); const initial = await local.auth.begin(); await fetch(initial.url);
  expect(await local.auth.logout()).toEqual({ revoked: true });
  expect(local.auth.status().signedIn).toBe(false);
  await expect(local.auth.accessToken()).rejects.toThrow('Sign in');
  const saved = readFileSync(join(local.dir, 'chatgpt-auth', 'account.json'), 'utf8');
  expect(saved).not.toMatch(/accessToken|refreshToken|idToken/);
  const returning = new URL((await local.auth.begin()).url);
  expect(returning.searchParams.get('client_id')).toBe('issued-local-client');
  expect(returning.searchParams.get('ext_agent_host_id')).toBe(new URL(initial.url).searchParams.get('ext_agent_host_id'));
});
