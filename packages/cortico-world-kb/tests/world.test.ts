import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { KbWorld } from '../world.ts';
import { KB_DEFAULTS, type KbConfig } from '../config.ts';
import { runIndex } from '../server/indexer.ts';
import { NO_MODELS } from 'cortico/providers/model-hub.ts';
import type { EventEnvelope, World, WorldHost } from 'cortico/core/types.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';

/** 假嵌入:字的二元组哈希到 64 维。只为让向量检索有东西可比,不追求语义。 */
function fakeEmbed(text: string): number[] {
  const v = new Array(64).fill(0);
  const chars = [...text];
  for (let i = 0; i + 1 < chars.length; i++) v[(chars[i].codePointAt(0)! * 31 + chars[i + 1].codePointAt(0)!) % 64] += 1;
  return v.some(Boolean) ? v : [1, ...v.slice(1)];
}

/** 只拿宿主、往真实事件库里写 QQ 消息的替身 World。 */
class Inbox implements World {
  readonly id = 'inbox'; host!: WorldHost;
  envPromptVars() { return null; }
  async start(host: WorldHost) { this.host = host; }
  async stop() {}
  tools() { return []; }
  async push(type: 'qq.message' | 'qq.self', conv: { kind: 'private' | 'group'; id: number }, user: number, name: string, content: string, at: string, mentioned = false) {
    const head = conv.kind === 'group' ? `[群「夜半群」 ${at.slice(11, 16)}]` : `[私聊 ${at.slice(11, 16)}]`;
    const who = type === 'qq.self' ? '你' : `${name}(${user})`;
    return this.host.pushEvent({ type, ts: at, source: 'qq', text: `#1 ${head} ${who}: ${content}`, senderKey: String(user),
      meta: { message_id: 1, user_id: user, sender_name: name, mentionedSelf: mentioned, conv } }, { deliver: false });
  }
}

const OWNER = 361270936, FRIEND = 555555, GROUP = 922728092;
const ctxEvent = (type: string, conv: { kind: string; id: number }): EventEnvelope =>
  ({ cursor: 0, type, ts: new Date().toISOString(), source: 'qq', origin: 'external', text: '', meta: { conv } }) as EventEnvelope;

