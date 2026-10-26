import type { WorldDefinition } from 'cortico/world.ts';
import { KB_DEFAULTS, type KbConfig } from './config.ts';
import { KbWorld, MEMBERS_TOOL, OPEN_TOOL, RECALL_TOOL } from './world.ts';
export default {
  id: 'kb', label: '知识库', defaults: () => structuredClone(KB_DEFAULTS),
  create: ctx => new KbWorld(ctx), describe: { tools: [RECALL_TOOL, OPEN_TOOL, MEMBERS_TOOL], events: [] },
} satisfies WorldDefinition<KbConfig>;
