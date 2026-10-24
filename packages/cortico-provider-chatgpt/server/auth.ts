import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const RESOURCE = 'https://api.openai.com/v1';
export const ISSUER = 'https://auth.openai.com';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export interface AuthEndpoints { issuer: string; authorize: string; token: string; jwks: string; discovery: string }
const ENDPOINTS: AuthEndpoints = {
  issuer: ISSUER, authorize: `${ISSUER}/api/accounts/authorize`, token: `${ISSUER}/api/accounts/oauth/token`,
  jwks: `${ISSUER}/.well-known/jwks.json`, discovery: `${ISSUER}/.well-known/openid-configuration`,
};
interface Credentials {
  clientId: string; subject: string; email?: string; accessToken?: string; refreshToken?: string;
  idToken?: string; expiresAt?: number; scopes?: string[]; welcomed?: boolean;
}
interface Pending {
  state: string; nonce: string; verifier: string; redirect: string; clientId?: string; subject?: string;
  server: Server; timer: ReturnType<typeof setTimeout>; expiresAt: number; busy: boolean;
}
export interface AccountState { signedIn: boolean; email?: string; pending: boolean; error?: string; expiresAt?: number; needsWelcome: boolean }

function read<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Cannot read ChatGPT credential storage'); }
}

/** A separate protected directory holds credentials and rotating-token locks. */
function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-[\d-]+/)?.[0];
    if (!sid) throw new Error('Cannot identify credential owner');
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe' });
  }
}

