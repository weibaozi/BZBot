import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProviderModule } from 'cortico/providers/base.ts';
import type { LLMProviderEntry } from 'cortico/core/types.ts';
import { createResponse, type Request } from 'cortico/protocol/open-responses/index.ts';
import { SharedModels } from '../server/shared-models.ts';
import { PNG } from './helpers.ts';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'meme-shared-model-')); dirs.push(dir);
  const entry: LLMProviderEntry = { kind: 'fixture', baseUrl: 'http://fixture.test/v1', secret: 'CORTICO_FIXTURE_MEME_SECRET',
    multimodal: true, spec: { model: 'fixture-vision', thinking: true, reasoningEffort: 'low', maxTokens: 8192 } };
  const endpoint = join(dir, 'saved'); await mkdir(endpoint);
  await writeFile(join(endpoint, 'config.json'), JSON.stringify(entry));
  await writeFile(join(endpoint, '.env'), 'CORTICO_FIXTURE_MEME_SECRET=fixture-credential\n');
  return { dir, entry, endpoint };
}

it('uses the saved provider adapter, credentials, image content and generation settings without copying credentials into the picker', async () => {
  const { dir, entry, endpoint } = await fixture(); const calls: Request[] = []; let stopped = false;
  const module: ProviderModule = { id: 'fixture', title: 'Fixture', reasoningTiers: [], serviceTiers: [],
    create: (_name, _entry, host) => {
      expect(host.stateDir).toBe(endpoint); expect(host.secret('CORTICO_FIXTURE_MEME_SECRET')).toBe('fixture-credential');
      return { client: { respond: async request => {
        calls.push(request); const response = createResponse('fixture-response', request);
        response.status = 'completed'; response.output = [{ type: 'message', id: 'caption', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: '{"caption":"温柔抱抱"}', annotations: [], logprobs: [] }] }];
        return { response, attempts: [], origin: { instance: 'saved', module: 'fixture', model: request.model!, compatibilityDomain: 'fixture' } };
      } }, stop: async () => { stopped = true; } };
    } };
  const models = new SharedModels(() => dir, undefined, undefined, [module]);
  expect(JSON.stringify(models.list())).not.toContain('fixture-credential');
  expect(models.list()).toEqual([{ name: 'saved', model: entry.spec!.model, images: true, module: 'fixture' }]);
  expect(await models.generate('saved', { instruction: 'Caption task', data: { category: 'affection' }, image: { bytes: PNG, mime: 'image/png' } }, 5)).toEqual({ caption: '温柔抱抱' });
  expect(calls[0]).toMatchObject({ instructions: 'Caption task', model: 'fixture-vision', reasoning: { effort: 'low' }, max_output_tokens: 8192 });
  expect(calls[0].temperature).toBeUndefined();
  expect(JSON.stringify(calls[0])).toContain(`data:image/png;base64,${PNG.toString('base64')}`);
  await models.stop(); expect(stopped).toBe(true);
  expect(JSON.parse(await readFile(join(endpoint, 'config.json'), 'utf8'))).toEqual(entry);
});

it('re-reads global embedding settings and secrets and rejects missing models or OAuth embedding use', async () => {
  const { dir, entry, endpoint } = await fixture();
  const module: ProviderModule = { id: 'fixture', title: 'Fixture', reasoningTiers: [], serviceTiers: [], create: () => { throw new Error('Embedding must not instantiate a chat model'); } };
  const models = new SharedModels(() => dir, undefined, undefined, [module]);
  expect(models.embedding('saved', 'prefix ')).toMatchObject({ url: entry.baseUrl, model: entry.spec!.model, key: 'fixture-credential', queryPrefix: 'prefix ' });
  entry.spec!.model = 'fixture-embedding-next'; await writeFile(join(endpoint, 'config.json'), JSON.stringify(entry));
  await writeFile(join(endpoint, '.env'), 'CORTICO_FIXTURE_MEME_SECRET=rotated-fixture\n');
  expect(models.embedding('saved', '')).toMatchObject({ model: 'fixture-embedding-next', key: 'rotated-fixture' });
  expect(() => models.embedding('../outside', '')).toThrow('已删除');
  module.describe = { protocols: [], auth: ['oauth'], input: ['text', 'image'], local: false };
  expect(() => models.embedding('saved', '')).toThrow('不能用于');
  entry.multimodal = false; await writeFile(join(endpoint, 'config.json'), JSON.stringify(entry));
  await expect(models.generate('saved', { instruction: 'Caption', data: {}, image: { bytes: PNG, mime: 'image/png' } }, 5)).rejects.toThrow('图片输入');
});
