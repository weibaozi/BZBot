import type { EventEnvelope } from 'cortico/core/types.ts';
import type { Chunk } from './store.ts';

/**
 * 这一轮能搜到什么,由这一轮投递进来的对话决定,不信模型传的参数:
 * - 群里:只有这个群的聊天和群档案。
 * - 私聊白名单里的人(全局变量的白名单 QQ)和控制台:全部。
 * - 别人的私聊:和他的私聊,以及有他参与的群聊片段;她自己的笔记和别人的私聊都搜不到。
 * 一轮里同时有群和私聊时取最严的(按群算)。
 */
export interface Scope { label: string; allow(chunk: Pick<Chunk, 'channel' | 'people'>): boolean }

export const FULL: Scope = { label: 'full', allow: () => true };

export function scopeOf(events: readonly EventEnvelope[], trusted: ReadonlySet<string>): Scope | null {
  const groups = new Set<string>();
  const privates = new Set<string>();
  let console = false;
  for (const e of events) {
    if (e.origin !== 'external') continue;
    const conv = e.meta?.conv as { kind?: string; id?: number | string } | undefined;
    if (e.type === 'qq.group_context' && conv?.kind === 'group') groups.add(String(conv.id));
    else if (e.type === 'qq.message' && conv?.kind === 'group' && e.contextDelivery !== 'archive-only') groups.add(String(conv.id));
    else if (e.type === 'qq.message' && conv?.kind === 'private') privates.add(String(conv.id));
    else if (e.type === 'console.message') console = true;
  }
  if (groups.size) {
    return { label: [...groups].map((g) => `group:${g}`).join(','), allow: (c) => [...groups].some((g) => c.channel === `group:${g}`) };
  }
  if (privates.size) {
    if ([...privates].every((p) => trusted.has(p))) return FULL;
    const others = [...privates];
    return {
      label: others.map((p) => `private:${p}`).join(','),
      allow: (c) => others.some((p) => c.channel === `private:${p}` || (c.channel.startsWith('group:') && c.people.includes(`,${p},`))),
    };
  }
  return console ? FULL : null;
}
