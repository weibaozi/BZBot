import { registerDeliveryHint } from 'cortico/worlds/delivery-hints.ts';
import { proactiveHint } from './server/proactive.ts';
import { registerImageSource } from 'cortico/worlds/image-sources.ts';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext } from 'cortico/world.ts';
import { memesConfigGroup, type MemesConfigSection } from './config.ts';
import { hash, MemeLibrary } from './server/library.ts';
import { MemeSearch } from './server/search.ts';
import { MemeSemantic, type Progress } from './server/semantic.ts';
import { MemeCollection } from './server/collection.ts';
import { SaveAccess } from './server/save-access.ts';
import { createHash } from 'node:crypto';

export const MEMES_TOOL_DECLS: Array<Omit<ToolDef, 'handler'>> = [
  { name: 'save_meme', tags: ['write'], description: 'Learn a received image as a meme ONLY when a currently speaking globally trusted QQ user explicitly asks to save/learn it. Pass the exact log: image handle, never a URL or invented handle. Saves directly without manual review, automatically captions and embeds it. Do not use for unsolicited collection. Report saved and ready separately; failures may leave a saved image needing indexing. Sends nothing.',
    parameters: { type: 'object', properties: { image: { type: 'string', description: 'Exact log: handle of the received image in this conversation.' } }, required: ['image'] } },
  { name: 'search_meme', tags: ['read'], description: 'Retrieve meme candidates by vector similarity for your keywords. Use the current conversation and persona to choose one candidate or none after reading the result; scores measure similarity, not suitability. Returns descriptions, tags, ids and an image reference; sends nothing. Pass the selected image reference unchanged to qq_send or console_send together with your reply text; they resolve the image automatically, so do not call get_meme first. Call at most once per reply.',
    parameters: { type: 'object', properties: { keywords: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'A few short phrases describing your intended expression, attitude, action and recipient relationship. Reuse the current conversation; do not copy its history or persona.' } }, required: ['keywords'] } },
  { name: 'get_meme', tags: ['read'], description: 'Read a selected meme image. Use its blob handle with the current channel\'s image-capable sending tool. This tool does not send.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'Exact candidate id returned by search.' } }, required: ['id'] } },
];
export class MemesWorld implements World {
  readonly id = 'memes';
  readonly library: MemeLibrary;
  readonly search: MemeSearch;
  readonly semantic: MemeSemantic;
  readonly collection: MemeCollection;
  private saveAccess: SaveAccess;
  private collectionTimer?: ReturnType<typeof setInterval>;
  private collecting = false;
  private host?: WorldHost;
  private releaseImageSource?: () => void;
  private releaseHint?: () => void;
  private abort = new AbortController();
  private pending?: Promise<void>;
  private jobAbort?: AbortController;
  private job: { state: 'idle' | 'running' | 'done' | 'error' | 'cancelled'; operation?: string; result?: unknown; error?: string; progress?: Progress } = { state: 'idle' };
  constructor(private ctx: WorldContext<MemesConfigSection>) {
    this.saveAccess = new SaveAccess(() => ctx.globals?.().trustedQQ ?? []);
    this.library = new MemeLibrary(join(ctx.botDir, 'memes'));
    this.collection = new MemeCollection(join(ctx.botDir, 'memes', 'collection'), this.library, ctx.timezone,
      () => ({collectEnabled: ctx.cfg.memes.collectEnabled ?? true, collectDailyLimit: ctx.cfg.memes.collectDailyLimit ?? 20}));
    this.search = new MemeSearch(this.library, () => ({ model: ctx.cfg.memes.embeddingModel,
      queryPrefix: ctx.cfg.memes.queryPrefix }), ctx.models);
    this.semantic = new MemeSemantic(this.library, this.search, () => ctx.cfg.memes, ctx.models,
      (usage, options) => this.host?.reportUsage(usage, options));
  }
  envPromptVars() { return this.ctx.cfg.memes.enabled ? {} : null; }
  async start(host: WorldHost) {
    this.host = host; this.abort = new AbortController();
    await this.collection.start(host);
    this.collectionTimer = setInterval(() => {
      if(this.collecting)return;this.collecting=true;
      void this.collection.scan().catch(error=>host.log.error('Meme collection failed',{error:String(error)})).finally(()=>{this.collecting=false;});
    },1000);this.collectionTimer.unref();
    this.releaseHint = registerDeliveryHint(this.ctx.botDir, this.id, events => {
      this.saveAccess.deliver(events, host);
      return proactiveHint(this.ctx.cfg.memes, events, Math.random());
    });
    this.releaseImageSource = registerImageSource(this.ctx.botDir, 'meme', async id => {
      if (!this.ctx.cfg.memes.enabled || this.ctx.cfg.memes.maxMemes === 0) throw new Error('Meme feature is disabled');
      const pack = (await this.library.packs()).find(p => id.startsWith(p.id + ':'));
      if (!pack || pack.enabled === false) throw new Error('Meme pack is unavailable or disabled');
      const { entry, bytes } = await this.library.image(id);
      if (!entry.searchable) throw new Error('Meme is not available for conversation use');
      this.abort.signal.throwIfAborted();
      return { bytes, mime: entry.mime };
    });
  }
  async stop() { this.saveAccess.clear(); clearInterval(this.collectionTimer); await this.collection.stop(); this.releaseHint?.(); this.releaseHint = undefined; this.releaseImageSource?.(); this.releaseImageSource = undefined; this.abort.abort(); await this.pending; this.host = undefined; }
  tools(): ToolDef[] {
    return MEMES_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args, context) => {
      if (!this.ctx.cfg.memes.enabled) throw new Error('Meme feature is disabled');
      if (decl.name === 'save_meme') {
        if (!this.host) throw new Error('Meme world is not running');
        const { bytes, mime } = this.saveAccess.image(args.image, context.role, this.host);
        context.signal?.throwIfAborted();
        let entryId: string | undefined;
        this.launch('save_meme', async (jobSignal, progress) => {
          const signal = AbortSignal.any([jobSignal, ...(context.signal ? [context.signal] : [])]);
          const digest = createHash('sha256').update(bytes).digest('hex');
          const existing = (await this.library.entries()).find(e => e.file.startsWith(`images/${digest}.`));
          let packId = existing?.packId;
          if (existing) entryId = existing.id;
          else {
            packId = (await this.library.packs()).find(p => p.name === '学习的表情')?.id ?? (await this.library.create('学习的表情')).id;
            const pack = (await this.library.catalog()).find(p => p.id === packId)!;
            if (!pack.categories.some(c => c.name === '已学习')) await this.library.edit({ kind: 'createCategory', packId,
              revision: pack.revision, category: '已学习', description: '用户明确要求学习的表情' });
            signal.throwIfAborted();
            entryId = await this.library.addCollected(bytes, mime, packId, '已学习');
          }
          await this.collection.markSaved(digest, entryId!);
          const described = await this.semantic.describe(packId!, 'missing', progress, signal, [entryId!], true);
          if (described.failed) throw new Error('标注失败，请在语义化页面重试');
          const savedPack = (await this.library.packs()).find(p => p.id === packId)!;
          const savedImage = savedPack.images.find(i => `${packId}:${i.id}` === entryId)!;
          if (!savedImage.caption.trim()) throw new Error('已保存，但缺少语义描述');
          await this.library.applySemantic(entryId!, hash(JSON.stringify(savedImage)), { searchable: true });
          await this.search.build(signal, { packId, force: false });
          const entry = (await this.library.entries()).find(e => e.id === entryId)!;
          const pack = (await this.library.packs()).find(p => p.id === packId)!;
          return { saved: true, ready: entry.searchable && pack.enabled !== false, id: entryId, image: `meme:${entryId}`, duplicate: Boolean(existing) };
        });
        await this.pending;
        return JSON.stringify(this.job.state === 'done' ? this.job.result : { saved: Boolean(entryId), ready: false, id: entryId, error: this.job.error ?? 'Cancelled' });
      }
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
  onTurnEnded() { this.saveAccess.clear(); }
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
        if(method==='collection') return this.collection.list();
        if(method==='collectionImage') {
          if(typeof arg.id!=='string')throw new Error('Image id required');
          const image=await this.collection.image(arg.id);return {$binary:{mime:image.mime,base64:image.bytes.toString('base64')}};
        }
        if(method==='rejectCollection') { if(typeof arg.id!=='string')throw new Error('Image id required');return this.collection.reject(arg.id); }
        if(method==='approveCollection') {
          if(typeof arg.id!=='string'||typeof arg.packId!=='string'||typeof arg.category!=='string')throw new Error('Image, pack and category required');
          const {id,packId,category}=arg;
          return this.launch('approve',async(signal,progress)=>{
            const entryId=await this.collection.approve(id,packId,category);
            const described=await this.semantic.describe(packId,'missing',progress,signal,[entryId]);
            if(described.failed)throw new Error('已入库，但标注失败；请在语义化页面重试失败项并补生成向量');
            await this.search.build(signal,{packId,force:false});return {entryId};
          });
        }
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
        if (method === 'settings') return { schema: memesConfigGroup(language).schema, values: this.ctx.cfg.memes };
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
