import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listRuns, runsDirOf } from 'cortico/core/run.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';
import type { ModelHub } from 'cortico/providers/model-hub.ts';
import { chatLine, formatLine, isGroupNoise, type ChatLine } from './text.ts';
import type { KbStore, NewChunk } from './store.ts';

export interface IndexOptions {
  dataDir: string;
  memoryDir: string;
  timezone: string;
  /** 两条消息间隔超过这么久就切一段。 */
  gapMinutes: number;
  /** 一段最多这么多条。 */
  maxMessages: number;
  /** 群聊只收她说过话或被 @ 的片段。 */
  groupOnlyParticipated: boolean;
  /** 群聊片段保留天数;0 = 不过期。 */
  groupRetentionDays: number;
  /** 群里短于这么多字的消息当噪音(她自己的和 @ 她的除外)。 */
  groupMinChars: number;
  /** 不进索引的群号。 */
  excludedGroups: ReadonlySet<string>;
  embeddingModel: string;
  models: ModelHub;
  signal?: AbortSignal;
  now?: number;
}
export interface IndexResult { chats: number; files: number; removed: number; expired: number; embedded: number }

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** 读事件库里 cursor 大于 `after` 的聊天消息,按 cursor 升序。 */
export function readLines(dataDir: string, after: number): ChatLine[] {
  const out: ChatLine[] = [];
  for (const run of listRuns(dataDir)) {
    let raw: string;
    try { raw = readFileSync(join(runsDirOf(dataDir), run, 'events.jsonl'), 'utf8'); } catch { continue; }
    for (const text of raw.split('\n')) {
      if (!text.includes('"qq.message"') && !text.includes('"qq.self"') && !text.includes('"console.')) continue;
      let e: EventEnvelope;
      try { e = JSON.parse(text) as EventEnvelope; } catch { continue; }
      if (!Number.isInteger(e.cursor) || e.cursor <= after) continue;
      const line = chatLine(e);
      if (line) out.push(line);
    }
  }
  return out.sort((a, b) => a.cursor - b.cursor);
}

/** 按间隔和条数切窗口。 */
export function windows(lines: readonly ChatLine[], gapMs: number, maxMessages: number): ChatLine[][] {
  const out: ChatLine[][] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last && line.at - last.at(-1)!.at <= gapMs && last.length < maxMessages) last.push(line);
    else out.push([line]);
  }
  return out;
}

function chatChunk(channel: string, lines: ChatLine[], opts: IndexOptions, now: number): NewChunk | null {
  const group = channel.startsWith('group:');
  if (group && opts.groupOnlyParticipated && !lines.some((l) => l.self || l.mentioned)) return null;
  if (group && opts.groupRetentionDays > 0 && lines.at(-1)!.at < now - opts.groupRetentionDays * 86_400_000) return null;
  const kept: ChatLine[] = [];
  for (const line of lines) {
    if (!line.content) continue;
    if (group && isGroupNoise(line, opts.groupMinChars)) continue;
    // 连着复读只留一条。
    if (group && kept.length && kept.at(-1)!.content === line.content) continue;
    kept.push(line);
  }
  if (!kept.length) return null;
  const groupName = lines.find((l) => l.groupName)?.groupName;
  const header = group ? `[群 ${groupName ? `${groupName}(${channel.slice(6)})` : channel.slice(6)}]` : channel === 'console' ? '[控制台]' : `[私聊 ${channel.slice(8)}]`;
  const text = [header, ...kept.map((l) => formatLine(l, opts.timezone))].join('\n');
  const people = [...new Set(kept.filter((l) => !l.self && /^\d+$/.test(l.user)).map((l) => l.user))];
  return {
    kind: 'chat', source: `chat:${channel}:${lines[0].cursor}`, channel, people: people.length ? `,${people.join(',')},` : '',
    tsStart: lines[0].at, tsEnd: lines.at(-1)!.at, text, hash: hash(text), cursorFrom: lines[0].cursor, cursorTo: lines.at(-1)!.cursor,
  };
}

/** 聊天原文:增量切窗口。每个聊天的最后一段还没结束,下次连同新消息一起重切。 */
function indexChats(store: KbStore, opts: IndexOptions, now: number): number {
  const done = Number(store.get('cursor') ?? '0');
  const open = JSON.parse(store.get('open') ?? '{}') as Record<string, number>;
  const from = Math.min(done, ...Object.values(open).map((c) => c - 1));
  const lines = readLines(opts.dataDir, from);
  if (!lines.length) return 0;
  const byChannel = new Map<string, ChatLine[]>();
  for (const line of lines) {
    if (line.channel.startsWith('group:') && opts.excludedGroups.has(line.channel.slice(6))) continue;
    // 已经切完的旧段不再读;只要这个聊天的未结束段和之后的新消息。
    if (open[line.channel] !== undefined ? line.cursor < open[line.channel] : line.cursor <= done) continue;
    const list = byChannel.get(line.channel) ?? [];
    list.push(line);
    byChannel.set(line.channel, list);
  }
  let added = 0;
  store.transaction(() => {
    for (const [channel, list] of byChannel) {
      if (open[channel] !== undefined) store.remove(store.bySource(`chat:${channel}:${open[channel]}`).map((c) => c.id));
      const parts = windows(list, opts.gapMinutes * 60_000, opts.maxMessages);
      for (const part of parts) {
        const chunk = chatChunk(channel, part, opts, now);
        if (chunk) { store.add(chunk); added++; }
      }
      // 最后一段离现在已超过切段间隔,不会再续上,就算结束;否则下次连同新消息重切。
      const last = parts.at(-1)!;
      if (now - last.at(-1)!.at > opts.gapMinutes * 60_000) delete open[channel];
      else open[channel] = last[0].cursor;
    }
    store.set('cursor', String(Math.max(done, lines.at(-1)!.cursor)));
    store.set('open', JSON.stringify(open));
  });
  return added;
}

