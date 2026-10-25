import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { VisualWorld } from '../world.ts';
import { VISUAL_DEFAULTS, type VisualConfig } from '../config.ts';
import { lookupVisual } from '../server/registry.ts';
import { ImagesWorld } from '../../cortico-world-images/world.ts';
import { IMAGES_DEFAULTS } from '../../cortico-world-images/config.ts';
import { NO_MODELS } from 'cortico/providers/model-hub.ts';
import type { ImageGenerationOptions } from 'cortico/providers/image-generation.ts';
import type { World, WorldHost } from 'cortico/core/types.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');
const png2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** 只拿宿主、往真实事件库里写 QQ / 控制台消息的替身 World。 */
class Inbox implements World {
  readonly id = 'inbox'; host!: WorldHost;
  envPromptVars() { return null; }
  async start(host: WorldHost) { this.host = host; }
  async stop() {}
  tools() { return []; }
  async qq(user: number, conv: { kind: string; id: number }, bytes: Buffer) {
    const e = await this.host.pushEvent({ type: 'qq.message', ts: new Date().toISOString(), source: 'qq', text: 'pic', senderKey: String(user),
      meta: { message_id: 1, user_id: user, conv }, blobs: [{ bytes, mime: 'image/png', fallbackText: 'image' }] }, { deliver: false });
    return e.blobs![0].handle;
  }
}

it('saves whitelisted senders\' pictures from the real event log and serves them to images_generate', async () => {
  const tmp = makeTmpDir(), memoryDir = join(tmp.dir, 'memory'); mkdirSync(memoryDir);
  writeFileSync(join(memoryDir, 'CONSTITUTION.md'), 'Fixture');
  const cfg = makeCfg(); cfg.worlds.qq.enabled = false; cfg.worlds.console.enabled = false; cfg.web.port = 0;
  cfg.tick.dayIntervalMinutes = [999, 999]; cfg.tick.nightIntervalMinutes = null;
  const dataDir = join(tmp.dir, 'data');
  const bot = assembleBot(makeLoaded({ config: cfg, rootDir: tmp.dir, memoryDir, dataDir }), { llm: new FakeLLM() });
  const base = { timezone: 'UTC', botName: 'fixture', botDir: tmp.dir, packageDir: tmp.dir, dataDir, repoRoot: tmp.dir,
    secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {} };
  const visualCfg: VisualConfig = { ...VISUAL_DEFAULTS, enabled: true, savers: '361270936, 123' };
  let trusted: string[] = [];
  const visual = new VisualWorld({ ...base, id: 'visual', cfg: visualCfg, models: NO_MODELS, globals: () => ({ trustedQQ: trusted }) });
  const calls: Array<{ prompt: string; options?: ImageGenerationOptions }> = [];
  const images = new ImagesWorld({ ...base, id: 'images', cfg: { ...IMAGES_DEFAULTS, enabled: true, model: 'local/draw' },
    models: { ...NO_MODELS, generateImage: async (_ref, prompt, options) => { calls.push({ prompt, options }); return { images: [{ bytes: png, mime: 'image/png' }] }; } } });
  const inbox = new Inbox();
  const context = { role: 'main', log: nullLogger() };
  try {
    await bot.start(); await bot.core.mountWorld(inbox);
    const draw = images.tools()[0];
    await bot.core.mountWorld(visual); await bot.core.mountWorld(images);
    expect(lookupVisual(tmp.dir)).not.toBeNull();
    expect(visual.library.dir).toBe(join(tmp.dir, 'memory', 'visual'));
    const save = visual.tools()[0];

    const mine = await inbox.qq(361270936, { kind: 'private', id: 361270936 }, png);
    const saved = JSON.parse(String(await save.handler({ image: mine, id: 'self', name: 'Yuki', aliases: ['我'], description: 'Blue hair' }, context)));
    expect(saved).toMatchObject({ saved: true, created: true, id: 'self', owner: '361270936', source: 'private', images: 1 });

    const stranger = await inbox.qq(555, { kind: 'group', id: 922728092 }, png2);
    const refused = await save.handler({ image: stranger, id: 'cat' }, context);
    expect(refused).toMatchObject({ failed: true });
    expect((refused as { text: string }).text).toContain('555');
    expect(visual.library.read().entries.map(e => e.id)).toEqual(['self']);

    // 同一张图白名单里的人也在群里发过，就能存；来源记成那个群。
    await inbox.qq(123, { kind: 'group', id: 922728092 }, png2);
    const cat = JSON.parse(String(await save.handler({ image: stranger, id: '团子', description: 'orange cat' }, context)));
    expect(cat).toMatchObject({ saved: true, owner: '123', source: 'group:922728092' });

    visualCfg.savers = '';
    expect(await save.handler({ image: mine, id: 'self' }, context)).toMatchObject({ failed: true });
    // 设置页全局变量里的白名单 QQ 不用再在本插件里填。
    trusted = ['361270936'];
    expect(JSON.parse(String(await save.handler({ image: mine, id: 'self' }, context)))).toMatchObject({ saved: true, created: false });
    trusted = [];
    await expect(save.handler({ image: 'log:missing.png', id: 'x' }, context)).rejects.toThrow('resend');
    await expect(save.handler({ image: 'meme:abc', id: 'x' }, context)).rejects.toThrow('log:');

    expect(visual.envPromptVars()['visual.list']).toMatch(/^- self：Yuki（也叫 我） · 属于 361270936 · 私聊所得 · 图：[a-f0-9]{12}\.png\n- 团子：团子 · 属于 123 · 图：[a-f0-9]{12}\.png$/);
    // 她挑图：只带选中的那几张，图像资料里的图附上条目的外貌说明。
    const selfPic = `mem:visual/self/${visual.library.entry('self').images[0]}`, catPic = `mem:visual/团子/${visual.library.entry('团子').images[0]}`;
    const result = await draw.handler({ prompt: 'Draw yourself holding the cat', images: [selfPic, catPic] }, context);
    expect(calls[0].options?.images).toEqual([{ bytes: png, mime: 'image/png' }, { bytes: png2, mime: 'image/png' }]);
    expect(calls[0].prompt).toContain('Blue hair'); expect(calls[0].prompt).toContain('orange cat');
    expect(calls[0].prompt).toContain('Image 1: reference for Yuki'); expect(calls[0].prompt).toContain('Image 2: reference for 团子');
    expect(result).toMatchObject({ text: JSON.stringify({ generated: 1, sent: false, refs: ['self', '团子'], inputImages: 2 }) });
    await draw.handler({ prompt: 'Just the cat', images: [catPic] }, context);
    expect(calls[1].options?.images).toEqual([{ bytes: png2, mime: 'image/png' }]);
    expect(calls[1].prompt).not.toContain('Blue hair');
    // 不按提示词里的名字自动附图。
    await draw.handler({ prompt: 'draw Yuki again' }, context);
    expect(calls[2].options?.images).toEqual([]);
    await expect(draw.handler({ prompt: 'x', images: ['mem:visual/self/nope.png'] }, context)).rejects.toThrow('file names');

    // 图像资料停用后照样能用这张图，只是没有外貌说明。
    await bot.core.unmountWorld('visual');
    expect(lookupVisual(tmp.dir)).toBeNull();
    await draw.handler({ prompt: 'again', images: [selfPic] }, context);
    expect(calls[3].prompt).toContain('Image 1: reference for self'); expect(calls[3].prompt).not.toContain('Blue hair');
  } finally { await bot.stop(); tmp.cleanup(); }
}, 30000);
