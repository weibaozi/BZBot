import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventEnvelope, WorldHost } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';

const rule = '结合当前当地时间、距对方上次交流的间隔，以及已有相处记忆，自然调整回应。久别重逢可以表现亲近、好奇或关心，但优先回应对方当下的话题，不必每次提及时间。';
interface Contact { at: string; cursor: number; previousAt?: string }

/** Tracks trusted incoming QQ messages, including groups that do not trigger replies. */
export class ContactTime {
  private contacts: Record<string, Contact>;
  private scanned: number;
  private gaps = new Map<number, string | undefined>();
  private delivered = 0;
  constructor(private path: string, private timezone: string, private trusted: () => readonly string[], private store: WorldHost['store'], private gapHours: () => number = () => 1) {
    this.contacts = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    for (const [id, value] of Object.entries(this.contacts)) {
      if (!/^\d+$/.test(id) || !value || !Number.isFinite(Date.parse(value.at)) || !Number.isSafeInteger(value.cursor)) throw new Error('Invalid contact time state');
    }
    const cursors = Object.values(this.contacts).map(value => value.cursor);
    this.scanned = cursors.length ? Math.min(...cursors) : store.latestCursor();
  }
  sync() {
    const allowed = new Set(this.trusted());
    const before = JSON.stringify(this.contacts);
    for (const id of Object.keys(this.contacts)) if (!allowed.has(id)) delete this.contacts[id];
    const latest = this.store.latestCursor();
    for (const event of this.store.range({source:'qq',fromCursor:this.scanned + 1,toCursor:latest})) {
      const id = String(event.meta?.user_id), previous = this.contacts[id];
      if (event.origin !== 'external' || event.type !== 'qq.message' || !allowed.has(id)) continue;
      const at = Date.parse(event.ts);
      if (!Number.isFinite(at) || (previous && (event.cursor <= previous.cursor || at < Date.parse(previous.at)))) continue;
      this.gaps.set(event.cursor, previous?.at);
      this.contacts[id] = {at:event.ts,cursor:event.cursor,previousAt:previous?.at};
    }
    this.scanned = latest;
    // Bound transient lookup state; older queued messages simply receive no time hint.
    while (this.gaps.size > 1024) this.gaps.delete(this.gaps.keys().next().value!);
    if (before !== JSON.stringify(this.contacts)) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.contacts, null, 2) + '\n');
      renameSync(`${this.path}.tmp`, this.path);
    }
  }
  hint = (events: readonly EventEnvelope[]): string | null => {
    this.sync();
    const allowed = new Set(this.trusted());
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
          const original = this.store.get(cursor);
          if (original) add(original);
        }
      }
    }
    const lines: string[] = [], seen = new Set<string>();
    for (const event of [...messages.values()].sort((a, b) => a.cursor - b.cursor)) {
      if (event.cursor <= this.delivered) continue;
      this.delivered = event.cursor;
      const id = String(event.meta!.user_id);
      if (seen.has(id)) continue;
      seen.add(id);
      const previous = this.gaps.get(event.cursor) ?? (this.contacts[id]?.cursor === event.cursor ? this.contacts[id].previousAt : undefined);
      if (!previous) continue;
      const elapsed = Date.parse(event.ts) - Date.parse(previous);
      if (elapsed <= this.gapHours() * 3600000) continue;
      const minutes = Math.floor(elapsed / 60000);
      const time = nowIso(this.timezone, new Date(event.ts)).replace('T',' ').replace(/\.\d{3}([+-]\d{2}:\d{2})$/, '（UTC$1）');
      lines.push(`[交流时间] 当地时间：${time}。QQ ${id}：距上次交流 ${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时 ${minutes % 60} 分钟。`);
    }
    return lines.length ? `${lines.join('\n')}\n${rule}` : null;
  };
}
