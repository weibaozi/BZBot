import type { WorldContext } from 'cortico/world.ts';
import type { World, WorldHost, ToolDef } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { imagesConfigGroups, type ImagesConfig } from './config.ts';
export const IMAGE_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'images_generate', tags: ['write'], description: 'Generate a new image from a prompt when requested. Returns a blob handle, not a sent message. Use the current channel sending tool to send it; do not invent image handles. For existing memes use search_meme instead.',
  parameters: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 32000 } }, required: ['prompt'] },
};
export class ImagesWorld implements World {
  readonly id = 'images'; private abort = new AbortController(); private host?: WorldHost;
  constructor(private ctx: WorldContext<ImagesConfig>) {}
  envPromptVars() { return null; }
  async start(host: WorldHost) { this.host = host; this.abort = new AbortController(); }
  async stop() { this.abort.abort(); this.host = undefined; }
  tools(): ToolDef[] { return [{ ...IMAGE_TOOL, handler: async (args, context) => {
    if (!this.ctx.cfg.model) throw new Error('先在模型中心添加生图模型，再在生图设置里选择它');
    if (!this.ctx.models.generateImage) throw new Error('Update Cortico image model-hub support first');
    if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new Error('Image prompt is required');
    const signal = AbortSignal.any([this.abort.signal, ...(context.signal ? [context.signal] : [])]);
    const result = await this.ctx.models.generateImage(this.ctx.cfg.model, args.prompt, { signal, timeoutSeconds: this.ctx.cfg.timeoutSeconds });
    signal.throwIfAborted();
    if (result.usage) this.host?.reportUsage(result.usage, { model: this.ctx.cfg.model });
    return { text: JSON.stringify({ generated: result.images.length, sent: false }),
      blobs: result.images.map((image, index) => ({ ...image, name: `generated-${index + 1}`, fallbackText: 'Generated image. Not sent yet; use the current channel image sending tool.' })) };
  } }]; }
  webUi(language: Language = 'zh') { return { config: imagesConfigGroups(language) }; }
}
