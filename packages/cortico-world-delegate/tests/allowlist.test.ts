import { expect, it } from 'vitest';
import { allowedUsers, DELEGATE_DEFAULTS } from '../config.ts';

it('allows the global trusted QQ list plus the plugin\'s own list', () => {
  const cfg = { ...DELEGATE_DEFAULTS, allowedQQ: '10001, 0123, abc' };
  expect([...allowedUsers(cfg)]).toEqual(['10001']);
  expect([...allowedUsers(cfg, ['361270936', '10001'])]).toEqual(['361270936', '10001']);
  expect([...allowedUsers({ ...cfg, allowedQQ: '' }, ['361270936'])]).toEqual(['361270936']);
});
