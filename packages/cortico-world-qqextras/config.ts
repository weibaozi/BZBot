import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
export interface QqextrasConfigSection {
  enabled: boolean;
  memes: { enabled: boolean; pythonFile: string; embeddingUrl: string; embeddingModel: string; queryPrefix: string; topK: number;
    auxiliaryUrl: string; auxiliaryModel: string; visionUrl: string; visionModel: string; minScore: number;
    probability: number; maxMemes: number; contextTurns: number; injectPersona: boolean; timeoutSeconds: number };
}
export const QQEXTRAS_DEFAULTS: QqextrasConfigSection = {
  enabled: false,
  memes: { enabled: true, pythonFile: 'python', embeddingUrl: '', embeddingModel: 'BAAI/bge-small-zh-v1.5', queryPrefix: '', topK: 5,
    auxiliaryUrl: '', auxiliaryModel: '', visionUrl: '', visionModel: '', minScore: 0.25,
    probability: 100, maxMemes: 1, contextTurns: 0, injectPersona: false, timeoutSeconds: 30 },
};
export function qqextrasConfigGroup(language: Language): ConfigGroup {
  const t = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
  return { id: 'world:qqextras', owner: 'world:qqextras', schema: { type: 'object', title: t('辅助模型语义搜索', 'Auxiliary semantic search'), properties: {
    'worlds.qqextras.memes.enabled': { type: 'boolean', title: t('启用表情检索', 'Enable meme retrieval'), 'x-hot': true },
    'worlds.qqextras.memes.pythonFile': { type: 'string', title: t('Python 程序路径（导入 ZIP）', 'Python executable (ZIP import)'), 'x-hot': true },
    'worlds.qqextras.memes.embeddingUrl': { type: 'string', title: t('Embedding 基础地址（以 /v1 结尾）', 'Embedding base URL (ending in /v1)'), 'x-hot': true },
    'worlds.qqextras.memes.embeddingModel': { type: 'string', title: t('Embedding 模型', 'Embedding model'), 'x-hot': true },
    'worlds.qqextras.memes.queryPrefix': { type: 'string', title: t('查询前缀（与模型服务约定一致）', 'Query prefix (match your model service)'), 'x-hot': true },
    'worlds.qqextras.memes.topK': { type: 'integer', title: t('候选数量', 'Candidate count'), minimum: 1, maximum: 10, 'x-hot': true },
    'worlds.qqextras.memes.minScore': { type: 'number', title: t('最低相似度', 'Minimum similarity'), minimum: -1, maximum: 1, 'x-hot': true },
    'worlds.qqextras.memes.auxiliaryUrl': { type: 'string', title: t('辅助选图模型地址（OpenAI 兼容 /v1）', 'Auxiliary model base URL (OpenAI compatible /v1)'), 'x-hot': true },
    'worlds.qqextras.memes.auxiliaryModel': { type: 'string', title: t('辅助选图模型名称', 'Auxiliary model name'), 'x-hot': true },
    'worlds.qqextras.memes.visionUrl': { type: 'string', title: t('视觉标注模型地址（OpenAI 兼容 /v1）', 'Caption model base URL (OpenAI compatible /v1)'), 'x-hot': true },
    'worlds.qqextras.memes.visionModel': { type: 'string', title: t('视觉标注模型名称', 'Caption model name'), 'x-hot': true },
    'worlds.qqextras.memes.probability': { type: 'integer', title: t('配图概率（%）', 'Selection probability (%)'), minimum: 0, maximum: 100, 'x-hot': true },
    'worlds.qqextras.memes.maxMemes': { type: 'integer', title: t('每次选图上限（0 关闭，1 单张）', 'Images per selection (0 off, 1 single)'), minimum: 0, maximum: 1, 'x-hot': true },
    'worlds.qqextras.memes.contextTurns': { type: 'integer', title: t('辅助模型参考的最近对话轮数', 'Recent turns supplied to auxiliary model'), minimum: 0, maximum: 10, 'x-hot': true },
    'worlds.qqextras.memes.injectPersona': { type: 'boolean', title: t('允许传入人设摘要供辅助模型参考', 'Allow persona summary for auxiliary model'), 'x-hot': true },
    'worlds.qqextras.memes.timeoutSeconds': { type: 'integer', title: t('每次辅助模型调用超时（秒）', 'Auxiliary request timeout (seconds)'), minimum: 5, maximum: 120, 'x-hot': true },
  } } };
}
