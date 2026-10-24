/**
 * What the overview and memory panels show, read from the deployment's files. Every value is a fact
 * the files or the live session can confirm; nothing here interprets the bot's memory.
 *
 * Layout read (corti-soulmate's workspace): `CONSTITUTION.md`, `WORLDVIEW.md`, `memo/` (top level is
 * resident in the prefix, `memo/active/` lists names only, `memo/archived/` counts only), `people/`,
 * `handoffs/`; and `<data>/usage.jsonl` for the day's requests.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { estimateTokens } from 'cortico/core/util.ts';

/** The long-term tier's token budget until `memory.longTermBudgetTokens` exists (docs/memory.md §3). */
export const LONG_TERM_BUDGET_TOKENS = 2000;

export interface FileEntry { name: string; mtime: string; bytes: number }

export interface LongTermFile {
  path: string;
  what: string;
  tokens: number;
  /** Who may write it while awake / while dreaming (corti-soulmate's write matrix). */
  perm: string;
  /** Whether the file's current text is in the live system prefix; null when the prefix holds only a listing of it. */
  inPrefix: boolean | null;
}

export interface TodayUsage { requests: number; promptTokens: number; cachedTokens: number }

function files(dir: string): FileEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => {
      const info = statSync(join(dir, entry.name));
      return { name: entry.name, mtime: info.mtime.toISOString(), bytes: info.size };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** A file is in the prefix when its whole current text appears there; the prefix renders these files verbatim. */
function inPrefix(text: string, systemText: string): boolean {
  const body = text.trim();
  return body === '' || systemText.includes(body);
}

export function longTermFiles(memoryDir: string, systemText: string): LongTermFile[] {
  const out: LongTermFile[] = [];
  for (const [path, what, perm] of [
    ['CONSTITUTION.md', '人格宪法', '只读 / 可修订'],
    ['WORLDVIEW.md', '对环境的综合认知', '只读 / 读写'],
  ] as const) {
    const abs = join(memoryDir, path);
    if (!existsSync(abs)) continue;
    const text = readText(abs);
    out.push({ path, what, tokens: estimateTokens(text), perm, inPrefix: inPrefix(text, systemText) });
  }
  for (const file of files(join(memoryDir, 'memo')).sort((a, b) => a.name.localeCompare(b.name))) {
    const text = readText(join(memoryDir, 'memo', file.name));
    out.push({ path: `memo/${file.name}`, what: '常驻备忘', tokens: estimateTokens(text), perm: '读写 / 读写', inPrefix: inPrefix(text, systemText) });
  }
  const people = files(join(memoryDir, 'people'));
  if (people.length) {
    const tokens = people.reduce((sum, file) => sum + estimateTokens(readText(join(memoryDir, 'people', file.name))), 0);
    out.push({ path: 'people/', what: `认识的人（${people.length} 位）`, tokens, perm: '追加 / 读写合并', inPrefix: null });
  }
  return out;
}

/** Long-term files whose edits the live prefix does not show yet; they take effect at the next handoff or reload. */
export function pendingFiles(longTerm: readonly LongTermFile[]): string[] {
  return longTerm.filter((file) => file.inPrefix === false).map((file) => file.path);
}

/** Tokens the prefix pays for the long-term tier: resident files only, people/ is read on demand. */
export function longTermTokens(longTerm: readonly LongTermFile[]): number {
  return longTerm.filter((file) => file.inPrefix !== null).reduce((sum, file) => sum + file.tokens, 0);
}

export function shortTerm(memoryDir: string): { memoActive: FileEntry[]; archived: number; handoffs: FileEntry[] } {
  return {
    memoActive: files(join(memoryDir, 'memo', 'active')),
    archived: files(join(memoryDir, 'memo', 'archived')).length,
    handoffs: files(join(memoryDir, 'handoffs')).slice(0, 10),
  };
}

/** Requests recorded in `usage.jsonl` whose timestamp falls on `now`'s local calendar day. */
export function todayUsage(dataDir: string, now = new Date()): TodayUsage {
  const out: TodayUsage = { requests: 0, promptTokens: 0, cachedTokens: 0 };
  const text = readText(join(dataDir, 'usage.jsonl'));
  const today = now.toDateString();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: { ts?: string; promptTokens?: number; cacheHitTokens?: number };
    try { row = JSON.parse(line); } catch { continue; }
    if (!row.ts || new Date(row.ts).toDateString() !== today) continue;
    out.requests += 1;
    out.promptTokens += row.promptTokens ?? 0;
    out.cachedTokens += row.cacheHitTokens ?? 0;
  }
  return out;
}
