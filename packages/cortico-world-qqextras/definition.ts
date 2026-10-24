import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { QQEXTRAS_DEFAULTS, type QqextrasConfigSection } from './config.ts';
import { QQEXTRAS_TOOL_DECLS, QqextrasWorld } from './world.ts';
export const QQEXTRAS: WorldDefinition<QqextrasConfigSection> = {
  id: 'qqextras', label: '表情包管理', defaults: () => structuredClone(QQEXTRAS_DEFAULTS),
  create: ctx => new QqextrasWorld(ctx),
  describe: { tools: describeTools(QQEXTRAS_TOOL_DECLS, {
    qqextras_search_memes: { zh: '根据关键词向量召回表情候选，由主模型结合当前对话选择。', en: 'Retrieve vector candidates for the conversation model to choose in context.' },
    qqextras_get_meme: { zh: '读取选中的表情，交给当前渠道发送。', en: 'Read a selected meme for sending through the current channel.' },
  }), events: [] },
};
