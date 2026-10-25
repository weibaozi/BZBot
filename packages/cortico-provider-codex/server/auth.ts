import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export interface OAuthEndpoints { issuer: string; authorize: string; token: string; jwks: string; clientId: string; port: number }
const ENDPOINTS: OAuthEndpoints = { issuer: 'https://auth.openai.com', authorize: 'https://auth.openai.com/oauth/authorize',
  token: 'https://auth.openai.com/oauth/token', jwks: 'https://auth.openai.com/.well-known/jwks.json',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', port: 1455 };
interface Credentials { accessToken: string; refreshToken: string; accountId: string; email?: string; expiresAt: number }
interface Pending { state: string; verifier: string; nonce: string; redirect: string; server: Server; timer: ReturnType<typeof setTimeout>; busy: boolean }

/** Credentials belong to this provider, never the user's CLI session. */
export class CodexAuth {
  private readonly dir: string;
  private readonly file: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private pending?: Pending;
  private error?: string;
  private requests = new AbortController();
  get signal() { return this.requests.signal; }
  constructor(stateDir: string, private readonly endpoints: OAuthEndpoints = ENDPOINTS) {
    this.dir = join(stateDir, 'codex-auth'); this.file = join(this.dir, 'account.json');
    this.jwks = createRemoteJWKSet(new URL(endpoints.jwks), { timeoutDuration: 15_000 });
  }
  private read(): Credentials | undefined {
    try { return JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Cannot read Codex credentials'); }
  }
  private prepare() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
      const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-[\d-]+/)?.[0];
      if (!sid) throw new Error('Cannot identify credential owner');
      execFileSync('icacls', [this.dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe' });
    }
  }
  private async locked<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.prepare(); const lock = join(this.dir, 'refresh.lock'); const until = Date.now() + 35_000;
    for (;;) {
      signal?.throwIfAborted();
      try { mkdirSync(lock); break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { recursive: true }); } catch { /* released */ }
        if (Date.now() > until) throw new Error('Codex account is busy; try again');
        await delay(100, undefined, { signal });
      }
    }
    try { return await fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  private write(credentials: Credentials) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, JSON.stringify(credentials), { mode: 0o600 }); renameSync(temp, this.file); }
    finally { rmSync(temp, { force: true }); }
  }
  status() { const c = this.read(); return { signedIn: !!c?.refreshToken, email: c?.email, pending: !!this.pending, error: this.error }; }
  cancel() { if (this.pending) { clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = undefined; } }
  stop() { this.cancel(); this.requests.abort(new Error('Codex provider stopped')); }
  async logout() { this.cancel(); this.requests.abort(new Error('Codex signed out')); this.requests = new AbortController();
    await this.locked(async () => { rmSync(this.file, { force: true }); }); }

  private async exchange(form: Record<string, string>, signal?: AbortSignal) {
    const res = await fetch(this.endpoints.token, { method: 'POST', redirect: 'error',
      body: new URLSearchParams({ ...form, client_id: this.endpoints.clientId }),
      signal: AbortSignal.any([AbortSignal.timeout(20_000), this.signal, ...(signal ? [signal] : [])]) });
    if (!res.ok) throw new Error(`Codex token exchange failed (HTTP ${res.status}); sign in again`);
    const data = await res.json() as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number' || data.expires_in <= 0)
      throw new Error('Incomplete Codex token response');
    return data;
  }
  async credentials(signal?: AbortSignal): Promise<Credentials> {
    return this.locked(async () => {
      const saved = this.read(); if (!saved?.refreshToken) throw new Error('Sign in with Codex first');
      if (saved.expiresAt > Date.now() + 30_000) return saved;
      const data = await this.exchange({ grant_type: 'refresh_token', refresh_token: saved.refreshToken }, signal);
      const next = { ...saved, accessToken: data.access_token as string,
        refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : saved.refreshToken,
        expiresAt: Date.now() + (data.expires_in as number) * 1000 };
      this.write(next); return next;
    }, signal);
  }
  async begin(): Promise<{ url: string }> {
    this.cancel(); this.error = undefined;
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url'), nonce = randomBytes(24).toString('base64url');
    const server = createServer((req, res) => { void (async () => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const p = this.pending; const url = new URL(req.url ?? '/', 'http://localhost');
      if (!p || req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404).end('Not found'); return; }
      if (url.searchParams.get('state') !== p.state || p.busy) { res.writeHead(400).end('Invalid or reused login state'); return; }
      p.busy = true;
      try {
        const code = url.searchParams.get('code'); if (!code) throw new Error('Codex authorization was not completed');
        const data = await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: p.redirect, code_verifier: p.verifier });
        if (typeof data.id_token !== 'string' || typeof data.refresh_token !== 'string') throw new Error('Incomplete Codex login');
        const { payload } = await jwtVerify(data.id_token, this.jwks, { issuer: this.endpoints.issuer, audience: this.endpoints.clientId });
        if (payload.nonce !== p.nonce) throw new Error('Codex login nonce mismatch');
        const claim = payload['https://api.openai.com/auth'] as { chatgpt_account_id?: string } | undefined;
        if (!claim?.chatgpt_account_id) throw new Error('Codex login did not return an account id');
        await this.locked(async () => {
          if (this.pending !== p) throw new Error('Codex login cancelled');
          this.write({ accessToken: data.access_token as string, refreshToken: data.refresh_token as string,
            accountId: claim.chatgpt_account_id!, email: typeof payload.email === 'string' ? payload.email : undefined,
            expiresAt: Date.now() + (data.expires_in as number) * 1000 });
        });
        res.end('Codex 登录完成，可以关闭此页并返回 myBot。');
      } catch (error) { this.error = error instanceof Error ? error.message : 'Codex login failed'; res.writeHead(400).end('登录失败，请返回 myBot 查看状态并重试。'); }
      finally { if (this.pending === p) this.cancel(); }
    })(); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.endpoints.port, '127.0.0.1', resolve); });
    const port = (server.address() as { port: number }).port;
    const redirect = `http://localhost:${port}/auth/callback`;
    const timer = setTimeout(() => { this.error = 'Codex login expired'; this.cancel(); }, 600_000); timer.unref();
    this.pending = { server, timer, state, verifier, nonce, redirect, busy: false };
    const url = new URL(this.endpoints.authorize);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: this.endpoints.clientId, redirect_uri: redirect,
      scope: 'openid profile email offline_access', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', state, nonce, id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true' })) url.searchParams.set(key, value);
    return { url: url.href };
  }
}
