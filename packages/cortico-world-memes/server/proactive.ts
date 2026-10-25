import type { EventEnvelope } from 'cortico/core/types.ts';
import type { MemesConfigSection } from '../config.ts';
export const PROACTIVE_HINT = '本轮已命中表情搜索概率：在发送回复前，先调用一次 search_meme，keywords 描述你准备表达的态度和动作。必须先看完候选，再决定是否配图；不要在搜索前以不合适为由跳过。若本轮已经搜索过，直接使用已有候选，不重复搜索。没有贴切候选可以只发文字，用户明确不想收图时不发图。选中后把候选 image 与回复文字一起交给渠道发送工具。用户明确索要表情时不受随机概率限制，应搜索并实际发送；搜索失败或没有合适候选时如实说明。';
/** One draw per delivered chat batch; explicit image requests are governed by the standing prompt. */
export function proactiveHint(config: MemesConfigSection['memes'], events: readonly EventEnvelope[], sample: number): string | null {
  if (!config.enabled || config.maxMemes === 0 || !events.some(event => event.contextDelivery !== 'archive-only' && (event.type.endsWith('.message') || (event.source === 'qq' && event.type === 'qq.group_context')))) return null;
  return sample < config.proactiveSearchPercent / 100 ? PROACTIVE_HINT : null;
}