it('indexes chats and notes, keeps each chat to its own audience, and opens results in context', async () => {
  const tmp = makeTmpDir(), memoryDir = join(tmp.dir, 'memory'), dataDir = join(tmp.dir, 'data');
  mkdirSync(join(memoryDir, 'note', 'library'), { recursive: true });
  mkdirSync(join(memoryDir, 'groups'), { recursive: true });
  mkdirSync(join(memoryDir, 'people'), { recursive: true });
  writeFileSync(join(memoryDir, 'CONSTITUTION.md'), 'Fixture');
  writeFileSync(join(memoryDir, 'people', `${OWNER}.md`), '# 包子\n主人,喜欢鲸鱼');
  writeFileSync(join(memoryDir, 'note', 'library', 'trip.md'), '# 旅行计划\n主人想去青岛看灯塔,预算三千');
  writeFileSync(join(memoryDir, 'groups', `${GROUP}.md`), '# 夜半群\n群里的梗:「开摆」指周五下班');
  const cfg = makeCfg(); cfg.worlds.qq.enabled = false; cfg.worlds.console.enabled = false; cfg.web.port = 0;
  cfg.tick.dayIntervalMinutes = [999, 999]; cfg.tick.nightIntervalMinutes = null; cfg.timezone = 'UTC';
  const bot = assembleBot(makeLoaded({ config: cfg, rootDir: tmp.dir, memoryDir, dataDir }), { llm: new FakeLLM() });
  const kbCfg: KbConfig = { ...KB_DEFAULTS, enabled: true, embeddingModel: 'local/emb' };
  const embedded: string[] = [];
  const world = new KbWorld({ id: 'kb', cfg: kbCfg, timezone: 'UTC', botName: 'fixture', botDir: tmp.dir, packageDir: tmp.dir, dataDir, repoRoot: tmp.dir,
    models: { ...NO_MODELS, embed: async (_ref, texts) => { embedded.push(...texts); return texts.map(fakeEmbed); } },
    globals: () => ({ trustedQQ: [String(OWNER)] }), secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {} });
  const inbox = new Inbox();
  const context = { role: 'main', log: nullLogger() };
  try {
    await bot.start(); await bot.core.mountWorld(inbox);
    const priv = { kind: 'private' as const, id: OWNER }, friend = { kind: 'private' as const, id: FRIEND }, group = { kind: 'group' as const, id: GROUP };
    await inbox.push('qq.message', priv, OWNER, '包子', '周六我们去海边看日落吧', '2026-10-20T10:00:00.000Z');
    await inbox.push('qq.self', priv, 921460361, '你', '好呀 我要带上小鲸鱼', '2026-10-20T10:01:00.000Z');
    await inbox.push('qq.message', friend, FRIEND, '小明', '我的生日是三月五号别忘了', '2026-10-20T11:00:00.000Z');
    // 她没参与的群聊:不进索引。
    await inbox.push('qq.message', group, 111, '路人', '今晚谁去打羽毛球', '2026-10-20T12:00:00.000Z');
    await inbox.push('qq.message', group, 222, '路人乙', '我去羽毛球馆占场', '2026-10-20T12:01:00.000Z');
    // 她参与的群聊:去掉噪音和复读,图片换成 [图]。
    await inbox.push('qq.message', group, FRIEND, '小明', '@肥鱼包(你) 推荐一部科幻电影', '2026-10-20T15:00:00.000Z', true);
    await inbox.push('qq.message', group, 111, '路人', '哈哈', '2026-10-20T15:01:00.000Z');
    await inbox.push('qq.message', group, 111, '路人', '星际穿越超好看[图片 https://x/y.png]', '2026-10-20T15:02:00.000Z');
    await inbox.push('qq.message', group, 222, '路人乙', '星际穿越超好看[图片 https://x/y.png]', '2026-10-20T15:02:30.000Z');
    await inbox.push('qq.self', group, 921460361, '你', '那就星际穿越 记得带纸巾', '2026-10-20T15:03:00.000Z');

    await bot.core.mountWorld(world);
    // 启动时自己跑一次索引;这里再等一次,确认都进去了。
    await world.index();
    const status = await world.webUi().invoke('index', 'status', []) as { counts: Record<string, number> };
    expect(status.counts).toEqual({ chat: 3, file: 2, group: 1, vectors: 5 });
    expect(embedded.length).toBe(5);
    expect(embedded.join('\n')).not.toContain('喜欢鲸鱼');
    const [recall, open, members] = world.tools();
    const run = async (args: Record<string, unknown>) => {
      const out = await recall.handler(args, context);
      return typeof out === 'string' && out.startsWith('{') ? (JSON.parse(out) as { results: Array<{ id: number; where: string; kind: string; text: string }> }).results : [];
    };

    // 主人私聊(白名单):全部可见,包括笔记。
    world.observe([ctxEvent('qq.message', priv)]);
    expect((await run({ query: '青岛看灯塔' }))[0]).toMatchObject({ kind: 'note', where: '笔记' });
    expect((await run({ query: '羽毛球' })).some((r) => r.text.includes('羽毛球'))).toBe(false);
    const film = (await run({ query: '星际穿越', kind: 'chat' }))[0];
    expect(film.where).toBe(`群 ${GROUP}`);
    expect(film.text).toContain('[图]');
    expect(film.text).not.toContain('哈哈');
    expect(film.text.match(/星际穿越超好看/g)).toHaveLength(1);

    // 群里:只有这个群的聊天和群档案。
    world.observe([ctxEvent('qq.group_context', group)]);
    expect(await run({ query: '海边看日落' })).toEqual([]);
    expect(await run({ query: '青岛看灯塔' })).toEqual([]);
    expect((await run({ query: '开摆' }))[0]).toMatchObject({ where: `群 ${GROUP}`, kind: 'note' });
    const roster = JSON.parse(String(await members.handler({}, context)));
    expect(roster.members.map((m: { qq: string }) => m.qq)).toEqual(['111', '222', String(FRIEND)]);
    expect(roster.members.find((m: { qq: string }) => m.qq === String(FRIEND))).toMatchObject({ names: ['小明'], peopleFile: false });
    expect(await members.handler({ group: '1' }, context)).toMatchObject({ failed: true });

    // 别人的私聊:只有和他有关的,主人的私聊和笔记都搜不到。
    world.observe([ctxEvent('qq.message', friend)]);
    expect((await run({ query: '生日三月五号' }))[0]).toMatchObject({ where: `私聊 ${FRIEND}` });
    expect(await run({ query: '海边看日落' })).toEqual([]);
    expect(await run({ query: '青岛看灯塔' })).toEqual([]);
    expect((await run({ query: '星际穿越' })).length).toBe(1);
    expect(await open.handler({ id: (await (async () => { world.observe([ctxEvent('qq.message', priv)]); return run({ query: '青岛看灯塔' }); })())[0].id }, context)).toContain('预算三千');

    // 展开聊天片段:附上前后几条原文(群里的噪音也在,原文就是原文)。
    const opened = String(await open.handler({ id: film.id, around: 1 }, context));
    expect(opened).toContain('哈哈');
    expect(opened).toContain(`[群 ${GROUP}]`);
    world.observe([ctxEvent('qq.message', friend)]);
    const ownerChat = (await (async () => { world.observe([ctxEvent('qq.message', priv)]); return run({ query: '海边看日落' }); })())[0];
    world.observe([ctxEvent('qq.message', friend)]);
    expect(await open.handler({ id: ownerChat.id }, context)).toMatchObject({ failed: true });

    // 增量:同一段里续上的消息重切那一段,不重复;改笔记重新索引,删笔记移除。
    world.observe([ctxEvent('qq.message', priv)]);
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    await inbox.push('qq.message', priv, OWNER, '包子', '今晚想吃火锅', ago(5));
    await world.index();
    await inbox.push('qq.message', priv, OWNER, '包子', '火锅之后去看电影', ago(2));
    writeFileSync(join(memoryDir, 'note', 'library', 'trip.md'), '# 旅行计划\n改去厦门看鼓浪屿');
    rmSync(join(memoryDir, 'groups', `${GROUP}.md`));
    const second = await world.index();
    expect(second).toMatchObject({ files: 1, removed: 1 });
    const hotpot = await run({ query: '火锅', kind: 'chat' });
    expect(hotpot).toHaveLength(1);
    expect(hotpot[0].text).toContain('今晚想吃火锅');
    expect(hotpot[0].text).toContain('火锅之后去看电影');
    expect((await run({ query: '厦门鼓浪屿' }))[0].kind).toBe('note');
    expect(await run({ query: '青岛看灯塔', kind: 'note' })).toEqual([]);

    // 保留期:群聊片段过期被删,私聊不动。
    const store = (world as unknown as { store: import('../server/store.ts').KbStore }).store;
    const late = await runIndex(store, { dataDir, memoryDir, timezone: 'UTC', gapMinutes: 30, maxMessages: 20, groupOnlyParticipated: true,
      groupRetentionDays: 30, groupMinChars: 4, excludedGroups: new Set(), embeddingModel: '', models: NO_MODELS, now: Date.parse('2027-01-01') });
    expect(late.expired).toBe(1);
    expect(store.counts()).toMatchObject({ group: 0 });
  } finally { await bot.stop(); tmp.cleanup(); }
}, 30000);

it('works without an embedding model, using full-text search only', async () => {
  const tmp = makeTmpDir(), memoryDir = join(tmp.dir, 'memory'), dataDir = join(tmp.dir, 'data');
  mkdirSync(join(memoryDir, 'note'), { recursive: true });
  writeFileSync(join(memoryDir, 'note', 'a.md'), '黑话表:「开摆」= 周五下班');
  const world = new KbWorld({ id: 'kb', cfg: { ...KB_DEFAULTS, enabled: true }, timezone: 'UTC', botName: 'fixture', botDir: tmp.dir, packageDir: tmp.dir, dataDir, repoRoot: tmp.dir,
    models: NO_MODELS, secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {} });
  try {
    await world.start({ log: nullLogger() } as unknown as WorldHost);
    expect(await world.index()).toMatchObject({ files: 1, embedded: 0 });
    const hits = await world.search('周五下班', { label: 'full', allow: () => true });
    expect(hits[0]).toMatchObject({ kind: 'file', vector: null });
    expect(String(await world.tools()[0].handler({ query: '完全无关的话题' }, { role: 'main', log: nullLogger() }))).toContain('Nothing found');
  } finally { await world.stop(); tmp.cleanup(); }
});
