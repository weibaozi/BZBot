import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { hash, MemeLibrary, semanticText } from './library.ts';

import type { ModelHub } from 'cortico/providers/model-hub.ts';

export interface EmbeddingOptions { model: string; queryPrefix: string }
const MODEL_REQUIRED = '先在模型中心配置嵌入模型，再在表情包设置里选它';
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
  constructor(private library: MemeLibrary, private options: () => EmbeddingOptions, private models: ModelHub) {}
  private fingerprint(options: EmbeddingOptions) { return hash(JSON.stringify([options.model, options.queryPrefix])); }
  async build(signal?: AbortSignal, settings: { force?: boolean; packId?: string; progress?: (done: number, total: number) => void } = { force: true }): Promise<{ indexed: number; missingDescriptions: number; generated: number }> {
    const options = this.options();
    if (!options.model) throw new Error(MODEL_REQUIRED);
    const entries = await this.library.entries();
    const eligible = entries.filter(e => e.searchable);
    if (!eligible.length) throw new Error('No images with usable semantic descriptions; import a semantic export');
    await this.state();
    const previous = this.index?.fingerprint === this.fingerprint(options) ? this.index : undefined;
    const next: Index = { version: 1, fingerprint: this.fingerprint(options), dimension: previous?.dimension ?? 0, items: [] };
    const old = new Map(previous?.items.map(i => [i.id, i]) ?? []);
    const pending = eligible.filter(e => {
      const item = old.get(e.id); const inScope = !settings.packId || e.packId === settings.packId;
      if (item && item.textHash === hash(semanticText(e)) && (!settings.force || !inScope)) { next.items.push(item); return false; }
      return inScope;
    });
    if (settings.force && !settings.packId) next.dimension = 0;
    settings.progress?.(0, pending.length);
    for (let offset = 0; offset < pending.length; offset += 16) {
      signal?.throwIfAborted();
      const batch = pending.slice(offset, offset + 16);
      const vectors = await this.models.embed(options.model, batch.map(semanticText), signal);
      if (vectors.length !== batch.length) throw new Error('Embedding batch count mismatch');
      for (let i = 0; i < batch.length; i++) {
        const vector = normalize(vectors[i]);
        next.dimension ||= vector.length;
        if (vector.length !== next.dimension) throw new Error('Embedding dimensions changed during indexing');
        next.items.push({ id: batch[i].id, textHash: hash(semanticText(batch[i])), vector });
      }
      settings.progress?.(Math.min(offset + 16, pending.length), pending.length);
    }
    signal?.throwIfAborted();
    await this.library.saveIndex(next);
    this.index = next; this.queries.clear();
    return { indexed: next.items.length, missingDescriptions: entries.length - eligible.length, generated: pending.length };
  }
  async state() {
    try { this.index ??= JSON.parse(await readFile(join(this.library.dir, 'index.json'), 'utf8')) as Index; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const entries = new Map((await this.library.entries()).filter(e => e.searchable).map(e => [e.id, e]));
    const compatible = this.index?.fingerprint === this.fingerprint(this.options());
    const valid = compatible ? this.index?.items.filter(i => { const e = entries.get(i.id); return e && hash(semanticText(e)) === i.textHash; }).length ?? 0 : 0;
    return { indexed: this.index?.items.length ?? 0, valid, pending: entries.size - valid, compatible };
  }
  async search(query: string, topK: number, signal?: AbortSignal) {
    if (!query.trim() || query.length > 2000) throw new Error('Query must contain 1–2000 characters');
    const options = this.options();
    if (!options.model) throw new Error(MODEL_REQUIRED);
    const start = performance.now();
    const state = await this.state();
    if (!state.indexed || !state.compatible || this.index?.version !== 1) throw new Error('Semantic index unavailable or model settings changed; build the index in meme management');
    const index = this.index!;
    const enabled = new Set((await this.library.packs()).filter(p => p.enabled !== false).map(p => p.id));
    const entries = new Map((await this.library.entries()).filter(e => e.searchable && enabled.has(e.packId)).map(e => [e.id, e]));
    const key = hash(index.fingerprint + '\n' + query.trim());
    const cached = this.queries.has(key);
    let vector = this.queries.get(key);
    if (!vector) {
      const vectors = await this.models.embed(options.model, [options.queryPrefix + query.trim()], signal);
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
