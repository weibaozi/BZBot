import type { WorldSection } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
export interface ImagesConfig extends WorldSection { model: string; timeoutSeconds: number }
export const IMAGES_DEFAULTS: ImagesConfig = { enabled: false, model: '', timeoutSeconds: 180 };
export function imagesConfigGroups(language: Language) {
    const zh = language.startsWith('zh');
    return [{ id: 'world:images', owner: 'world:images' as const, schema: { type: 'object' as const,
      title: zh ? '生图设置' : 'Image generation', properties: {
        'worlds.images.model': { type: 'string' as const, title: zh ? '生图模型' : 'Image model', 'x-options': 'models:image', 'x-hot': true },
        'worlds.images.timeoutSeconds': { type: 'integer' as const, title: zh ? '生图超时' : 'Image timeout', minimum: 1, maximum: 3600, 'x-suffix': 's', 'x-hot': true },
      } } }];
}
