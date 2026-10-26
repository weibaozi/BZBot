import type { Chunk, KbStore } from './store.ts';
import type { Scope } from './scope.ts';

export interface SearchOptions {
  scope: Scope;
  /** 毫秒时间戳;片段与 [since, until] 有交集才算。 */
  since?: number; until?: number;
  /** 参与者 QQ 号,有一个对上就算。 */
  people?: readonly string[];
  kind?: 'chat' | 'file';
  k?: number;
  /** 只靠向量命中的片段,余弦相似度至少这么高;全文命中的不受限。 */
  minSimilarity?: number;
  now?: number;
}
export interface Hit {
  id: number; kind: Chunk['kind']; channel: string; people: string[]; tsStart: number; tsEnd: number;
  text: string; score: number; fullText: number | null; vector: number | null;
}

/** 片段类型的权重:她整理过的笔记最可信,其次私聊原文,群聊原文排最后。 */
function weight(chunk: Pick<Chunk, 'kind' | 'channel'>): number {
  if (chunk.kind === 'file') return 1;
  return chunk.channel.startsWith('group:') ? 0.7 : 0.9;
}

function terms(query: string): string[] {
  return [...new Set(query.split(/[\s,，。.!！?？;；:：、"'“”‘’()（）[\]【】<>《》]+/).map((t) => t.trim()).filter(Boolean))];
}

/**
 * 拼 FTS5 的 MATCH:每个三字以上的词拆成相邻的三字片段,用 OR 连起来,
 * 这样「生日三月五号」也能命中「生日是三月五号」,命中的片段越多 bm25 越靠前。
 */
export function matchQuery(query: string): string | null {
  const grams = new Set<string>();
  for (const term of terms(query)) {
    const chars = [...term];
    for (let i = 0; i + 3 <= chars.length && grams.size < 40; i++) grams.add(chars.slice(i, i + 3).join(''));
  }
  if (!grams.size) return null;
  return [...grams].map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/** 两个字的词(黑话、昵称多是两个字)trigram 搜不到,改用子串匹配。 */
export function shortTerms(query: string): string[] {
  return terms(query).filter((t) => [...t].length === 2);
}

function trigrams(text: string): Set<string> {
  const chars = [...text.replace(/\s+/g, '')];
  const out = new Set<string>();
  for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''));
  return out;
}
function similar(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * 混合检索:全文与向量各取前 50,用 RRF 合并,乘上类型权重和很轻的时间衰减(半年降到约九成)。
 * 可见范围、时间、人、类型先筛;结果里高度相似的只留一条。
 */
export class KbSearch {
  private cache?: { version: string; rows: Array<{ id: number; vector: Float32Array }> };
  constructor(private store: KbStore) {}

  private vectors(): Array<{ id: number; vector: Float32Array }> {
    const version = this.store.get('version') ?? '0';
    if (this.cache?.version !== version) this.cache = { version, rows: this.store.vectors() };
    return this.cache.rows;
  }

  search(query: string, queryVector: Float32Array | null, opts: SearchOptions): Hit[] {
    const now = opts.now ?? Date.now();
    const k = Math.min(Math.max(opts.k ?? 5, 1), 20);
    const chunks = new Map<number, Chunk>();
    const load = (id: number) => {
      if (!chunks.has(id)) { const c = this.store.chunk(id); if (c) chunks.set(id, c); }
      return chunks.get(id);
    };
    const passes = (c: Chunk) => opts.scope.allow(c)
      && (opts.kind === undefined || c.kind === opts.kind)
      && (opts.since === undefined || c.tsEnd >= opts.since)
      && (opts.until === undefined || c.tsStart <= opts.until)
      && (!opts.people?.length || opts.people.some((p) => c.people.includes(`,${p},`)));

    const fullText: Array<{ id: number; rank: number }> = [];
    const match = matchQuery(query);
    if (match) {
      for (const row of this.store.fullText(match, 200)) {
        const c = load(row.id);
        if (c && passes(c)) fullText.push(row);
        if (fullText.length >= 50) break;
      }
    }
    const short = shortTerms(query);
    if (short.length && fullText.length < 50) {
      const listed = new Set(fullText.map((r) => r.id));
      for (const row of this.store.containing(short, 200)) {
        if (listed.has(row.id)) continue;
        const c = load(row.id);
        // 子串命中排在全文命中之后,命中的词越多越靠前。
        if (c && passes(c)) fullText.push({ id: row.id, rank: -row.hits });
        if (fullText.length >= 50) break;
      }
    }
    const vector: Array<{ id: number; sim: number }> = [];
    if (queryVector) {
      for (const row of this.vectors()) {
        if (row.vector.length !== queryVector.length) continue;
        let sim = 0;
        for (let i = 0; i < row.vector.length; i++) sim += row.vector[i] * queryVector[i];
        vector.push({ id: row.id, sim });
      }
      vector.sort((a, b) => b.sim - a.sim);
      const kept: typeof vector = [];
      for (const row of vector) {
        // 向量总会给出"最近"的结果,哪怕毫不相干;太远的不算命中,好让她照实说不记得。
        if (row.sim < (opts.minSimilarity ?? 0)) break;
        const c = load(row.id);
        if (c && passes(c)) kept.push(row);
        if (kept.length >= 50) break;
      }
      vector.splice(0, vector.length, ...kept);
    }

    const fused = new Map<number, { rrf: number; fullText: number | null; vector: number | null }>();
    fullText.forEach((row, i) => fused.set(row.id, { rrf: 1 / (60 + i + 1), fullText: -row.rank, vector: null }));
    vector.forEach((row, i) => {
      const entry = fused.get(row.id) ?? { rrf: 0, fullText: null, vector: null };
      entry.rrf += 1 / (60 + i + 1); entry.vector = row.sim;
      fused.set(row.id, entry);
    });
    const ranked = [...fused].map(([id, s]) => {
      const c = chunks.get(id)!;
      const ageDays = Math.max(0, now - c.tsEnd) / 86_400_000;
      return { c, s, score: s.rrf * weight(c) * (0.85 + 0.15 * Math.exp(-ageDays / 180)) };
    }).sort((a, b) => b.score - a.score);

    const hits: Hit[] = [];
    const seen: Array<Set<string>> = [];
    for (const { c, s, score } of ranked) {
      const grams = trigrams(c.text);
      if (seen.some((g) => similar(g, grams) > 0.8)) continue;
      seen.push(grams);
      hits.push({ id: c.id, kind: c.kind, channel: c.channel, people: c.people.split(',').filter(Boolean), tsStart: c.tsStart, tsEnd: c.tsEnd,
        text: c.text, score: Number(score.toFixed(5)), fullText: s.fullText === null ? null : Number(s.fullText.toFixed(3)), vector: s.vector === null ? null : Number(s.vector.toFixed(3)) });
      if (hits.length >= k) break;
    }
    this.store.recalled(hits.map((h) => h.id), now);
    return hits;
  }
}
