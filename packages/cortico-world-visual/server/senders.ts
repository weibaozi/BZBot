import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listRuns, runsDirOf } from 'cortico/core/run.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';

/** 一张图是谁、在哪发来的。`sender` 是 QQ 号，控制台发的是 `console`。 */
export interface ImageOrigin { sender: string; source: string; cursor: number }

/**
 * 从事件库里找带这个 log: 句柄的外部消息，读出发送者和聊天。
 * 只认 QQ 消息和图片附件（发送者 QQ 号、meta.conv）和控制台消息；她自己发的、工具回执和其他 World 的事件都不算。
 * 同一张图可能被不同的人发过（句柄按内容寻址），从新到旧全部返回，由调用方挑白名单里的那个。
 */
export function findImageOrigins(dataDir: string, handle: string): ImageOrigin[] {
  const out: ImageOrigin[] = [];
  const needle = JSON.stringify(handle);
  for (const run of listRuns(dataDir).reverse()) {
    let raw: string;
    try { raw = readFileSync(join(runsDirOf(dataDir), run, 'events.jsonl'), 'utf8'); }
    catch { continue; }
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes(needle)) continue;
      let e: EventEnvelope;
      try { e = JSON.parse(lines[i]) as EventEnvelope; } catch { continue; }
      if (e.origin !== 'external' || !e.blobs?.some(b => b.handle === handle)) continue;
      const origin = originOf(e);
      if (origin) out.push(origin);
    }
  }
  return out;
}

function originOf(e: EventEnvelope): ImageOrigin | null {
  if (e.type === 'console.message') return { sender: 'console', source: 'private', cursor: e.cursor };
  // qq.image 是消息之后补到的图片附件，没有 user_id，发送者在 senderKey（QQ 号）里。
  if (e.type !== 'qq.message' && e.type !== 'qq.image') return null;
  const meta = e.meta ?? {};
  const user = meta.user_id ?? e.senderKey, conv = meta.conv as { kind?: unknown; id?: unknown } | undefined;
  if ((typeof user !== 'number' && typeof user !== 'string') || !conv) return null;
  const source = conv.kind === 'group' ? `group:${String(conv.id)}` : conv.kind === 'private' ? 'private' : null;
  return source ? { sender: String(user), source, cursor: e.cursor } : null;
}
