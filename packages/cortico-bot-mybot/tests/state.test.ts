import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LONG_TERM_BUDGET_TOKENS, longTermFiles, longTermTokens, pendingFiles, shortTerm, todayUsage } from '../server/state.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A corti-soulmate workspace with the given files (relative path → text). */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mybot-ws-'));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text, 'utf8');
  }
  return dir;
}

it('a long-term file edited after the prefix was built is reported as waiting for the next prefix', () => {
  const dir = workspace({ 'CONSTITUTION.md': '# 我是谁\n\n安静、好奇。\n', 'memo/plan.md': '周末去海边', 'people/1.md': '小包' });
  const prefix = 'ORIENTATION\n# 我是谁\n\n安静、好奇。\nMEMO 周末去海边';
  expect(pendingFiles(longTermFiles(dir, prefix))).toEqual([]);
  writeFileSync(join(dir, 'CONSTITUTION.md'), '# 我是谁\n\n安静、好奇，说话带点俏皮。\n', 'utf8');
  const files = longTermFiles(dir, prefix);
  expect(pendingFiles(files)).toEqual(['CONSTITUTION.md']);
  expect(files.find((file) => file.path === 'memo/plan.md')?.inPrefix).toBe(true);
});

it('people/ is listed with its count and does not count toward what the prefix pays for', () => {
  const dir = workspace({ 'CONSTITUTION.md': '短', 'people/1.md': '一个人的很长很长的档案'.repeat(50), 'people/2.md': '另一个人' });
  const files = longTermFiles(dir, '短');
  const people = files.find((file) => file.path === 'people/')!;
  expect(people).toMatchObject({ what: '认识的人（2 位）', inPrefix: null });
  expect(people.tokens).toBeGreaterThan(0);
  expect(longTermTokens(files)).toBe(files.find((file) => file.path === 'CONSTITUTION.md')!.tokens);
  expect(longTermTokens(files)).toBeLessThan(LONG_TERM_BUDGET_TOKENS);
});

it('the short tier lists memo/active newest first, counts the archive and lists handoff notes', () => {
  const dir = workspace({ 'memo/active/old.md': 'a', 'memo/active/new.md': 'b', 'memo/archived/x.md': 'c', 'memo/archived/y.md': 'd', 'handoffs/2026-10-23.md': 'note' });
  utimesSync(join(dir, 'memo/active/old.md'), new Date('2026-10-01'), new Date('2026-10-01'));
  utimesSync(join(dir, 'memo/active/new.md'), new Date('2026-10-20'), new Date('2026-10-20'));
  const short = shortTerm(dir);
  expect(short.memoActive.map((file) => file.name)).toEqual(['new.md', 'old.md']);
  expect(short.archived).toBe(2);
  expect(short.handoffs).toMatchObject([{ name: '2026-10-23.md', bytes: 4 }]);
  expect(shortTerm(workspace({}))).toEqual({ memoActive: [], archived: 0, handoffs: [] });
});

it("today's usage counts only rows of the local calendar day and skips lines it cannot read", () => {
  const dir = workspace({});
  const now = new Date(2026, 9, 24, 15, 0);
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
  writeFileSync(join(dir, 'usage.jsonl'), [
    JSON.stringify({ ts: at(24, 9), promptTokens: 1000, cacheHitTokens: 900 }),
    JSON.stringify({ ts: at(24, 14), promptTokens: 500, cacheHitTokens: 0 }),
    JSON.stringify({ ts: at(23, 23), promptTokens: 7000, cacheHitTokens: 7000 }),
    '{ not json',
    '',
  ].join('\n'), 'utf8');
  expect(todayUsage(dir, now)).toEqual({ requests: 2, promptTokens: 1500, cachedTokens: 900 });
  expect(todayUsage(workspace({}), now)).toEqual({ requests: 0, promptTokens: 0, cachedTokens: 0 });
});
