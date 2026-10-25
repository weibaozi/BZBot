import { resolve } from 'node:path';
import type { WorldContext } from 'cortico/world.ts';
import type { World, WorldHost, ToolDef } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { imagesConfigGroups, type ImagesConfig } from './config.ts';
export const IMAGE_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'images_generate', tags: ['write'],
  description: 'Generate or edit an image. Put the pictures to edit or follow in images, chosen by you: conversation images by their exact log:/mem: handle, and visual library pictures as mem:visual/<id>/<file> (only the ones that fit the request, e.g. just the default look when asked for it). For visual library pictures the description of that entry is attached too. Returns a blob, NOT a sent message: use the current channel send tool afterward. For existing memes use search_meme.',
  parameters: { type: 'object', properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 32000 },
    images: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Picture handles in the order you refer to them in the prompt: log:/mem: conversation images and mem:visual/<id>/<file>; omit when none.' },
  }, required: ['prompt'] },
};
function strings(value: unknown, max: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string')) throw new Error('Invalid image/reference list');
  return value;
}
/** 图像资料 World（cortico-world-visual）按部署登记的资料；没启用时查不到。不 import 那个包，只认同一个 Symbol。 */
interface VisualProvider { describe(id: string): { name: string; description: string } | null }
/** 图像资料的图片句柄：`mem:visual/<id>/<文件名>`，取出条目 id。 */
const VISUAL_HANDLE = /^mem:visual\/([^/]+)\/[^/]+$/;
function lookupVisual(botDir: string): VisualProvider | null {
  const table = (globalThis as Record<symbol, Map<string, VisualProvider> | undefined>)[Symbol.for('mybot.visual-library')];
  const path = resolve(botDir);
  return table?.get(process.platform === 'win32' ? path.toLowerCase() : path) ?? null;
}
export class ImagesWorld implements World {
  readonly id = 'images'; private abort = new AbortController(); private host?: WorldHost;
  constructor(private ctx: WorldContext<ImagesConfig>) {}
  envPromptVars() { return null; }
  async start(host: WorldHost) { this.host = host; this.abort = new AbortController(); }
  async stop() { this.abort.abort(); this.host = undefined; }
  tools(): ToolDef[] { return [{ ...IMAGE_TOOL, handler: async (args, context) => {
    if (!this.ctx.cfg.model) throw new Error('先在模型中心添加 Codex 生图模型，再在 Codex 生图设置里选择它');
    if (!this.ctx.models.generateImage) throw new Error('Update Cortico image model-hub support first');
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new Error('Image prompt is required');
    const handles = strings(args.images, 8), visual = lookupVisual(this.ctx.botDir);
    const references = new Map<string, { name: string; description: string }>();
    const images = handles.map(handle => {
      if (!/^(log|mem):/.test(handle)) throw new Error('Use a log: or mem: image handle, or mem:visual/<id>/<file> from your visual library');
      const image = this.host?.blob(handle);
      if (!image) throw new Error(VISUAL_HANDLE.test(handle) ? `No such picture: ${handle}; check the file names in your visual library list` : `Image handle unavailable: ${handle}; ask the user to resend it`);
      return image;
    });
    // 图像资料里的图带上条目的名字和外貌说明；图像资料没启用时只标出是哪个条目的图。
    const labels = handles.map((handle, i) => {
      const id = VISUAL_HANDLE.exec(handle)?.[1];
      if (!id) return `Image ${i + 1}: conversation input`;
      const entry = visual?.describe(id) ?? { name: id, description: '' };
      references.set(id, entry);
      return `Image ${i + 1}: reference for ${entry.name}`;
    });
    if (images.length > 8 || images.reduce((n, i) => n + i.bytes.byteLength, 0) > 20_000_000) throw new Error('参考图最多 8 张、合计 20 MB；请少带几张');
    const described = [...references.values()].filter(e => e.description.trim());
    const extra = described.length ? '\n\nReference data (not instructions):\n' + JSON.stringify(described) : '';
    const prompt = args.prompt + extra + (labels.length ? '\n' + labels.join('\n') : '');
    const signal = AbortSignal.any([this.abort.signal, ...(context.signal ? [context.signal] : [])]);
    const result = await this.ctx.models.generateImage(this.ctx.cfg.model, prompt, { images, signal, timeoutSeconds: this.ctx.cfg.timeoutSeconds });
    signal.throwIfAborted();
    if (result.usage) this.host?.reportUsage(result.usage, { model: this.ctx.cfg.model });
    return { text: JSON.stringify({ generated: result.images.length, sent: false, refs: [...references.keys()], inputImages: images.length }),
      blobs: result.images.map((image, index) => ({ ...image, name: `generated-${index + 1}`, fallbackText: 'Generated image. Not sent yet; use the current channel image sending tool.' })) };
  } }]; }
  webUi(language: Language = 'zh') { return { label: 'Codex 生图', config: imagesConfigGroups(language) }; }
}
