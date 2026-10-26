import type { WorldSection } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
export interface KbConfig extends WorldSection {
  /** 模型中心的嵌入模型引用;空 = 只用全文检索。 */
  embeddingModel: string;
  /** 两条消息间隔超过这么多分钟就切成新的一段。 */
  gapMinutes: number;
  /** 一段最多这么多条消息。 */
  maxMessages: number;
  /** 群聊只收她说过话或被 @ 的片段。 */
  groupOnlyParticipated: boolean;
  /** 群聊片段保留天数,0 = 不过期。 */
  groupRetentionDays: number;
  /** 群里短于这么多字的消息当噪音丢掉(她自己的和 @ 她的除外)。 */
  groupMinChars: number;
  /** 不进索引的群号,逗号分隔。 */
  excludedGroups: string;
  /** 定时补索引的间隔(分钟)。 */
  intervalMinutes: number;
  /** 只靠向量命中时的最低相似度(0–1)。 */
  minSimilarity: number;
}
export const KB_DEFAULTS: KbConfig = {
  enabled: false, embeddingModel: '', gapMinutes: 30, maxMessages: 20, groupOnlyParticipated: true,
  groupRetentionDays: 30, groupMinChars: 4, excludedGroups: '', intervalMinutes: 5, minSimilarity: 0.45,
};
export function excludedGroupsOf(cfg: KbConfig): Set<string> {
  return new Set(cfg.excludedGroups.split(/[\s,，;；]+/).filter((s) => /^\d+$/.test(s)));
}
export function kbConfigGroups(language: Language) {
  const zh = language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const int = (title: string, minimum: number, maximum: number, suffix?: string, description?: string) =>
    ({ type: 'integer' as const, title, minimum, maximum, 'x-hot': true, ...(suffix ? { 'x-suffix': suffix } : {}), ...(description ? { description } : {}) });
  return [{ id: 'world:kb', owner: 'world:kb' as const, schema: { type: 'object' as const, title: t('知识库设置', 'Knowledge base'),
    description: t('她主动查记忆用的索引:聊天原文和不在前缀里的记忆文件。改动下次索引时生效;换嵌入模型会重算全部向量。', 'The index she searches on her own: chat logs and memory files outside the prefix. Changes apply on the next run; a new embedding model recomputes all vectors.'),
    properties: {
      'worlds.kb.embeddingModel': { type: 'string' as const, title: t('嵌入模型', 'Embedding model'), 'x-options': 'models:embedding', 'x-hot': true,
        description: t('留空只用全文检索。', 'Empty uses full-text search only.') },
      'worlds.kb.groupOnlyParticipated': { type: 'boolean' as const, title: t('群聊只收她参与过的片段', 'Group chats: only windows she took part in'), 'x-hot': true },
      'worlds.kb.groupRetentionDays': int(t('群聊片段保留天数', 'Keep group windows for'), 0, 3650, t('天', 'days'), t('0 表示不过期;私聊和笔记不过期。', '0 keeps them; private chats and notes never expire.')),
      'worlds.kb.groupMinChars': int(t('群聊最短消息', 'Shortest group message'), 0, 50, t('字', 'chars')),
      'worlds.kb.excludedGroups': { type: 'string' as const, title: t('不索引的群', 'Groups not indexed'), 'x-hot': true, description: t('群号,逗号分隔。', 'Group numbers, comma separated.') },
      'worlds.kb.gapMinutes': int(t('切段间隔', 'Split after a gap of'), 1, 1440, t('分钟', 'min')),
      'worlds.kb.maxMessages': int(t('每段最多消息数', 'Messages per window'), 2, 200),
      'worlds.kb.intervalMinutes': int(t('定时索引间隔', 'Index every'), 1, 1440, t('分钟', 'min')),
      'worlds.kb.minSimilarity': { type: 'number' as const, title: t('向量最低相似度', 'Minimum vector similarity'), minimum: 0, maximum: 1, 'x-hot': true,
        description: t('只靠向量命中的结果要达到这个相似度;太低会搜出不相干的记录,太高会漏。全文命中的不受限。', 'Results found only by vectors must reach this similarity; too low returns unrelated records, too high misses. Full-text matches are not limited.') },
    } } }];
}
