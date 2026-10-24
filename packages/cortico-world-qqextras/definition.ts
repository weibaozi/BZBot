import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { QQEXTRAS_DEFAULTS, type QqextrasConfigSection } from './config.ts';
import { QQEXTRAS_TOOL_DECLS, QqextrasWorld } from './world.ts';
export const QQEXTRAS: WorldDefinition<QqextrasConfigSection> = {
  id: 'qqextras', label: 'QQ 功能', defaults: () => structuredClone(QQEXTRAS_DEFAULTS),
  create: ctx => new QqextrasWorld(ctx),
  describe: { tools: describeTools(QQEXTRAS_TOOL_DECLS, {
    qqextras_search_memes: { zh: '按想表达的意思检索表情候选。', en: 'Retrieve memes for an intended response.' },
    qqextras_get_meme: { zh: '读取选中的表情，交给 QQ 工具发送。', en: 'Read a selected meme for sending through QQ tools.' },
  }), events: [] },
};
