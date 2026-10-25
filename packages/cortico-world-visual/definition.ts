import type { WorldDefinition } from 'cortico/world.ts';
import { VISUAL_DEFAULTS, type VisualConfig } from './config.ts';
import { VisualWorld, SAVE_TOOL } from './world.ts';
export default {
  id: 'visual', label: '图像资料', defaults: () => structuredClone(VISUAL_DEFAULTS),
  create: ctx => new VisualWorld(ctx), describe: { tools: [SAVE_TOOL], events: [] },
} satisfies WorldDefinition<VisualConfig>;
