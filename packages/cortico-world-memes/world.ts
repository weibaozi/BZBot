import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext } from 'cortico/world.ts';
import { memesConfigGroup, type MemesConfigSection } from './config.ts';
import { MemeLibrary } from './server/library.ts';
import { MemeSearch, type Embed } from './server/search.ts';
import { MemeSemantic, type Progress } from './server/semantic.ts';
import { generateHttp, type Generate } from './server/models.ts';
import { SharedModels } from './server/shared-models.ts';

export const MEMES_TOOL_DECLS: Array<Omit<ToolDef, 'handler'>> = [
  { name: 'search_meme', tags: ['read'], description: 'Retrieve meme candidates by vector similarity for your keywords. Use the current conversation and persona to choose one candidate or none after reading the result; scores measure similarity, not suitability. Returns descriptions, tags and ids; sends nothing. Call at most once per reply.',
    parameters: { type: 'object', properties: { keywords: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'A few short phrases describing your intended expression, attitude, action and recipient relationship. Reuse the current conversation; do not copy its history or persona.' } }, required: ['keywords'] } },
  { name: 'get_meme', tags: ['read'], description: 'Read a selected meme image. Use its blob handle with the current channel\'s image-capable sending tool. This tool does not send.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'Exact candidate id returned by search.' } }, required: ['id'] } },
];
export class MemesWorld implements World {
  readonly id = 'memes';
  readonly library: MemeLibrary;
  readonly search: MemeSearch;
  readonly semantic: MemeSemantic;
  private host?: WorldHost;
  private shared: SharedModels;
  private abort = new AbortController();
  private pending?: Promise<void>;
  private jobAbort?: AbortController;
  private job: { state: 'idle' | 'running' | 'done' | 'error' | 'cancelled'; operation?: string; result?: unknown; error?: string; progress?: Progress } = { state: 'idle' };
  constructor(private ctx: WorldContext<MemesConfigSection>, embed?: Embed, generate?: Generate) {
    this.library = new MemeLibrary(join(ctx.botDir, 'memes'));
    this.shared = new SharedModels(undefined, ctx.repoRoot, () => this.host);
    this.search = new MemeSearch(this.library, () => ctx.cfg.memes.embeddingProvider
      ? this.shared.embedding(ctx.cfg.memes.embeddingProvider, ctx.cfg.memes.queryPrefix)
      : ({ url: ctx.cfg.memes.embeddingUrl, model: ctx.cfg.memes.embeddingModel,
      queryPrefix: ctx.cfg.memes.queryPrefix, key: ctx.secret('CORTICO_MEME_EMBEDDING_KEY') }), embed);
    this.semantic = new MemeSemantic(this.library, this.search, () => ctx.cfg.memes, () => ({
      url: ctx.cfg.memes.visionUrl, model: ctx.cfg.memes.visionModel,
      key: ctx.secret('CORTICO_MEME_VISION_KEY'), timeoutSeconds: ctx.cfg.memes.timeoutSeconds,
    }), generate ?? ((input, options, signal) => ctx.cfg.memes.visionProvider
      ? this.shared.generate(ctx.cfg.memes.visionProvider, input, options.timeoutSeconds, signal)
      : generateHttp(input, options, signal)));
  }
  envPromptVars() { return this.ctx.cfg.memes.enabled ? {} : null; }
  async start(host: WorldHost) { this.host = host; this.abort = new AbortController(); }
  async stop() { this.abort.abort(); await this.pending; await this.shared.stop(); this.host = undefined; }
  tools(): ToolDef[] {
    return MEMES_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args, context) => {
      if (!this.ctx.cfg.memes.enabled) throw new Error('Meme feature is disabled');
      if (decl.name === 'search_meme') {
        return JSON.stringify(await this.semantic.recall(args, AbortSignal.any([this.abort.signal, ...(context.signal ? [context.signal] : [])])));
      }
      if (typeof args.id !== 'string') throw new Error('id must be a string');
      const pack = (await this.library.packs()).find(p => args.id!.toString().startsWith(p.id + ':'));
      if (pack?.enabled === false) throw new Error('This pack is disabled for conversation use');
      const { entry, bytes } = await this.library.image(args.id);
      return { text: JSON.stringify({ id: entry.id, caption: entry.caption, visibleText: entry.visibleText, sent: false }),
        blobs: [{ bytes, mime: entry.mime, name: entry.id, fallbackText: `Meme: ${entry.caption}. Not sent; use the current channel's image sending tool.` }] };
    } }));
  }
  private launch(operation: string, run: (signal: AbortSignal, progress: Progress) => Promise<unknown>) {
    if (this.job.state === 'running') throw new Error('An import or index build is already running');
    this.jobAbort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, this.jobAbort.signal]);
    const progress: Progress = { stage: operation, done: 0, total: 0, failed: 0, skipped: 0, errors: [] };
    this.job = { state: 'running', operation, progress };
    this.pending = run(signal, progress).then(result => { this.job = { state: 'done', operation, result, progress }; }, error => {
      this.job = { state: signal.aborted ? 'cancelled' : 'error', operation, progress, error: signal.aborted ? undefined : error instanceof Error ? error.message : String(error) };
    });
    return this.job;
  }
  webUi(language: Language = 'zh') {
    const t = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
    const override = join(this.ctx.botDir, 'prompts', 'MEMES.md');
    return {
      label: t('表情包管理', 'Meme manager'), config: [memesConfigGroup(language)],
      panels: [{ id: 'memes', title: t('表情包', 'Memes') }],
      promptDocs: [{ key: 'worlds.memes.environment', title: t('表情使用预设模板', 'Meme usage template'), description: t('主模型结合当前对话判断是否配图，给出关键词，再从向量候选中选择。', 'The conversation model decides whether to use a meme, supplies keywords and chooses from vector candidates.'),
        path: existsSync(override) ? override : fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), deploymentPath: override, role: 'envPrompt' as const }],
      invoke: async (panel: string, method: string, args: unknown[]) => {
        if (panel !== 'memes') throw new Error('Unknown panel');
        const arg = (args[0] ?? {}) as Record<string, unknown>;
        if (method === 'state') {
          const packs = await this.library.packs();
          return { packs: packs.map(p => ({ id: p.id, name: p.name, images: p.images.length, searchable: p.images.filter(i => i.searchable).length })),
            index: await this.search.state(), job: this.job, enabled: this.ctx.cfg.memes.enabled,
            semantic: { total: packs.flatMap(p => p.images).filter(i => !i.deletedAt).length,
              described: packs.flatMap(p => p.images).filter(i => !i.deletedAt && i.caption).length,
              review: packs.flatMap(p => p.images).filter(i => !i.deletedAt && i.caption && !i.searchable).length,
              failed: packs.flatMap(p => p.images).filter(i => !i.deletedAt && i.semanticError).length } };
        }
        if (method === 'import') {
          if (typeof arg.path !== 'string') throw new Error('ZIP path is required');
          const path = arg.path;
          return this.launch('import', signal => this.library.importZip(path, this.ctx.cfg.memes.pythonFile, signal));
        }
        if (method === 'cancel') { this.jobAbort?.abort(); return { cancelling: this.job.state === 'running' }; }
        if (method === 'build') return this.launch('build', (signal, progress) => this.search.build(signal, {
          force: arg.force === true, packId: typeof arg.packId === 'string' ? arg.packId : undefined,
          progress: (done, total) => Object.assign(progress, { stage: '生成向量', done, total }),
        }));
        if (method === 'semantic') {
          if (typeof arg.packId !== 'string') throw new Error('Select a pack'); const packId = arg.packId;
          const mode = arg.mode === 'force' ? 'force' : arg.mode === 'retry' ? 'retry' : 'missing';
          return this.launch('semantic', async (signal, progress) => {
            const described = await this.semantic.describe(packId, mode, progress, signal);
            if (arg.vectors === true) await this.search.build(signal, { force: false, packId, progress: (done, total) => Object.assign(progress, { stage: '生成向量', done, total }) });
            return described;
          });
        }
        if (method === 'catalog') return this.library.catalog();
        if (method === 'edit') return this.library.edit(arg);
        if (method === 'create') { if (typeof arg.name !== 'string') throw new Error('Name required'); return this.library.create(arg.name); }
        if (method === 'export') {
          if (typeof arg.packId !== 'string' || typeof arg.directory !== 'string') throw new Error('Pack and directory required');
          const { packId, directory } = arg;
          return this.launch('export', signal => this.library.exportZip(packId, directory, this.ctx.cfg.memes.pythonFile, signal));
        }
        if (method === 'settings') return { schema: memesConfigGroup(language).schema, values: this.ctx.cfg.memes, models: this.shared.list(),
          keys: Object.fromEntries(['EMBEDDING', 'VISION'].map(kind => [kind.toLowerCase(), Boolean(this.ctx.secret(`CORTICO_MEME_${kind}_KEY`))])) };
        if (method === 'key') {
          if (typeof arg.key !== 'string' || !arg.key.trim()) throw new Error('Key cannot be empty');
          if (arg.kind !== 'vision' && arg.kind !== 'embedding') throw new Error('Unknown model kind');
          const kind = arg.kind === 'vision' ? 'VISION' : 'EMBEDDING';
          this.ctx.storeSecret(`CORTICO_MEME_${kind}_KEY`, arg.key.trim()); return { saved: true };
        }
        if (method === 'search') return this.semantic.recall(arg, this.abort.signal);
        if (method === 'list') {
          const offset = typeof arg.offset === 'number' && Number.isInteger(arg.offset) && arg.offset >= 0 ? arg.offset : 0;
          const query = typeof arg.query === 'string' ? arg.query.toLowerCase().slice(0, 200) : '';
          const entries = (await this.library.entries(arg.trash === true)).filter(e => (!arg.packId || e.packId === arg.packId)
            && (!arg.category || e.category === arg.category)
            && (!query || [e.category, e.caption, e.visibleText, ...e.tags].join(' ').toLowerCase().includes(query))
            && (arg.status !== 'missing' || !e.caption) && (arg.status !== 'review' || Boolean(e.caption) && !e.searchable)
            && (arg.status !== 'error' || Boolean(e.semanticError)));
          return { total: entries.length, entries: entries.slice(offset, offset + 24).map(({ file, ...entry }) => entry) };
        }
        if (method === 'image') {
          if (typeof arg.id !== 'string') throw new Error('id must be a string');
          const { bytes, entry } = await this.library.image(arg.id, arg.trash === true);
          return { $binary: { mime: entry.mime, base64: bytes.toString('base64') } };
        }
        throw new Error('Unknown method');
      },
    };
  }
}