/** 记忆里不在前缀的部分。`people/`、宪法、WORLDVIEW、常驻和进行中的 memo 已经整篇在前缀里,不索引。 */
function memoryFiles(memoryDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(md|txt)$/i.test(e.name) && !e.name.includes('.tmp-')) out.push(relative(memoryDir, path).replace(/\\/g, '/'));
    }
  };
  for (const dir of ['note', 'memo/archived', 'groups', 'kb']) walk(join(memoryDir, dir));
  if (existsSync(join(memoryDir, 'visual'))) {
    for (const id of readdirSync(join(memoryDir, 'visual'))) if (existsSync(join(memoryDir, 'visual', id, 'entry.md'))) out.push(`visual/${id}/entry.md`);
  }
  return out.sort();
}

/**
 * 文件片段的可见范围:群档案归那个群;图像资料按 entry.md 里的来源;其余是她自己的笔记,算 `file`
 * (只在私聊白名单和控制台里能搜到)。
 */
export function fileChannel(path: string, text: string): string {
  const group = /^groups\/(\d+)\.md$/.exec(path);
  if (group) return `group:${group[1]}`;
  if (path.startsWith('visual/')) {
    const source = /^source:\s*(\S+)/m.exec(text)?.[1];
    const owner = /^owner:\s*(\d+)/m.exec(text)?.[1];
    if (source?.startsWith('group:')) return source;
    if (source === 'private' && owner) return `private:${owner}`;
  }
  return 'file';
}

/** 按标题切节;太长的节再按空行切到 800 字以内。 */
export function sections(text: string, max = 800): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  const flush = () => { const t = current.join('\n').trim(); if (t) parts.push(t); current = []; };
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) flush();
    current.push(line);
  }
  flush();
  return parts.flatMap((part) => {
    if ([...part].length <= max) return [part];
    const out: string[] = [];
    let buf = '';
    for (const para of part.split(/\n\s*\n/)) {
      if (buf && [...buf].length + [...para].length > max) { out.push(buf.trim()); buf = ''; }
      buf += (buf ? '\n\n' : '') + para;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.flatMap((t) => [...t].length <= max ? [t] : [...Array(Math.ceil([...t].length / max)).keys()].map((i) => [...t].slice(i * max, (i + 1) * max).join('')));
  });
}

function indexFiles(store: KbStore, opts: IndexOptions): { files: number; removed: number } {
  const files = memoryFiles(opts.memoryDir);
  const present = new Set(files);
  let changed = 0, removed = 0;
  store.transaction(() => {
    for (const source of store.sourcesWithPrefix('file:')) {
      const path = source.slice(5).replace(/#\d+$/, '');
      if (!present.has(path)) { const ids = store.bySource(source).map((c) => c.id); store.remove(ids); removed += ids.length; }
    }
    for (const path of files) {
      const full = join(opts.memoryDir, path);
      const text = readFileSync(full, 'utf8');
      const digest = hash(text);
      if (store.get(`file:${path}`) === digest) continue;
      for (const source of store.sourcesWithPrefix(`file:${path}#`)) store.remove(store.bySource(source).map((c) => c.id));
      const at = statSync(full).mtimeMs;
      const channel = fileChannel(path, text);
      sections(text).forEach((section, i) => {
        store.add({ kind: 'file', source: `file:${path}#${i}`, channel, people: '', tsStart: at, tsEnd: at,
          text: `[${path}]\n${section}`, hash: hash(section), cursorFrom: null, cursorTo: null });
      });
      store.set(`file:${path}`, digest);
      changed++;
    }
  });
  return { files: changed, removed };
}

export function normalize(vector: readonly number[]): Float32Array {
  const norm = Math.hypot(...vector);
  if (!vector.length || !norm || !Number.isFinite(norm)) throw new Error('Empty embedding vector');
  return Float32Array.from(vector, (n) => n / norm);
}

/** 补向量。换了嵌入模型就清掉旧向量全部重算。没配模型时只有全文检索。 */
async function embed(store: KbStore, opts: IndexOptions): Promise<number> {
  if (!opts.embeddingModel) return 0;
  if (store.get('embeddingModel') !== opts.embeddingModel) { store.clearVectors(); store.set('embeddingModel', opts.embeddingModel); }
  let count = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    const batch = store.missingVectors(16);
    if (!batch.length) return count;
    const vectors = await opts.models.embed(opts.embeddingModel, batch.map((c) => c.text), opts.signal);
    if (vectors.length !== batch.length) throw new Error('Embedding count mismatch');
    store.transaction(() => batch.forEach((c, i) => store.setVector(c.id, normalize(vectors[i]))));
    count += batch.length;
  }
}

/** 一次完整的增量索引:聊天、文件、过期清理、补向量。 */
export async function runIndex(store: KbStore, opts: IndexOptions): Promise<IndexResult> {
  const now = opts.now ?? Date.now();
  const chats = indexChats(store, opts, now);
  const { files, removed } = indexFiles(store, opts);
  const expired = opts.groupRetentionDays > 0 ? store.expireGroupChats(now - opts.groupRetentionDays * 86_400_000) : 0;
  const embedded = await embed(store, opts);
  // 检索那边按这个版本号决定要不要重读向量。
  if (chats || files || removed || expired || embedded) store.set('version', String(now) + ':' + Math.random().toString(36).slice(2, 8));
  store.set('lastRun', String(now));
  return { chats, files, removed, expired, embedded };
}
