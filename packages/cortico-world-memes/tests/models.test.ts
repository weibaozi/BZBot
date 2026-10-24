import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
import { inputItem } from 'cortico/protocol/open-responses/context.ts';
import { modelOptions } from 'cortico/providers/model-hub.ts';
import { archive, FakeModelHub, PNG, world } from './helpers.ts';
import { CAPTION_PROMPT, parseModelJson } from '../server/models.ts';
import { MEMES_DEFAULTS, memesConfigGroup } from '../config.ts';
import type { Progress } from '../server/semantic.ts';

it('captions carry image input and generation overrides, and record usage through the real World host', async () => {
  const tmp = makeTmpDir();
  const cfg = makeCfg(); cfg.worlds.qq.enabled = false; cfg.worlds.console.enabled = false; cfg.web.port = 0;
  cfg.tick.dayIntervalMinutes = [999, 999]; cfg.tick.nightIntervalMinutes = null;
  const memoryDir = join(tmp.dir, 'memory'); mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'CONSTITUTION.md'), 'Fixture persona');
  const bot = assembleBot(makeLoaded({ config: cfg, rootDir: tmp.dir, memoryDir, dataDir: join(tmp.dir, 'data') }), { llm: new FakeLLM() });
  let invalid = false;
  const models = new FakeModelHub(async () => invalid ? 'not-json' : '```json\n{"caption":"温柔陪伴","tags":["安慰"],"visible_text":"抱抱","needs_review":false}\n```');
  const { instance, cfg: memeCfg } = world(tmp.dir, models);
  const progress = (): Progress => ({ stage: '', done: 0, total: 0, failed: 0, skipped: 0, errors: [] });
  try {
    const pack = await instance.library.importZip(await archive(tmp.dir), 'python');
    await bot.start(); await bot.core.mountWorld(instance);
    expect(await instance.semantic.describe(pack.id, 'force', progress(), new AbortController().signal)).toMatchObject({ described: 2, failed: 0 });
    const call = models.chatCalls[0];
    expect(call.ref).toBe(memeCfg.memes.captionModel);
    expect(call.options).toMatchObject({ overrides: { thinking: false, maxTokens: 1024 }, role: 'memes' });
    expect(call.options?.signal).toBeInstanceOf(AbortSignal);
    const input = call.context.map(inputItem);
    expect(JSON.stringify(input[0])).toContain(CAPTION_PROMPT.replaceAll('"', '\\"'));
    expect(input[1]).toMatchObject({ role: 'user', content: [
      { type: 'input_text', text: expect.stringContaining('category_description') },
      { type: 'input_image', image_url: `data:image/png;base64,${PNG.toString('base64')}`, detail: 'auto' },
    ] });
    const usage = () => bot.core.usageLog.readAll().filter(r => r.role === 'worlds.memes');
    expect(usage()).toHaveLength(2);
    expect(usage()[0]).toMatchObject({ model: 'caption', promptTokens: 12, completionTokens: 7, cacheHitTokens: 4, cacheMissTokens: 8 });
    expect((await instance.library.entries()).every(e => e.caption === '温柔陪伴')).toBe(true);
    invalid = true;
    expect(await instance.semantic.describe(pack.id, 'force', progress(), new AbortController().signal)).toMatchObject({ failed: 2 });
    expect(usage()).toHaveLength(4);
    expect((await instance.library.entries()).every(e => e.semanticError === 'Model did not return valid JSON')).toBe(true);
  } finally { await bot.stop(); tmp.cleanup(); }
}, 20000);

it('declares filtered model-center options with empty defaults and exposes no plugin credentials', async () => {
  const tmp = makeTmpDir();
  try {
    const models = new FakeModelHub();
    const properties = memesConfigGroup('zh').schema.properties!;
    expect(MEMES_DEFAULTS.memes).toMatchObject({ embeddingModel: '', captionModel: '' });
    expect(modelOptions(models, properties['worlds.memes.memes.embeddingModel']['x-options']!)).toEqual([{ value: 'fixture/embedding', label: 'fixture/embedding' }]);
    expect(modelOptions(models, properties['worlds.memes.memes.captionModel']['x-options']!)).toEqual([{ value: 'fixture/caption', label: 'fixture/caption' }]);
    const { instance } = world(tmp.dir, models);
    const settings = await instance.webUi().invoke('memes', 'settings', []);
    expect(Object.keys(settings!)).toEqual(['schema', 'values']);
    await expect(instance.webUi().invoke('memes', 'key', [{ kind: 'vision', key: 'unused' }])).rejects.toThrow('Unknown method');
  } finally { tmp.cleanup(); }
});

it('rejects malformed caption JSON without accepting arrays or oversized responses', () => {
  for (const value of [undefined, '[]', 'null', 'x'.repeat(32001), '{broken}']) expect(() => parseModelJson(value)).toThrow();
});
