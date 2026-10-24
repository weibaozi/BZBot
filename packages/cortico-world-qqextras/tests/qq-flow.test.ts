import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { MockOneBot } from '../../../vendor/cortico/tests/helpers/mock-onebot.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir, textReply, toolReply } from '../../../vendor/cortico/tests/core/helpers.ts';
import { archive, world, PNG } from './helpers.ts';

it('retrieved meme traverses the real session blob store and QQ draft/confirm over a local OneBot socket', async () => {
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
  const { instance } = world(tmp.dir);
  try {
    await instance.library.importZip(await archive(tmp.dir), 'python'); await instance.search.build();
    const entry = (await instance.library.entries()).find(e => e.category === 'affection')!;
    await bot.start(); await bot.qqWorld!.waitReady(5000);
    await bot.core.mountWorld(instance);
    let stage = 0;
    llm.fallback = () => {
      stage++;
      if (stage === 1) return toolReply([{ name: 'qqextras_search_memes', args: { query: '抱抱安慰' } }]);
      if (stage === 2) return toolReply([{ name: 'qqextras_get_meme', args: { id: entry.id } }]);
      if (stage === 3) {
        const history = JSON.stringify(llm.calls.at(-1)?.messages);
        const handle = history.match(/log:[a-f0-9]+\.png/)?.[0];
        expect(handle).toBeTruthy();
        return toolReply([{ name: 'qq_draft', args: { to: 'group:424242', image: handle } }]);
      }
      if (stage === 4) return toolReply([{ name: 'qq_confirm', args: { decision: 'send' } }]);
      return textReply('');
    };
    onebot.emitGroupMessage({ user_id: 1001, nickname: 'fixture', text: '给我一个抱抱' });
    const deadline = Date.now() + 8000;
    while (!onebot.outbox.some(o => o.action === 'send_group_msg') && Date.now() < deadline) await new Promise(r => setTimeout(r, 40));
    const sent = onebot.outbox.find(o => o.action === 'send_group_msg');
    expect(sent).toBeTruthy();
    expect(JSON.stringify(sent?.params)).toContain(PNG.toString('base64'));
    expect(bot.core.store.range({}).some(e => e.type === 'qq.self')).toBe(true);
  } finally { await bot.stop(); await onebot.close(); tmp.cleanup(); }
}, 20000);
