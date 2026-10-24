import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { QQEXTRAS_DEFAULTS, type QqextrasConfigSection } from './config.ts';
import { QQEXTRAS_TOOL_DECLS, QqextrasWorld } from './world.ts';
export const QQEXTRAS: WorldDefinition<QqextrasConfigSection> = {
  id: 'qqextras', label: '表情包管理', defaults: () => structuredClone(QQEXTRAS_DEFAULTS),
  create: ctx => new QqextrasWorld(ctx),
  describe: { tools: describeTools(QQEXTRAS_TOOL_DECLS, {
    qqextras_choose_meme: { zh: '辅助模型为回复生成检索词、检索并选择表情。', en: 'An auxiliary model retrieves and selects a meme for a reply.' },
    qqextras_get_meme: { zh: '读取选中的表情，交给当前渠道发送。', en: 'Read a selected meme for sending through the current channel.' },
  }), events: [] },
};
