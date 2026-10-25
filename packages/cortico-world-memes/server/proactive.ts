import type { EventEnvelope } from 'cortico/core/types.ts';
import type { MemesConfigSection } from '../config.ts';
export const PROACTIVE_HINT = '本轮请主动考虑调用 search_meme，按你准备表达的态度搜索一张贴切表情。结合当前对话选择，不合适可以不发；用户明确不想要图时不要配图。用户明确索要表情时不受随机提示影响，应直接搜索并发送。选中后把候选 image 与回复文字交给渠道发送工具。';
/** One draw per delivered chat batch; explicit image requests are governed by the standing prompt. */
export function proactiveHint(config: MemesConfigSection['memes'], events: readonly EventEnvelope[], sample: number): string | null {
  if (!config.enabled || config.maxMemes === 0 || !events.some(event => event.contextDelivery !== 'archive-only' && (event.type.endsWith('.message') || (event.source === 'qq' && event.type === 'qq.group_context')))) return null;
  return sample < config.proactiveSearchPercent / 100 ? PROACTIVE_HINT : null;
}
