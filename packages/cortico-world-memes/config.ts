import { proactiveStrings } from './server/proactive-strings.ts';
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
export interface MemesConfigSection {
  enabled: boolean;
  memes: { enabled: boolean; pythonFile: string; embeddingModel: string; queryPrefix: string; topK: number;
    captionModel: string; minScore: number; proactiveSearchPercent: number;
    maxMemes: number; timeoutSeconds: number };
}
export const MEMES_DEFAULTS: MemesConfigSection = {
  enabled: false,
  memes: { enabled: true, pythonFile: 'python', embeddingModel: '', queryPrefix: '', topK: 5,
    captionModel: '', minScore: 0.25, proactiveSearchPercent: 50,
    maxMemes: 1, timeoutSeconds: 30 },
};
export function memesConfigGroup(language: Language): ConfigGroup {
  const t = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
  return { id: 'world:memes', owner: 'world:memes', schema: { type: 'object', title: t('向量召回 · 主模型选图', 'Vector retrieval · conversation model selection'), properties: {
    'worlds.memes.memes.enabled': { type: 'boolean', title: t('启用表情检索', 'Enable meme retrieval'), 'x-hot': true },
    'worlds.memes.memes.proactiveSearchPercent': { type: 'integer', ...proactiveStrings(language), minimum: 0, maximum: 100, 'x-hot': true },
    'worlds.memes.memes.pythonFile': { type: 'string', title: t('Python 程序路径（导入 ZIP）', 'Python executable (ZIP import)'), 'x-hot': true },
    'worlds.memes.memes.embeddingModel': { type: 'string', title: t('嵌入模型', 'Embedding model'), 'x-options': 'models:embedding', 'x-hot': true },
    'worlds.memes.memes.queryPrefix': { type: 'string', title: t('查询前缀（与模型服务约定一致）', 'Query prefix (match your model service)'), 'x-hot': true },
    'worlds.memes.memes.topK': { type: 'integer', title: t('候选数量', 'Candidate count'), minimum: 1, maximum: 10, 'x-hot': true },
    'worlds.memes.memes.minScore': { type: 'number', title: t('最低相似度', 'Minimum similarity'), minimum: -1, maximum: 1, 'x-hot': true },
    'worlds.memes.memes.captionModel': { type: 'string', title: t('视觉标注模型', 'Caption model'), 'x-options': 'models:chat:image', 'x-hot': true },
    'worlds.memes.memes.maxMemes': { type: 'integer', title: t('每次选图上限（0 关闭，1 单张）', 'Images per selection (0 off, 1 single)'), minimum: 0, maximum: 1, 'x-hot': true },
    'worlds.memes.memes.timeoutSeconds': { type: 'integer', title: t('视觉标注调用超时（秒）', 'Caption request timeout (seconds)'), minimum: 5, maximum: 120, 'x-hot': true },
  } } };
}
