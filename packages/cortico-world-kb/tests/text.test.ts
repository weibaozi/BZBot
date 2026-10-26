import { expect, it } from 'vitest';
import { chatLine, cleanContent, formatLine, isGroupNoise } from '../server/text.ts';
import { matchQuery, shortTerms } from '../server/search.ts';
import { sections, windows, fileChannel } from '../server/indexer.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';

const event = (over: Partial<EventEnvelope>): EventEnvelope => ({ cursor: 1, type: 'qq.message', ts: '2026-10-20T10:00:00.000Z', source: 'qq', origin: 'external', text: '', ...over }) as EventEnvelope;

it('keeps only text: pictures and stickers become [图], attachment lines go', () => {
  expect(cleanContent('看这个[图片 https://x/y.png][图片:meme:abc]\n[blob log:1.png image/png] 你发出的图片')).toBe('看这个[图]');
  expect(cleanContent('[QQ表情]哈[表情:doge] [回复#-123]好')).toBe('[图]哈[图] [回复]好');
});

it('reads sender, chat and group name from QQ events', () => {
  const group = chatLine(event({ cursor: 7, text: '#-1351728706 [群「夜半、 肥鱼」 01:31] 划破寂寞的天空(361270936): @肥鱼包(你) 你饿了吗',
    senderKey: '361270936', meta: { user_id: 361270936, sender_name: '划破寂寞的天空', mentionedSelf: true, conv: { kind: 'group', id: 922728092 } } }));
  expect(group).toMatchObject({ cursor: 7, channel: 'group:922728092', user: '361270936', name: '划破寂寞的天空', mentioned: true, self: false,
    content: '@肥鱼包(你) 你饿了吗', groupName: '夜半、 肥鱼' });
  const self = chatLine(event({ type: 'qq.self', text: '#1 [私聊 13:43] 你: 嘿嘿: 被夸了', meta: { user_id: 921460361, conv: { kind: 'private', id: 361270936 } } }));
  expect(self).toMatchObject({ channel: 'private:361270936', user: 'self', self: true, content: '嘿嘿: 被夸了' });
  expect(chatLine(event({ type: 'qq.group_context', meta: { conv: { kind: 'group', id: 1 } } }))).toBeNull();
  expect(formatLine(self!, 'UTC')).toBe('10-20 10:00 你: 嘿嘿: 被夸了');
});

it('treats short, command and picture-only group messages as noise unless she is involved', () => {
  const base = { cursor: 1, at: 0, channel: 'group:1', user: '2', name: 'a', self: false, mentioned: false };
  expect(isGroupNoise({ ...base, content: '哈哈' }, 4)).toBe(true);
  expect(isGroupNoise({ ...base, content: '[图]' }, 4)).toBe(true);
  expect(isGroupNoise({ ...base, content: '/签到 今天' }, 4)).toBe(true);
  expect(isGroupNoise({ ...base, content: '周末去爬山吗' }, 4)).toBe(false);
  expect(isGroupNoise({ ...base, content: '嗯', mentioned: true }, 4)).toBe(false);
});

it('splits windows by gap and size, sections by heading, and builds a trigram query', () => {
  const at = (min: number, cursor: number) => ({ cursor, at: min * 60_000, channel: 'x', user: '1', name: 'a', self: false, mentioned: false, content: 'x' });
  expect(windows([at(0, 1), at(10, 2), at(50, 3), at(51, 4), at(52, 5)], 30 * 60_000, 2).map((w) => w.map((l) => l.cursor))).toEqual([[1, 2], [3, 4], [5]]);
  expect(sections('intro\n# 一\n内容一\n## 二\n内容二')).toEqual(['intro', '# 一\n内容一', '## 二\n内容二']);
  expect(sections('a'.repeat(1700), 800).map((s) => s.length)).toEqual([800, 800, 100]);
  expect(matchQuery('周六 去 看海吗')).toBe('"看海吗"');
  expect(matchQuery('周六去看海')).toBe('"周六去" OR "六去看" OR "去看海"');
  expect(matchQuery('好 吗')).toBeNull();
  expect(shortTerms('开摆 是 什么意思')).toEqual(['开摆']);
  expect(fileChannel('groups/922728092.md', '')).toBe('group:922728092');
  expect(fileChannel('visual/cat/entry.md', '---\nowner: 123\nsource: private\n---')).toBe('private:123');
  expect(fileChannel('note/library/a.md', '')).toBe('file');
});
