import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodexAuth } from '../server/auth.ts';
import { issuer } from './fixtures.ts';

it('completes browser OAuth with PKCE and a signed identity, and keeps tokens out of UI state', async () => {
  const local = await issuer();
  expect((await fetch((await local.auth.begin()).url)).ok).toBe(true);
  expect(local.auth.status()).toMatchObject({ signedIn: true, pending: false, email: 'operator@example.test' });
  expect(JSON.stringify(local.auth.status())).not.toMatch(/local-access|local-refresh|local-account/);
  expect((await new CodexAuth(local.dir, local.endpoints).credentials()).accountId).toBe('local-account');
});

it('rejects the wrong state without consuming the pending authorization', async () => {
  const local = await issuer(), { url } = await local.auth.begin();
  const callback = new URL(new URL(url).searchParams.get('redirect_uri')!);
  callback.search = 'code=wrong&state=wrong';
  expect((await fetch(callback)).status).toBe(400); expect(local.auth.status().pending).toBe(true);
  expect((await fetch(url)).ok).toBe(true);
});

it.each(['nonce', 'signature', 'issuer', 'audience', 'expiry'])('rejects invalid %s without saving credentials', async reason => {
  const local = await issuer(); local.invalid(reason);
  expect((await fetch((await local.auth.begin()).url)).status).toBe(400);
  expect(local.auth.status()).toMatchObject({ signedIn: false, pending: false });
});

it('serializes token rotation across independent instances and removes only its own login on logout', async () => {
  const local = await issuer(); await fetch((await local.auth.begin()).url);
  const path = join(local.dir, 'codex-auth', 'account.json'), saved = JSON.parse(readFileSync(path, 'utf8'));
  saved.expiresAt = 0; writeFileSync(path, JSON.stringify(saved));
  const other = new CodexAuth(local.dir, local.endpoints);
  const values = await Promise.all([local.auth.credentials(), other.credentials()]);
  expect(values[0].accessToken).toBe(values[1].accessToken); expect(local.refreshes()).toBe(1);
  expect(values[0].refreshToken).not.toBe(saved.refreshToken);
  await local.auth.logout(); expect(local.auth.status().signedIn).toBe(false);
  await expect(local.auth.credentials()).rejects.toThrow('Sign in');
});
