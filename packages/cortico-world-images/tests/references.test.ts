import { expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ReferenceLibrary } from '../server/library.ts';
import { ImagesWorld } from '../world.ts';
import { IMAGES_DEFAULTS } from '../config.ts';
import { NO_MODELS } from 'cortico/providers/model-hub.ts';
import type { ImageGenerationOptions } from 'cortico/providers/image-generation.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');
it('persists references, matches aliases/identity, protects revisions and rejects paths', () => {
  const tmp = makeTmpDir(), lib = new ReferenceLibrary(join(tmp.dir, 'references'));
  try {
    const old = lib.read(), id = lib.upload(png.toString('base64'));
    lib.save(old.revision, [{ id: 'design', name: 'Character', aliases: ['blue fish'], description: 'blue hair', botIdentity: true, images: [id] }, { id: 'info', name: 'Room', aliases: [], description: 'Wooden furniture', botIdentity: false, images: [] }]);
    expect(new ReferenceLibrary(lib.dir).select('draw BLUE FISH').map(e => e.id)).toEqual(['design']);
    expect(lib.select('portrait', [], true).map(e => e.id)).toEqual(['design']);
    expect(lib.select('unrelated')).toEqual([]);
    expect(lib.select('other', ['info'])).toHaveLength(1);
    expect(lib.search('furniture').map(e => e.id)).toEqual(['info']);
    expect(() => lib.save(old.revision, [])).toThrow('修改');
    expect(() => lib.image('../../secret')).toThrow('Invalid');
    expect(() => lib.upload(Buffer.from('<svg/>').toString('base64'))).toThrow();
    expect(() => lib.select('', ['missing'])).toThrow('Unknown');
  } finally { tmp.cleanup(); }
});
it('resolves real conversation blobs and attaches identity images and reference text', async () => {
  const tmp = makeTmpDir(), memoryDir = join(tmp.dir, 'memory'); mkdirSync(memoryDir);
  writeFileSync(join(memoryDir, 'CONSTITUTION.md'), 'Fixture');
  const cfg = makeCfg(); cfg.worlds.qq.enabled = false; cfg.worlds.console.enabled = false; cfg.web.port = 0;
  cfg.tick.dayIntervalMinutes = [999, 999]; cfg.tick.nightIntervalMinutes = null;
  const bot = assembleBot(makeLoaded({ config: cfg, rootDir: tmp.dir, memoryDir, dataDir: join(tmp.dir, 'data') }), { llm: new FakeLLM() });
  const calls: Array<{ prompt: string; options?: ImageGenerationOptions }> = [];
  const world = new ImagesWorld({ id: 'images', cfg: { ...IMAGES_DEFAULTS, enabled: true, model: 'local/draw' }, timezone: 'UTC', botName: 'fixture', botDir: tmp.dir, packageDir: tmp.dir, dataDir: join(tmp.dir, 'data'), repoRoot: tmp.dir,
    models: { ...NO_MODELS, generateImage: async (_ref, prompt, options) => { calls.push({ prompt, options }); return { images: [{ bytes: png, mime: 'image/png' }] }; } }, secret: () => '', storeSecret: () => {}, persist: () => {}, restart: async () => {} });
  try {
    await bot.start(); await bot.core.mountWorld(world);
    const asset = world.library.upload(png.toString('base64'));
    world.library.save(world.library.read().revision, [{ id: 'self', name: 'Character', aliases: [], description: 'Blue hair', botIdentity: true, images: [asset] }]);
    const blob = bot.core.internBlobs([{ bytes: png, mime: 'image/png', fallbackText: 'User image' }])![0];
    const tool = world.tools()[0], context = { role: 'main', log: nullLogger() };
    const result = await tool.handler({ prompt: 'Add yourself to this scene', images: [blob.handle], bot_identity: true }, context);
    expect(calls[0].options?.images).toEqual([{ bytes: png, mime: 'image/png' }, { bytes: png, mime: 'image/png' }]);
    expect(calls[0].prompt).toContain('Blue hair'); expect(calls[0].prompt).toContain('Image 2: reference for Character');
    expect(result).toMatchObject({ blobs: [{ mime: 'image/png' }] });
    await expect(tool.handler({ prompt: 'edit', images: ['log:missing.png'] }, context)).rejects.toThrow('resend');
    await expect(tool.handler({ prompt: 'edit', images: ['https://example.invalid/image'] }, context)).rejects.toThrow('handle');
    expect(calls).toHaveLength(1);
  } finally { await bot.stop(); tmp.cleanup(); }
}, 20000);
