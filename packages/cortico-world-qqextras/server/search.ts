import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { hash, MemeLibrary, semanticText } from './library.ts';

export interface EmbeddingOptions { url: string; model: string; queryPrefix: string; key: string }
export type Embed = (texts: string[], options: EmbeddingOptions, signal?: AbortSignal) => Promise<number[][]>;
export const embedHttp: Embed = async (texts, options, signal) => {
  const url = new URL(options.url.replace(/\/$/, '') + '/embeddings');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid embedding URL');
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}) },
    body: JSON.stringify({ model: options.model, input: texts, encoding_format: 'float' }),
  });
  if (!response.ok) throw new Error(`Embedding request failed (HTTP ${response.status})`);
  const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
  const data = body.data?.slice().sort((a, b) => a.index - b.index);
  if (!data || data.length !== texts.length || data.some((d, i) => d.index !== i)) throw new Error('Invalid embedding response');
  return data.map(d => normalize(d.embedding));
};
export function normalize(vector: number[]): number[] {
  if (!Array.isArray(vector) || !vector.length || vector.length > 32768 || vector.some(n => typeof n !== 'number' || !Number.isFinite(n)))
    throw new Error('Invalid embedding vector');
  const norm = Math.hypot(...vector);
  if (!norm || !Number.isFinite(norm)) throw new Error('Empty embedding vector');
  return vector.map(n => n / norm);
}
interface Index {
  version: 1; fingerprint: string; dimension: number;
  items: Array<{ id: string; textHash: string; vector: number[] }>;
}
export class MemeSearch {
  private index?: Index;
  private queries = new Map<string, number[]>();
  constructor(private library: MemeLibrary, private options: () => EmbeddingOptions, private embed: Embed = embedHttp) {}
  private fingerprint(options: EmbeddingOptions) { return hash(JSON.stringify([options.url.replace(/\/$/, ''), options.model, options.queryPrefix])); }
  async build(signal?: AbortSignal): Promise<{ indexed: number; missingDescriptions: number }> {
    const options = this.options();
    if (!options.url || !options.model) throw new Error('Configure the embedding URL and model first');
    const entries = await this.library.entries();
    const eligible = entries.filter(e => e.searchable);
    if (!eligible.length) throw new Error('No images with usable semantic descriptions; import a semantic export');
    const next: Index = { version: 1, fingerprint: this.fingerprint(options), dimension: 0, items: [] };
    for (let offset = 0; offset < eligible.length; offset += 16) {
      signal?.throwIfAborted();
      const batch = eligible.slice(offset, offset + 16);
      const vectors = await this.embed(batch.map(semanticText), options, signal);
      if (vectors.length !== batch.length) throw new Error('Embedding batch count mismatch');
      for (let i = 0; i < batch.length; i++) {
        const vector = normalize(vectors[i]);
        next.dimension ||= vector.length;
        if (vector.length !== next.dimension) throw new Error('Embedding dimensions changed during indexing');
        next.items.push({ id: batch[i].id, textHash: hash(semanticText(batch[i])), vector });
      }
    }
    signal?.throwIfAborted();
    await this.library.saveIndex(next);
    this.index = next; this.queries.clear();
    return { indexed: next.items.length, missingDescriptions: entries.length - eligible.length };
  }
  async state() {
    try { this.index ??= JSON.parse(await readFile(join(this.library.dir, 'index.json'), 'utf8')) as Index; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { indexed: this.index?.items.length ?? 0, compatible: this.index?.fingerprint === this.fingerprint(this.options()) };
  }
  async search(query: string, topK: number, signal?: AbortSignal) {
    if (!query.trim() || query.length > 2000) throw new Error('Query must contain 1–2000 characters');
    const start = performance.now();
    const state = await this.state();
    if (!state.indexed || !state.compatible || this.index?.version !== 1) throw new Error('Semantic index unavailable or model settings changed; build the index in QQ features');
    const index = this.index!;
    const entries = new Map((await this.library.entries()).filter(e => e.searchable).map(e => [e.id, e]));
    const options = this.options();
    const key = hash(index.fingerprint + '\n' + query.trim());
    const cached = this.queries.has(key);
    let vector = this.queries.get(key);
    if (!vector) {
      const vectors = await this.embed([options.queryPrefix + query.trim()], options, signal);
      vector = normalize(vectors[0]);
      if (vector.length !== index.dimension) throw new Error('Query embedding dimension differs from index');
      this.queries.set(key, vector);
      if (this.queries.size > 128) this.queries.delete(this.queries.keys().next().value!);
    }
    const embeddedAt = performance.now();
    const candidates = index.items.flatMap(item => {
      const entry = entries.get(item.id);
      if (!entry || item.textHash !== hash(semanticText(entry))) return [];
      return [{ id: entry.id, category: entry.category, caption: entry.caption, tags: entry.tags, visibleText: entry.visibleText,
        score: item.vector.reduce((sum, n, i) => sum + n * vector![i], 0) }];
    }).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(10, topK)));
    return { candidates, queryCached: cached, embeddingMs: Math.round(embeddedAt - start), searchMs: Math.round(performance.now() - embeddedAt) };
  }
}
