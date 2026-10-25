import { ConsoleWorld } from 'cortico/worlds/console/world.ts';
import { resolveSourceImage } from 'cortico/worlds/image-sources.ts';
import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { MockOneBot } from '../../../vendor/cortico/tests/helpers/mock-onebot.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir, textReply, toolReply } from '../../../vendor/cortico/tests/core/helpers.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { archive, world, PNG, FakeModelHub } from './helpers.ts';

it('selected meme id resolves inside QQ direct send over a local OneBot socket', async () => {
  const tmp = makeTmpDir();
  const onebot = new MockOneBot({ port: 0, groupId: 424242, selfId: 5000, selfNickname: 'bot', selfCard: 'bot', groupName: 'fixture' });
  const port = await onebot.start();
  const cfg = makeCfg();
  cfg.worlds.qq = { ...cfg.worlds.qq, enabled: true, wsUrl: `ws://127.0.0.1:${port}`, groups: [{ id: 424242, enabled: true }], privates: [], token: '' };
  cfg.worlds.console.enabled = false; cfg.web.port = 0;
  cfg.tick.dayIntervalMinutes = [999, 999]; cfg.tick.nightIntervalMinutes = null;
  cfg.batching.quietGapMs = 30; cfg.batching.maxBatchAgeMs = 100;
  const memoryDir = join(tmp.dir, 'memory'); mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'CONSTITUTION.md'), 'Fixture persona');
  const llm = new FakeLLM();
  const bot = assembleBot(makeLoaded({ config: cfg, rootDir: tmp.dir, memoryDir, dataDir: join(tmp.dir, 'data') }), { llm });
  let auxiliaryCalls = 0;
  const { instance, cfg: memeCfg } = world(tmp.dir, new FakeModelHub(async () => { auxiliaryCalls++; throw new Error('Unexpected auxiliary request'); }));
  memeCfg.memes.minScore = -1;
  try {
    await instance.library.importZip(await archive(tmp.dir), 'python'); await instance.search.build();
    const entry = (await instance.library.entries()).find(e => e.category === 'happy')!;
    await bot.start(); await bot.qqWorld!.waitReady(5000);
    await bot.core.mountWorld(instance);
    onebot.emitGroupMessage({ user_id: 1001, nickname: 'fixture', text: '之前说过我喜欢庆祝的表情' });
    const priorDeadline = Date.now() + 5000;
    while (!llm.calls.some(call => JSON.stringify(call.messages).includes('之前说过我喜欢庆祝的表情')) && Date.now() < priorDeadline) await new Promise(r => setTimeout(r, 40));
    expect(llm.calls.some(call => JSON.stringify(call.messages).includes('之前说过我喜欢庆祝的表情'))).toBe(true);
    let stage = 0;
    llm.fallback = () => {
      stage++;
      if (stage === 1) return toolReply([{ name: 'search_meme', args: { keywords: ['抱抱', '安慰'] } }]);
      if (stage === 2) {
        const messages = llm.calls.at(-1)!.messages;
        const history = JSON.stringify(messages);
        expect(history).toContain('之前说过我喜欢庆祝的表情');
        expect(history).toContain('给对方一个抱抱');
        expect(history).toContain('开心庆祝');
        expect(messages[0]).toEqual(llm.calls.at(-2)!.messages[0]);
        // The conversation model may choose a lower-ranked candidate using existing context.
        expect(history).toContain(`meme:${entry.id}`);
        return toolReply([{ name: 'qq_send', args: { to: 'group:424242', text: '抱抱你', image: `meme:${entry.id}` } }]);
      }
      return textReply('');
    };
    onebot.emitGroupMessage({ user_id: 1001, nickname: 'fixture', text: '给我一个抱抱' });
    const deadline = Date.now() + 8000;
    while (onebot.outbox.filter(o => o.action === 'send_group_msg').length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 40));
    const sent = onebot.outbox.filter(o => o.action === 'send_group_msg');
    expect(sent).toHaveLength(2);
    expect(sent.map(o => (o.params.message as Array<{ type: string }>).map(s => s.type))).toEqual([['text'], ['image']]);
    expect(auxiliaryCalls).toBe(0);
    expect(JSON.stringify(sent[1].params)).toContain(PNG.toString('base64'));
    const self = bot.core.store.range({}).filter(e => e.type === 'qq.self');
    expect(self).toHaveLength(2);
    expect(self[1].blobs?.[0].handle).toMatch(/^log:/);
    expect(JSON.stringify(llm.calls.flatMap(call => call.messages).filter(message => message.role === 'assistant'))).not.toContain('"name":"get_meme"');
    bot.core.bus.setPaused(true);
    const send = bot.qqWorld!.tools().find(t => t.name === 'qq_send')!;
    const ctx = { role: 'main', log: nullLogger() };
    const invalid = await send.handler({ to: 'group:424242', text: 'must not send', image: `meme:${entry.id}.bad` }, ctx);
    expect(invalid).toContain('send failed');
    expect(onebot.outbox).toHaveLength(2);
    const consoleWorld = new ConsoleWorld({ resolveImage: ref => resolveSourceImage(tmp.dir, ref) });
    await bot.core.mountWorld(consoleWorld);
    const consoleSend = consoleWorld.tools().find(t => t.name === 'console_send')!;
    expect(await consoleSend.handler({ text: 'console reply', image: `meme:${entry.id}` }, ctx)).toContain('[sent]');
    const consoleEvent = bot.core.store.range({}).find(e => e.type === 'console.self')!;
    expect(consoleEvent.blobs?.[0].handle).toMatch(/^log:/);
    expect(await resolveSourceImage(join(tmp.dir, 'another-deployment'), `meme:${entry.id}`)).toBeNull();
    memeCfg.memes.enabled = false;
    expect(await send.handler({ to: 'group:424242', text: 'must not send', image: `meme:${entry.id}` }, ctx)).toContain('disabled');
    expect(onebot.outbox).toHaveLength(2);
    memeCfg.memes.enabled = true;
    await instance.stop();
    expect(await send.handler({ to: 'group:424242', text: 'must not send', image: `meme:${entry.id}` }, ctx)).toContain('send failed');
    expect(onebot.outbox).toHaveLength(2);
  } finally { await bot.stop(); await onebot.close(); tmp.cleanup(); }
}, 20000);
