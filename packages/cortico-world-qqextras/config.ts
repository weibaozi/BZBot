import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
export interface QqextrasConfigSection {
  enabled: boolean;
  memes: { enabled: boolean; pythonFile: string; embeddingUrl: string; embeddingModel: string; queryPrefix: string; topK: number };
}
export const QQEXTRAS_DEFAULTS: QqextrasConfigSection = {
  enabled: false,
  memes: { enabled: true, pythonFile: 'python', embeddingUrl: '', embeddingModel: 'BAAI/bge-small-zh-v1.5', queryPrefix: '', topK: 5 },
};
export function qqextrasConfigGroup(language: Language): ConfigGroup {
  const t = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
  return { id: 'world:qqextras', owner: 'world:qqextras', schema: { type: 'object', title: t('表情包子插件', 'Meme feature'), properties: {
    'worlds.qqextras.memes.enabled': { type: 'boolean', title: t('启用表情检索', 'Enable meme retrieval'), 'x-hot': true },
    'worlds.qqextras.memes.pythonFile': { type: 'string', title: t('Python 程序路径（导入 ZIP）', 'Python executable (ZIP import)'), 'x-hot': true },
    'worlds.qqextras.memes.embeddingUrl': { type: 'string', title: t('Embedding 基础地址（以 /v1 结尾）', 'Embedding base URL (ending in /v1)'), 'x-hot': true },
    'worlds.qqextras.memes.embeddingModel': { type: 'string', title: t('Embedding 模型', 'Embedding model'), 'x-hot': true },
    'worlds.qqextras.memes.queryPrefix': { type: 'string', title: t('查询前缀（与模型服务约定一致）', 'Query prefix (match your model service)'), 'x-hot': true },
    'worlds.qqextras.memes.topK': { type: 'integer', title: t('候选数量', 'Candidate count'), minimum: 1, maximum: 10, 'x-hot': true },
  } } };
}
