import type { WorldDefinition } from 'cortico/world.ts';
import { PROACTIVE_DEFAULTS, type ProactiveConfigSection } from './config.ts';
import { ProactiveWorld } from './world.ts';
export const PROACTIVE: WorldDefinition<ProactiveConfigSection> = {
  id: 'proactive', label: '主动聊天', defaults: () => structuredClone(PROACTIVE_DEFAULTS),
  create: ctx => new ProactiveWorld(ctx),
  describe: { tools: [], events: [{ type: 'proactive.due', trigger: 'flush', description: { zh: '在现有会话末尾提醒模型考虑主动私聊。', en: 'Prompt the existing session to consider a private conversation.' } }] },
};
