import type { QqextrasConfigSection } from '../config.ts';
import { hash, MemeLibrary } from './library.ts';
import { MemeSearch } from './search.ts';
import { CAPTION_PROMPT, generateHttp, type Generate, type ModelOptions } from './models.ts';

export interface Progress { stage: string; done: number; total: number; failed: number; skipped: number; errors: Array<{ id: string; error: string }> }
export class MemeSemantic {
  constructor(private library: MemeLibrary, private search: MemeSearch,
    private config: () => QqextrasConfigSection['memes'], private model: () => ModelOptions,
    private generate: Generate = generateHttp) {}

  async describe(packId: string, mode: 'missing' | 'retry' | 'force', progress: Progress, signal: AbortSignal) {
    const packs = await this.library.packs();
    if (!packs.some(p => p.id === packId)) throw new Error('Select a pack');
    const pack = packs.find(p => p.id === packId)!;
    const pending = pack.images.filter(i => !i.deletedAt && !i.manual && (mode === 'force' || (mode === 'retry' ? Boolean(i.semanticError) : !i.caption.trim())));
    Object.assign(progress, { stage: '生成语义描述', done: 0, total: pending.length });
    for (const image of pending) {
      signal.throwIfAborted();
      const id = `${pack.id}:${image.id}`;
      try {
        const { bytes } = await this.library.image(id);
        const result = await this.generate({ instruction: CAPTION_PROMPT,
          data: { category: image.category, category_description: image.categoryDescription, animated: image.mime === 'image/gif', note: image.mime === 'image/gif' ? 'GIF 可能仅识别首帧，请勿推断未见动作' : '' },
          image: { bytes, mime: image.mime } }, this.model(), signal);
        if (typeof result.caption !== 'string' || !result.caption.trim() || result.caption.length > 8000 || !Array.isArray(result.tags) || result.tags.length > 100 || result.tags.some(t => typeof t !== 'string' || t.length > 200) || typeof result.visible_text !== 'string' || result.visible_text.length > 4000 || typeof result.needs_review !== 'boolean') throw new Error('视觉模型返回的语义字段无效');
        signal.throwIfAborted();
        const saved = await this.library.applySemantic(id, hash(JSON.stringify(image)), { caption: result.caption.trim(),
          tags: [...new Set((result.tags as string[]).map(t => t.trim()).filter(t => t && !t.startsWith('category:')))], visibleText: result.visible_text,
          searchable: !result.needs_review && !['needs_review', '_pending_review'].includes(image.category) });
        if (!saved) progress.skipped++;
      } catch (error) {
        signal.throwIfAborted();
        // Keep service error payloads and credentials out of the persisted queue.
        const message = error instanceof Error ? error.message.slice(0, 300) : 'Caption generation failed';
        progress.failed++; progress.errors.push({ id, error: message });
        await this.library.applySemantic(id, hash(JSON.stringify(image)), { semanticError: message });
      }
      progress.done++;
    }
    return { described: progress.done - progress.failed - progress.skipped, failed: progress.failed, skipped: progress.skipped };
  }

  async recall(input: Record<string, unknown>, signal?: AbortSignal) {
    const cfg = this.config();
    signal?.throwIfAborted();
    if (!cfg.enabled || cfg.maxMemes === 0) return { candidates: [], reason: 'disabled', sent: false };
    if (Math.random() * 100 >= cfg.probability) return { candidates: [], reason: 'probability', sent: false };
    if (!Array.isArray(input.keywords) || input.keywords.length < 1 || input.keywords.length > 8
      || input.keywords.some(word => typeof word !== 'string' || !word.trim() || word.length > 200))
      throw new Error('keywords must contain 1–8 non-empty strings of at most 200 characters');
    const query = [...new Set((input.keywords as string[]).map(word => word.trim()))].join(' ');
    const found = await this.search.search(query, cfg.topK, signal);
    const candidates = found.candidates.filter(c => c.score >= cfg.minScore);
    return { reason: candidates.length ? 'candidates' : 'no_candidates', sent: false, query, ...found, candidates };
  }
}
