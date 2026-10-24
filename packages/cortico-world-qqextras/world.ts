import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolDef, World, WorldHost } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext } from 'cortico/world.ts';
import { qqextrasConfigGroup, type QqextrasConfigSection } from './config.ts';
import { MemeLibrary } from './server/library.ts';
import { MemeSearch, type Embed } from './server/search.ts';

export const QQEXTRAS_TOOL_DECLS: Array<Omit<ToolDef, 'handler'>> = [
  { name: 'qqextras_search_memes', tags: ['read'], description: 'Find meme candidates by your intended emotion, attitude or action in the current conversation. Returns descriptions and ids; sends nothing. You may choose none.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Describe your intended response, including who the emotion/action is directed at.' } }, required: ['query'] } },
  { name: 'qqextras_get_meme', tags: ['read'], description: 'Read a selected meme image. The returned blob handle can be sent with qq_draft image and qq_confirm. This tool does not send.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'Exact candidate id returned by search.' } }, required: ['id'] } },
];
export class QqextrasWorld implements World {
  readonly id = 'qqextras';
  readonly library: MemeLibrary;
  readonly search: MemeSearch;
  private abort = new AbortController();
  private pending?: Promise<void>;
  private job: { state: 'idle' | 'running' | 'done' | 'error'; operation?: string; result?: unknown; error?: string } = { state: 'idle' };
  constructor(private ctx: WorldContext<QqextrasConfigSection>, embed?: Embed) {
    this.library = new MemeLibrary(join(ctx.botDir, 'qqextras', 'memes'));
    this.search = new MemeSearch(this.library, () => ({ url: ctx.cfg.memes.embeddingUrl, model: ctx.cfg.memes.embeddingModel,
      queryPrefix: ctx.cfg.memes.queryPrefix, key: ctx.secret('CORTICO_MEME_EMBEDDING_KEY') }), embed);
  }
  envPromptVars() { return this.ctx.cfg.memes.enabled ? {} : null; }
  async start(_host: WorldHost) { this.abort = new AbortController(); }
  async stop() { this.abort.abort(); await this.pending; }
  tools(): ToolDef[] {
    return QQEXTRAS_TOOL_DECLS.map(decl => ({ ...decl, handler: async (args, context) => {
      if (!this.ctx.cfg.memes.enabled) throw new Error('Meme feature is disabled');
      if (decl.name === 'qqextras_search_memes') {
        if (typeof args.query !== 'string') throw new Error('query must be a string');
        return JSON.stringify(await this.search.search(args.query, this.ctx.cfg.memes.topK, context.signal));
      }
      if (typeof args.id !== 'string') throw new Error('id must be a string');
      const { entry, bytes } = await this.library.image(args.id);
      return { text: JSON.stringify({ id: entry.id, caption: entry.caption, visibleText: entry.visibleText, sent: false }),
        blobs: [{ bytes, mime: entry.mime, name: entry.id, fallbackText: `Meme: ${entry.caption}. Not sent; use QQ draft and confirm to send.` }] };
    } }));
  }
  private launch(operation: string, run: () => Promise<unknown>) {
    if (this.job.state === 'running') throw new Error('An import or index build is already running');
    this.job = { state: 'running', operation };
    this.pending = run().then(result => { this.job = { state: 'done', operation, result }; }, error => {
      this.job = { state: 'error', operation, error: error instanceof Error ? error.message : String(error) };
    });
    return this.job;
  }
  webUi(language: Language = 'zh') {
    const t = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
    const override = join(this.ctx.botDir, 'prompts', 'QQEXTRAS.md');
    return {
      label: t('QQ 功能', 'QQ features'), config: [qqextrasConfigGroup(language)],
      panels: [{ id: 'memes', title: t('表情包', 'Memes') }],
      promptDocs: [{ key: 'worlds.qqextras.environment', title: t('表情使用说明', 'Meme usage'), description: t('由主模型根据聊天语境决定选图。', 'The main model chooses images in context.'),
        path: existsSync(override) ? override : fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), deploymentPath: override, role: 'envPrompt' as const }],
      invoke: async (panel: string, method: string, args: unknown[]) => {
        if (panel !== 'memes') throw new Error('Unknown panel');
        const arg = (args[0] ?? {}) as Record<string, unknown>;
        if (method === 'state') {
          const packs = await this.library.packs();
          return { packs: packs.map(p => ({ id: p.id, name: p.name, images: p.images.length, searchable: p.images.filter(i => i.searchable).length })),
            index: await this.search.state(), job: this.job, enabled: this.ctx.cfg.memes.enabled };
        }
        if (method === 'import') {
          if (typeof arg.path !== 'string') throw new Error('ZIP path is required');
          const path = arg.path;
          return this.launch('import', () => this.library.importZip(path, this.ctx.cfg.memes.pythonFile, this.abort.signal));
        }
        if (method === 'build') return this.launch('build', () => this.search.build(this.abort.signal));
        if (method === 'key') {
          if (typeof arg.key !== 'string' || !arg.key.trim()) throw new Error('Key cannot be empty');
          this.ctx.storeSecret('CORTICO_MEME_EMBEDDING_KEY', arg.key.trim()); return { saved: true };
        }
        if (method === 'search') {
          if (typeof arg.query !== 'string') throw new Error('query must be a string');
          return this.search.search(arg.query, this.ctx.cfg.memes.topK, this.abort.signal);
        }
        if (method === 'list') {
          const offset = typeof arg.offset === 'number' && Number.isInteger(arg.offset) && arg.offset >= 0 ? arg.offset : 0;
          const entries = await this.library.entries();
          return { total: entries.length, entries: entries.slice(offset, offset + 20).map(({ file, packId, ...entry }) => entry) };
        }
        if (method === 'image') {
          if (typeof arg.id !== 'string') throw new Error('id must be a string');
          const { bytes, entry } = await this.library.image(arg.id);
          return { $binary: { mime: entry.mime, base64: bytes.toString('base64') } };
        }
        throw new Error('Unknown method');
      },
    };
  }
}
