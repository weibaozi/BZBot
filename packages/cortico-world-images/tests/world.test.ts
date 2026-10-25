import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { ProviderRegistry } from 'cortico/providers/registry.ts';
import { ProviderModels } from 'cortico/providers/models.ts';
import { readProviders } from 'cortico/providers/store.ts';
import { ImagesWorld, IMAGES_DEFAULTS } from '../index.ts';

it('uses the configured model-hub image model and returns a blob without sending a message', async () => {
  const tmp = makeTmpDir();
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = join(tmp.dir, 'providers'); mkdirSync(join(root, 'local'), { recursive: true });
  writeFileSync(join(root, 'local', 'config.json'), JSON.stringify({ kind: 'openai-responses-compat', baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, models: { draw: { type: 'image' } } }));
  const registry = new ProviderRegistry(() => readProviders(root), { stateRoot: root, readBlob: () => null, keepThinking: () => true, log: nullLogger() });
  const cfg = structuredClone(IMAGES_DEFAULTS);
  const world = new ImagesWorld({ id: 'images', cfg, timezone: 'UTC', botName: 'fixture', botDir: tmp.dir, packageDir: tmp.dir, dataDir: tmp.dir, repoRoot: tmp.dir,
    models: new ProviderModels(root, () => registry), secret: () => '', storeSecret: () => { throw new Error('No plugin secrets'); }, persist: () => {}, restart: async () => {} });
  const tool = world.tools()[0], context = { role: 'main', log: nullLogger() };
  try {
    await expect(tool.handler({ prompt: 'a circle' }, context)).rejects.toThrow('模型中心');
    cfg.model = 'local/draw';
    const result = await tool.handler({ prompt: 'a circle' }, context);
    expect(result).toMatchObject({ text: JSON.stringify({ generated: 1, sent: false, references: [], inputImages: 0 }), blobs: [{ mime: 'image/png', name: 'generated-1' }] });
    await world.stop();
    await expect(tool.handler({ prompt: 'a circle' }, context)).rejects.toThrow();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); tmp.cleanup(); }
});
