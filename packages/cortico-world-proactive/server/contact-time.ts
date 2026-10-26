import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventEnvelope, WorldHost } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';

const rule = '结合当前当地时间、距对方上次交流的间隔，以及已有相处记忆，自然调整回应。久别重逢可以表现亲近、好奇或关心，但优先回应对方当下的话题，不必每次提及时间。';
interface Contact { at: string; cursor: number }

/** Last delivered incoming message per trusted QQ identity, shared across conversations. */
export class ContactTime {
  private contacts: Record<string, Contact>;
  constructor(private path: string, private timezone: string, private trusted: () => readonly string[], private store: WorldHost['store']) {
    this.contacts = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    for (const [id, value] of Object.entries(this.contacts)) {
      if (!/^\d+$/.test(id) || !value || !Number.isFinite(Date.parse(value.at)) || !Number.isSafeInteger(value.cursor)) throw new Error('Invalid contact time state');
    }
  }
  hint = (events: readonly EventEnvelope[]): string | null => {
    const allowed = new Set(this.trusted());
    const before = JSON.stringify(this.contacts);
    for (const id of Object.keys(this.contacts)) if (!allowed.has(id)) delete this.contacts[id];
    const messages = new Map<number, EventEnvelope>();
    const add = (e: EventEnvelope) => {
      if (e.source === 'qq' && e.origin === 'external' && e.type === 'qq.message' && allowed.has(String(e.meta?.user_id))) messages.set(e.cursor, e);
    };
    for (const event of events) {
      if (event.source !== 'qq' || event.origin !== 'external') continue;
      if (event.type === 'qq.message') add(event);
      else if (event.type === 'qq.group_context' && Array.isArray(event.meta?.triggerMessageCursors)) {
        for (const cursor of event.meta.triggerMessageCursors) {
          if (!Number.isSafeInteger(cursor) || cursor < 1) continue;
          const original = this.store.range({ fromCursor: cursor, toCursor: cursor })[0];
          if (original) add(original);
        }
      }
    }
    const lines = new Map<string, string>();
    for (const event of [...messages.values()].sort((a, b) => a.cursor - b.cursor)) {
      const id = String(event.meta!.user_id), previous = this.contacts[id];
      const at = Date.parse(event.ts);
      if (!Number.isFinite(at) || (previous && (event.cursor <= previous.cursor || at < Date.parse(previous.at)))) continue;
      if (!lines.has(id)) {
        const elapsed = previous ? Math.floor((at - Date.parse(previous.at)) / 1000) : null;
        lines.set(id, `QQ ${id}：本次发言 ${nowIso(this.timezone, new Date(at))}；` + (previous
          ? `上次进入对话的发言 ${nowIso(this.timezone, new Date(previous.at))}；两次相隔 ${elapsed} 秒（约 ${Math.floor(elapsed! / 86400)} 天 ${Math.floor(elapsed! % 86400 / 3600)} 小时 ${Math.floor(elapsed! % 3600 / 60)} 分钟）。`
          : '此前暂无交流时间记录，不能据此判断多久没聊。'));
      }
      this.contacts[id] = { at: event.ts, cursor: event.cursor };
    }
    if (before !== JSON.stringify(this.contacts)) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.contacts, null, 2) + '\n');
      renameSync(`${this.path}.tmp`, this.path);
    }
    return lines.size ? `[交流时间] 当前当地时间 ${nowIso(this.timezone)}，时区 ${this.timezone}。\n${[...lines.values()].join('\n')}\n${rule}` : null;
  };
}
