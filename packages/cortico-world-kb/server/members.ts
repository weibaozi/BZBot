import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listRuns, runsDirOf } from 'cortico/core/run.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';
import { chatLine } from './text.ts';

export interface Member {
  qq: string;
  /** 在这个群里用过的昵称,最近的在前。 */
  names: string[];
  messages: number;
  lastAt: string;
  /** 有没有 `people/<QQ号>.md`。 */
  peopleFile: boolean;
}
export interface GroupMembers { group: string; groupName: string; days: number; members: Member[] }

/**
 * 某个群最近谁说过话:直接数事件库里的群消息,不调模型。昵称、条数、最后一次的时间都是事实;
 * 每人标出有没有 people 档案,方便她按 QQ 号把群和人对上。
 */
export function groupMembers(dataDir: string, memoryDir: string, group: string, days: number, timezone: string, now = Date.now()): GroupMembers {
  const since = now - days * 86_400_000;
  const channel = `group:${group}`;
  const byUser = new Map<string, { names: string[]; messages: number; lastAt: number }>();
  let groupName = '';
  for (const run of listRuns(dataDir)) {
    let raw: string;
    try { raw = readFileSync(join(runsDirOf(dataDir), run, 'events.jsonl'), 'utf8'); } catch { continue; }
    for (const text of raw.split('\n')) {
      if (!text.includes('"qq.message"') || !text.includes(`"id":${group}`) && !text.includes(`"id":"${group}"`)) continue;
      let e: EventEnvelope;
      try { e = JSON.parse(text) as EventEnvelope; } catch { continue; }
      const line = chatLine(e);
      if (!line || line.channel !== channel || line.self || !/^\d+$/.test(line.user) || line.at < since) continue;
      if (line.groupName) groupName = line.groupName;
      const entry = byUser.get(line.user) ?? { names: [], messages: 0, lastAt: 0 };
      entry.messages++;
      if (line.at >= entry.lastAt) { entry.lastAt = line.at; entry.names = [line.name, ...entry.names.filter((n) => n !== line.name)]; }
      else if (!entry.names.includes(line.name)) entry.names.push(line.name);
      byUser.set(line.user, entry);
    }
  }
  const stamp = (at: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));
  const members = [...byUser].map(([qq, m]) => ({
    qq, names: m.names.filter(Boolean), messages: m.messages, lastAt: stamp(m.lastAt), peopleFile: existsSync(join(memoryDir, 'people', `${qq}.md`)),
  })).sort((a, b) => b.messages - a.messages);
  return { group, groupName, days, members };
}
