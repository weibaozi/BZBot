import type { WorldDefinition } from 'cortico/world.ts';
import { IMAGES_DEFAULTS, type ImagesConfig } from './config.ts';
import { ImagesWorld, IMAGE_TOOL } from './world.ts';
export default {
  id: 'images', label: 'Codex 生图', defaults: () => structuredClone(IMAGES_DEFAULTS),
  create: ctx => new ImagesWorld(ctx), describe: { tools: [IMAGE_TOOL], events: [] },
} satisfies WorldDefinition<ImagesConfig>;