export class ChatGptAuth {
  private readonly dir: string;
  private readonly file: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private pending?: Pending;
  private error?: string;
  private requests = new AbortController();
  get signal() { return this.requests.signal; }
  constructor(stateDir: string, private endpoints: AuthEndpoints = ENDPOINTS) {
    this.dir = join(stateDir, 'chatgpt-auth');
    this.file = join(this.dir, 'account.json');
    this.jwks = createRemoteJWKSet(new URL(endpoints.jwks));
  }
  status(): AccountState {
    const stored = read<Credentials>(this.file);
    return { signedIn: !!stored?.refreshToken && !!stored.scopes?.includes('chatgpt.tokens.use.direct'),
      email: stored?.email, expiresAt: stored?.expiresAt, pending: !!this.pending, error: this.error, needsWelcome: !!stored?.refreshToken && !stored.welcomed };
  }
  private write(value: Credentials) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameSync(temp, this.file); }
    finally { rmSync(temp, { force: true }); }
  }
  /** Serializes session mutations across bot processes sharing this endpoint. */
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    privateDirectory(this.dir);
    const lock = join(this.dir, 'session.lock');
    const until = Date.now() + 35_000;
    for (;;) {
      try { mkdirSync(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { recursive: true }); } catch { /* The other process released its lock. */ }
        if (Date.now() > until) throw new Error('ChatGPT account is busy; retry shortly');
        await delay(100);
      }
    }
    try { return await fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  private async token(form: Record<string, string>) {
    const response = await fetch(this.endpoints.token, {
      method: 'POST', body: new URLSearchParams({ ...form, resource: RESOURCE }),
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`ChatGPT authorization failed (HTTP ${response.status}); sign in again`);
    const data = await response.json() as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string'
      || typeof data.expires_in !== 'number' || data.expires_in <= 0 || String(data.token_type).toLowerCase() !== 'bearer')
      throw new Error('ChatGPT returned an incomplete token response');
    return data;
  }
  cancel() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = undefined; }
  }
  async begin(): Promise<{ url: string; expiresAt: number }> {
    this.cancel(); this.error = undefined;
    const { stored, hostId } = await this.locked(async () => {
      const hostFile = join(this.dir, 'host.json');
      let host = read<{ id: string }>(hostFile);
      if (!host) { host = { id: `urn:uuid:${randomUUID()}` }; writeFileSync(hostFile, JSON.stringify(host), { mode: 0o600 }); }
      return { stored: read<Credentials>(this.file), hostId: host.id };
    });
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const attempt = this.pending;
      if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
      if (!attempt || url.searchParams.get('state') !== attempt.state || attempt.busy) { res.writeHead(400).end('Invalid authorization state'); return; }
      attempt.busy = true;
      void this.complete(url, attempt).then(() => {
        res.end('ChatGPT authorization completed. You can return to myBot. / 授权完成，请返回 myBot。');
      }).catch(() => {
        this.error = 'ChatGPT sign-in failed or was cancelled. Please try again.';
        res.writeHead(400).end(this.error);
      }).finally(() => { if (this.pending === attempt) this.cancel(); });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = (server.address() as { port: number }).port;
    const redirect = `http://127.0.0.1:${port}/auth/callback`;
    const expiresAt = Date.now() + 10 * 60_000;
    const timer = setTimeout(() => { this.cancel(); this.error = 'ChatGPT sign-in timed out'; }, 10 * 60_000);
    timer.unref();
    this.pending = { state, nonce, verifier, redirect, server, timer, expiresAt, busy: false, clientId: stored?.clientId, subject: stored?.subject };
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      client_id: stored?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: hostId,
      ...(!stored?.clientId ? { agent_name_hint: 'myBot' } : {}),
      response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString();
    return { url: url.href, expiresAt };
  }
  private async complete(url: URL, attempt: Pending) {
    if (url.searchParams.has('error')) throw new Error('Authorization declined');
    const code = url.searchParams.get('code');
    const clientId = url.searchParams.get('client_id') ?? attempt.clientId;
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (attempt.clientId && attempt.clientId !== clientId)) throw new Error('Invalid registration');
    await this.locked(async () => {
      const data = await this.token({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirect });
      if (typeof data.id_token !== 'string') throw new Error('Missing identity');
      const { payload } = await jwtVerify(data.id_token, this.jwks, {
        issuer: this.endpoints.issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
        algorithms: ['RS256', 'ES256'],
      });
      if (payload.nonce !== attempt.nonce || (attempt.subject && payload.sub !== attempt.subject)) throw new Error('Identity mismatch');
      const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : [];
      if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw new Error('Plan permission not granted');
      if (this.pending !== attempt) throw new Error('Authorization cancelled');
      const prior = read<Credentials>(this.file);
      this.write({ clientId, subject: payload.sub!, email: typeof payload.email === 'string' ? payload.email : undefined,
        accessToken: data.access_token as string, refreshToken: data.refresh_token as string, idToken: data.id_token,
        expiresAt: Date.now() + (data.expires_in as number) * 1000, scopes, welcomed: prior?.welcomed });
    });
  }
  async accessToken(): Promise<string> {
    return this.locked(async () => {
      const saved = read<Credentials>(this.file);
      if (!saved?.refreshToken || !saved.scopes?.includes('chatgpt.tokens.use.direct')) throw new Error('Sign in with ChatGPT first');
      if (saved.accessToken && (saved.expiresAt ?? 0) > Date.now() + 30_000) return saved.accessToken;
      const data = await this.token({ grant_type: 'refresh_token', client_id: saved.clientId, refresh_token: saved.refreshToken });
      const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : saved.scopes;
      if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan permission is no longer granted');
      const updated = { ...saved, accessToken: data.access_token as string, refreshToken: data.refresh_token as string,
        expiresAt: Date.now() + (data.expires_in as number) * 1000, scopes };
      this.write(updated);
      return updated.accessToken;
    });
  }
  async logout(): Promise<{ revoked: boolean }> {
    this.cancel();
    this.requests.abort(new Error('ChatGPT signed out')); this.requests = new AbortController();
    return this.locked(async () => {
      const saved = read<Credentials>(this.file);
      let revoked = !saved?.refreshToken;
      if (saved?.refreshToken) {
        try {
          const discovery = await fetch(this.endpoints.discovery, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
          const metadata = await discovery.json() as { revocation_endpoint?: string };
          if (!metadata.revocation_endpoint || new URL(metadata.revocation_endpoint).origin !== this.endpoints.issuer) throw new Error('Invalid revocation endpoint');
          for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
            if (attempt) await delay(300);
            const result = await fetch(metadata.revocation_endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
              body: new URLSearchParams({ token: saved.refreshToken, token_type_hint: 'refresh_token', client_id: saved.clientId }) });
            revoked = result.status === 200;
            if (result.status < 500) break;
          }
        } catch { /* The local session still ends; the receipt reports unconfirmed revocation. */ }
      }
      if (saved) this.write({ clientId: saved.clientId, subject: saved.subject, email: saved.email, welcomed: saved.welcomed });
      this.error = undefined;
      return { revoked };
    });
  }
  async acknowledgePlanUse() {
    await this.locked(async () => { const saved = read<Credentials>(this.file); if (saved?.refreshToken) this.write({ ...saved, welcomed: true }); });
  }
}
