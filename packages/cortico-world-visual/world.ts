import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldContext } from 'cortico/world.ts';
import type { World, WorldHost, ToolDef } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { saversOf, visualConfigGroups, type VisualConfig } from './config.ts';
import { VisualLibrary, type VisualEntry } from './server/library.ts';
import { registerVisual } from './server/registry.ts';
import { findImageOrigins } from './server/senders.ts';

export const SAVE_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'visual_save', tags: ['write'],
  description: 'Save a picture someone sent you into your visual library, so you can use it as a reference when drawing. Only pictures from whitelisted senders can be saved. Pictures of the same person or thing go under the same id; use "self" for yourself.',
  parameters: { type: 'object', properties: {
    image: { type: 'string', description: 'The exact log: blob handle of the picture in the conversation.' },
    id: { type: 'string', minLength: 1, maxLength: 60, description: 'Short entry id, e.g. "self" or "团子". An existing id adds the picture to that entry.' },
    name: { type: 'string', maxLength: 100, description: 'Display name; omit to keep the current one.' },
    aliases: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Other names people use for it; omit to keep the current ones.' },
    description: { type: 'string', maxLength: 8000, description: 'Appearance notes for the image model; omit to keep the current text.' },
  }, required: ['image', 'id'] },
};

/** 环境提示词里的一行：id、名字、别名、主人和私聊来源（让她自己把握能不能在群里用），以及图片文件名（发图时直接拼 mem: 句柄）。 */
function listLine(e: VisualEntry): string {
  const parts = [`- ${e.id}：${e.name}`];
  if (e.aliases.length) parts.push(`（也叫 ${e.aliases.join('、')}）`);
  if (e.owner) parts.push(` · 属于 ${e.owner}`);
  if (e.source === 'private') parts.push(' · 私聊所得');
  parts.push(e.images.length ? ` · 图：${e.images.join('、')}` : ' · 只有文字设定');
  return parts.join('');
}

export class VisualWorld implements World {
  readonly id = 'visual'; private host?: WorldHost; private unregister?: () => void;
  constructor(private ctx: WorldContext<VisualConfig>) {}
  /** 资料在部署记忆的 `visual/` 下，随记忆一起进 git；图片因此能用记忆句柄 `mem:visual/<id>/<文件名>` 取。 */
  get library(): VisualLibrary { return new VisualLibrary(join(this.ctx.botDir, 'memory', 'visual')); }
  envPromptVars() { return { 'visual.list': this.library.read().entries.map(listLine).join('\n') }; }
  async start(host: WorldHost) {
    this.host = host;
    this.unregister?.();
    this.unregister = registerVisual(this.ctx.botDir, {
      describe: id => {
        const entry = this.library.read().entries.find(e => e.id === id);
        return entry ? { name: entry.name, description: entry.description } : null;
      },
    });
  }
  async stop() { this.unregister?.(); this.unregister = undefined; this.host = undefined; }

  tools(): ToolDef[] { return [{ ...SAVE_TOOL, handler: async args => {
    const handle = args.image;
    if (typeof handle !== 'string' || !/^log:/.test(handle)) throw new Error('image must be the log: handle of a picture someone sent in the conversation');
    const image = this.host?.blob(handle);
    if (!image) throw new Error(`Image handle unavailable: ${handle}; ask them to resend it`);
    const origins = findImageOrigins(this.ctx.dataDir, handle);
    if (!origins.length) return { text: `[not saved] ${handle} was not sent to you by anyone in a chat (it may be your own or a tool's picture), so it cannot be saved.`, failed: true };
    const savers = saversOf(this.ctx.cfg, this.ctx.globals?.().trustedQQ);
    const allowed = origins.find(o => o.sender === 'console' ? this.ctx.cfg.consoleCanSave : savers.has(o.sender));
    if (!allowed) return { text: `[not saved] The picture was sent by ${[...new Set(origins.map(o => o.sender))].join(', ')}, who is not on the save whitelist. Tell them honestly that you cannot keep it.`, failed: true };
    if (args.aliases !== undefined && (!Array.isArray(args.aliases) || args.aliases.some(a => typeof a !== 'string'))) throw new Error('aliases must be a list of strings');
    const result = this.library.add(args.id, image, {
      name: typeof args.name === 'string' ? args.name : undefined,
      aliases: args.aliases as string[] | undefined,
      description: typeof args.description === 'string' ? args.description : undefined,
      owner: allowed.sender === 'console' ? '' : allowed.sender, source: allowed.source,
    });
    const { id, name, owner, source, images } = result.entry;
    return JSON.stringify({ saved: true, created: result.created, id, name, owner, source, images: images.length,
      note: 'images_generate can use it now; your list of entries updates after the next prefix reload.' });
  } }]; }

  webUi(language: Language = 'zh') {
    const zh = language.startsWith('zh');
    const override = join(this.ctx.botDir, 'worlds', 'visual', 'ENV_PROMPT.md');
    return {
      label: zh ? '图像资料' : 'Visual library', config: visualConfigGroups(language), panels: [{ id: 'library', title: zh ? '图像资料' : 'Visual library' }],
      promptDocs: [{ key: 'worlds.visual.environment', title: zh ? '图像资料 · 环境提示词' : 'Visual library · environment prompt',
        description: zh ? '告诉她图像资料里有什么、画图时怎么用、什么时候存图。' : 'Tells the persona what is in its visual library, how to use it when drawing and when to save pictures.',
        path: existsSync(override) ? override : fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), deploymentPath: override, role: 'envPrompt' as const,
        vars: [{ name: 'visual.list', description: zh ? '图像资料，每行「id：名字（别名）· 主人 · 来源 · 图片文件名」。' : 'Visual library entries, one "id: name (aliases) · owner · source · picture files" per line.' }] }],
      invoke: async (panel: string, method: string, args: unknown[]) => {
        if (panel !== 'library') throw new Error('Unknown panel');
        const library = this.library;
        if (method === 'read') return { ...library.read(), dir: library.dir };
        if (method === 'save') return library.save(args[0], args[1]);
        if (method === 'upload') return library.upload(args[0], args[1], args[2], args[3]);
        if (method === 'image') { const image = library.image(args[0], args[1]); return { $binary: { mime: image.mime, base64: Buffer.from(image.bytes).toString('base64') } }; }
        throw new Error('Unknown method');
      },
    };
  }
}
