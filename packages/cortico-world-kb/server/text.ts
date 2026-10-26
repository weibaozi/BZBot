import type { EventEnvelope } from 'cortico/core/types.ts';

/** 一条聊天消息,只取知识库要的东西。`channel` 是 `private:<QQ号>`、`group:<群号>` 或 `console`。 */
export interface ChatLine {
  cursor: number;
  at: number;
  channel: string;
  /** 发送者 QQ 号;她自己发的是 `self`,控制台是 `console`。 */
  user: string;
  name: string;
  self: boolean;
  mentioned: boolean;
  content: string;
  /** 群名,只有群消息带。 */
  groupName?: string;
}

const HEAD = /^#-?\d+ \[(私聊|群「([^」]*)」)[^\]]*\] /;

/**
 * 去掉事件正文里的消息号、时间和发送者前缀,图片和表情一律换成 `[图]`,附件行(`[blob …]`)整行删掉。
 * 群聊和私聊同样处理:知识库只存文字,不存图也不存识图描述。
 */
export function cleanContent(text: string): string {
  return text.split(/\r?\n/)
    .filter((line) => !/^\[blob /.test(line.trim()))
    .join('\n')
    // QQ 写法:[图片] / [图片 <url>] / [图片:<句柄>] / [QQ表情] / [表情:名字];回复只留标记,不留消息号。
    .replace(/\[(图片|QQ表情|表情|动画表情|闪照)([:： ][^\]]*)?\]/g, '[图]')
    .replace(/\[回复#-?\d+\]/g, '[回复]')
    .replace(/(\[图\]\s*){2,}/g, '[图] ')
    .trim();
}

/** 从事件里取一条聊天消息;不是 QQ / 控制台的对话消息就返回 null。 */
export function chatLine(e: EventEnvelope): ChatLine | null {
  const at = Date.parse(e.ts);
  if (!Number.isFinite(at)) return null;
  if (e.type === 'console.message' || e.type === 'console.self') {
    const self = e.type === 'console.self';
    return { cursor: e.cursor, at, channel: 'console', user: self ? 'self' : 'console', name: self ? '你' : (e.senderKey || '控制台'), self, mentioned: false, content: cleanContent(e.text) };
  }
  if (e.type !== 'qq.message' && e.type !== 'qq.self') return null;
  const meta = e.meta ?? {};
  const conv = meta.conv as { kind?: string; id?: number | string } | undefined;
  if (!conv || (conv.kind !== 'private' && conv.kind !== 'group') || conv.id === undefined) return null;
  const self = e.type === 'qq.self';
  const head = HEAD.exec(e.text);
  // 前缀之后是「发送者(QQ号): 正文」或「你: 正文」;取冒号之后的正文。
  const rest = head ? e.text.slice(head[0].length) : e.text;
  const colon = rest.indexOf(': ');
  const body = colon >= 0 ? rest.slice(colon + 2) : rest;
  return {
    cursor: e.cursor, at,
    channel: `${conv.kind}:${conv.id}`,
    user: self ? 'self' : String(meta.user_id ?? e.senderKey ?? ''),
    name: self ? '你' : String(meta.sender_name ?? meta.user_id ?? ''),
    self,
    mentioned: meta.mentionedSelf === true,
    content: cleanContent(body),
    ...(conv.kind === 'group' && head?.[2] !== undefined ? { groupName: head[2].trim() } : {}),
  };
}

/** 群聊里的噪音:太短、只有图、指令。私聊不过滤,一句「好看」也是上下文。 */
export function isGroupNoise(line: ChatLine, minChars: number): boolean {
  const text = line.content.replace(/\[图\]/g, '').replace(/@\S+/g, '').trim();
  if (line.self || line.mentioned) return false;
  if (text.startsWith('/')) return true;
  return [...text].length < minChars;
}

/** 一行写进片段的样子:`10-25 13:42 名字(QQ号): 正文`。 */
export function formatLine(line: ChatLine, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(line.at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const who = line.self ? '你' : line.user === 'console' ? line.name : `${line.name}(${line.user})`;
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${who}: ${line.content}`;
}
