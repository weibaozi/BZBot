import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { MEMES_DEFAULTS, type MemesConfigSection } from './config.ts';
import { MEMES_TOOL_DECLS, MemesWorld } from './world.ts';
export const MEMES: WorldDefinition<MemesConfigSection> = {
  id: 'memes', label: '表情包管理', defaults: () => structuredClone(MEMES_DEFAULTS),
  create: ctx => new MemesWorld(ctx),
  describe: { tools: describeTools(MEMES_TOOL_DECLS, {
    search_meme: { zh: '根据关键词向量召回表情候选，由主模型结合当前对话选择。', en: 'Retrieve vector candidates for the conversation model to choose in context.' },
    get_meme: { zh: '读取选中的表情，交给当前渠道发送。', en: 'Read a selected meme for sending through the current channel.' },
  }), events: [] },
};
