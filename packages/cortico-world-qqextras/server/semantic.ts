import type { QqextrasConfigSection } from '../config.ts';
import { hash, MemeLibrary } from './library.ts';
import { MemeSearch } from './search.ts';
import { CAPTION_PROMPT, generateHttp, QUERY_PROMPT, SELECT_PROMPT, type Generate, type ModelOptions } from './models.ts';

export interface Progress { stage: string; done: number; total: number; failed: number; skipped: number; errors: Array<{ id: string; error: string }> }
export class MemeSemantic {
  constructor(private library: MemeLibrary, private search: MemeSearch,
    private config: () => QqextrasConfigSection['memes'], private model: (kind: 'auxiliary' | 'vision') => ModelOptions,
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
          image: { bytes, mime: image.mime } }, this.model('vision'), signal);
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

  async choose(input: Record<string, unknown>, signal?: AbortSignal) {
    const cfg = this.config();
    if (!cfg.enabled || cfg.maxMemes === 0) return { selected: null, reason: 'disabled', sent: false };
    if (Math.random() * 100 >= cfg.probability) return { selected: null, reason: 'probability', sent: false };
    if (typeof input.reply !== 'string' || !input.reply.trim() || input.reply.length > 12000) throw new Error('reply must contain 1–12000 characters');
    const started = performance.now();
    const reference: Record<string, unknown> = { reply: input.reply };
    if (cfg.contextTurns && input.context !== undefined) {
      if (!Array.isArray(input.context) || input.context.some(t => typeof t !== 'string' || t.length > 4000)) throw new Error('Invalid reference context');
      reference.context = input.context.slice(-cfg.contextTurns);
    }
    if (cfg.injectPersona && typeof input.persona === 'string') reference.persona = input.persona.slice(0, 4000);
    const result = await this.generate({ instruction: QUERY_PROMPT, data: reference }, this.model('auxiliary'), signal);
    if (typeof result.query !== 'string' || !result.query.trim() || result.query.length > 2000) throw new Error('辅助模型未返回有效检索词');
    const queryMs = Math.round(performance.now() - started);
    const found = await this.search.search(result.query, cfg.topK, signal);
    const candidates = found.candidates.filter(c => c.score >= cfg.minScore);
    if (!candidates.length) return { selected: null, reason: 'no_candidates', query: result.query, sent: false, queryMs, ...found, candidates };
    const selectStart = performance.now();
    const choice = await this.generate({ instruction: SELECT_PROMPT, data: { ...reference, candidates } }, this.model('auxiliary'), signal);
    if (typeof choice.meme_id !== 'string') throw new Error('辅助模型未返回有效选图结果');
    const selected = candidates.find(c => c.id === choice.meme_id) ?? null;
    if (choice.meme_id && !selected) throw new Error('辅助模型选中了候选之外的图片');
    return { selected, reason: selected ? 'selected' : 'declined', sent: false, query: result.query,
      queryMs, selectMs: Math.round(performance.now() - selectStart), ...found, candidates };
  }
}
