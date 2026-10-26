import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as Database } from 'node:sqlite';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/**
 * 一个片段。`kind` 是 `chat`(一段聊天原文)或 `file`(记忆文件里的一节)。
 * `channel` 决定谁能搜到:`private:<QQ号>`、`group:<群号>`、`console`,文件按所在目录推定(见 indexer)。
 * `people` 是参与者 QQ 号,两头加逗号(`,361270936,123,`),便于按人筛。
 */
export interface Chunk {
  id: number; kind: 'chat' | 'file'; source: string; channel: string; people: string;
  tsStart: number; tsEnd: number; text: string; hash: string;
  cursorFrom: number | null; cursorTo: number | null;
}
export type NewChunk = Omit<Chunk, 'id'>;

/**
 * 知识库索引:`<部署>/data/kb/kb.sqlite`。全是派生数据,删掉可以从事件库和记忆文件重建。
 * 全文检索用 FTS5 的 trigram 分词(中文按三字切,能搜词组);向量以 Float32 存在 chunks 里,检索时暴力点积。
 */
export class KbStore {
  readonly db: Database;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL,
        people TEXT NOT NULL DEFAULT '', tsStart INTEGER NOT NULL, tsEnd INTEGER NOT NULL, text TEXT NOT NULL,
        hash TEXT NOT NULL, cursorFrom INTEGER, cursorTo INTEGER, vector BLOB);
      CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source);
      CREATE INDEX IF NOT EXISTS chunks_channel ON chunks(channel, tsEnd);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='trigram');
      CREATE TABLE IF NOT EXISTS stats (chunkId INTEGER PRIMARY KEY, recallCount INTEGER NOT NULL DEFAULT 0, lastRecalledAt INTEGER);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }

  get(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value;
  }
  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  add(chunk: NewChunk): number {
    const id = Number(this.db.prepare(`INSERT INTO chunks(kind,source,channel,people,tsStart,tsEnd,text,hash,cursorFrom,cursorTo)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(chunk.kind, chunk.source, chunk.channel, chunk.people, chunk.tsStart, chunk.tsEnd,
      chunk.text, chunk.hash, chunk.cursorFrom, chunk.cursorTo).lastInsertRowid);
    this.db.prepare('INSERT INTO chunks_fts(rowid,text) VALUES(?,?)').run(id, chunk.text);
    return id;
  }
  remove(ids: readonly number[]): void {
    for (const id of ids) {
      this.db.prepare('DELETE FROM chunks WHERE id=?').run(id);
      this.db.prepare('DELETE FROM chunks_fts WHERE rowid=?').run(id);
      this.db.prepare('DELETE FROM stats WHERE chunkId=?').run(id);
    }
  }
  bySource(source: string): Chunk[] {
    return this.db.prepare('SELECT * FROM chunks WHERE source=?').all(source) as unknown as Chunk[];
  }
  /** 以某个前缀开头的来源(一个文件的所有节、或某个聊天的所有片段)。 */
  sourcesWithPrefix(prefix: string): string[] {
    return (this.db.prepare("SELECT DISTINCT source FROM chunks WHERE substr(source,1,length(?))=?").all(prefix, prefix) as Array<{ source: string }>).map((r) => r.source);
  }
  chunk(id: number): Chunk | undefined {
    return this.db.prepare('SELECT * FROM chunks WHERE id=?').get(id) as unknown as Chunk | undefined;
  }

  missingVectors(limit: number): Array<{ id: number; text: string }> {
    return this.db.prepare('SELECT id, text FROM chunks WHERE vector IS NULL ORDER BY id LIMIT ?').all(limit) as Array<{ id: number; text: string }>;
  }
  setVector(id: number, vector: Float32Array): void {
    this.db.prepare('UPDATE chunks SET vector=? WHERE id=?').run(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), id);
  }
  clearVectors(): void { this.db.exec('UPDATE chunks SET vector=NULL'); }
  vectors(): Array<{ id: number; vector: Float32Array }> {
    return (this.db.prepare('SELECT id, vector FROM chunks WHERE vector IS NOT NULL').all() as Array<{ id: number; vector: Uint8Array }>)
      .map((r) => ({ id: r.id, vector: new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength)) }));
  }

  /** FTS5 检索,按 bm25 排序(越小越相关);`match` 由调用方拼好。 */
  fullText(match: string, limit: number): Array<{ id: number; rank: number }> {
    return this.db.prepare('SELECT rowid AS id, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(match, limit) as Array<{ id: number; rank: number }>;
  }

  /** 含有这些词(子串)的片段,命中的词多的在前。 */
  containing(words: readonly string[], limit: number): Array<{ id: number; hits: number }> {
    const tally = new Map<number, number>();
    for (const word of words) {
      const pattern = `%${word.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      for (const row of this.db.prepare("SELECT id FROM chunks WHERE text LIKE ? ESCAPE '\\' ORDER BY tsEnd DESC LIMIT ?").all(pattern, limit) as Array<{ id: number }>) {
        tally.set(row.id, (tally.get(row.id) ?? 0) + 1);
      }
    }
    return [...tally].map(([id, hits]) => ({ id, hits })).sort((a, b) => b.hits - a.hits).slice(0, limit);
  }

  recalled(ids: readonly number[], at: number): void {
    for (const id of ids) {
      this.db.prepare(`INSERT INTO stats(chunkId,recallCount,lastRecalledAt) VALUES(?,1,?)
        ON CONFLICT(chunkId) DO UPDATE SET recallCount=recallCount+1, lastRecalledAt=excluded.lastRecalledAt`).run(id, at);
    }
  }

  /** 群聊片段过了保留期就删(事件库里的原文不动)。 */
  expireGroupChats(before: number): number {
    const ids = (this.db.prepare("SELECT id FROM chunks WHERE kind='chat' AND channel LIKE 'group:%' AND tsEnd < ?").all(before) as Array<{ id: number }>).map((r) => r.id);
    this.remove(ids);
    return ids.length;
  }

  reset(): void {
    this.db.exec('DELETE FROM chunks; DELETE FROM chunks_fts; DELETE FROM stats; DELETE FROM meta;');
  }

  counts(): { chat: number; file: number; group: number; vectors: number } {
    const row = this.db.prepare(`SELECT
      SUM(kind='chat') AS chat, SUM(kind='file') AS file, SUM(kind='chat' AND channel LIKE 'group:%') AS grp,
      SUM(vector IS NOT NULL) AS vectors FROM chunks`).get() as { chat: number | null; file: number | null; grp: number | null; vectors: number | null };
    return { chat: row.chat ?? 0, file: row.file ?? 0, group: row.grp ?? 0, vectors: row.vectors ?? 0 };
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close(): void { this.db.close(); }
}
