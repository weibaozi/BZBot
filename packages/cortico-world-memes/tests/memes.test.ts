import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archive, embed, PNG, world } from './helpers.ts';
import { MemeSearch } from '../server/search.ts';
import { nullLogger } from 'cortico/core/util.ts';
const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'meme-feature-')); dirs.push(dir);
  const state = world(dir);
  await state.instance.library.importZip(await archive(dir), 'python');
  return { ...state, dir };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('imports image bytes, categories, captions and tags without generating vectors', async () => {
  const { instance } = await setup();
  const entries = await instance.library.entries();
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ category: 'affection', tags: ['安慰', '拥抱'], visibleText: '抱抱' });
  expect((await instance.library.image(entries[0].id)).bytes).toEqual(PNG);
  expect((await instance.search.state()).indexed).toBe(0);
  await expect(instance.search.search('抱抱', 5)).rejects.toThrow('index unavailable');
});
it('rejects archive traversal and leaves the existing library intact', async () => {
  const { instance, dir } = await setup();
  await expect(instance.library.importZip(await archive(dir, { '../escape.txt': 'outside' }), 'python')).rejects.toThrow();
  expect(await instance.library.packs()).toHaveLength(1);
});
it('rejects descriptions attached to image bytes with a mismatched hash', async () => {
  const { instance, dir } = await setup();
  const metadata = JSON.stringify({ images: { a: { relative_path: 'memes/affection/a.png', content_sha256: 'bad', caption: 'wrong' } } });
  await expect(instance.library.importZip(await archive(dir, { 'semantic_metadata.json': metadata }), 'python')).rejects.toThrow('hash differs');
});
it('retrieves intended meaning and reuses query vectors; the index survives reopening', async () => {
  const { instance, cfg } = await setup();
  await instance.search.build();
  const first = await instance.search.search('抱抱安慰', 1);
  expect(first.candidates[0].category).toBe('affection');
  expect(first.queryCached).toBe(false);
  expect((await instance.search.search('抱抱安慰', 1)).queryCached).toBe(true);
  const reopened = new MemeSearch(instance.library, () => ({ url: cfg.memes.embeddingUrl, model: cfg.memes.embeddingModel, queryPrefix: '', key: '' }), embed);
  expect((await reopened.search('开心', 1)).candidates[0].category).toBe('happy');
  cfg.memes.embeddingModel = 'another-model';
  await expect(instance.search.search('抱抱', 1)).rejects.toThrow('model settings changed');
});
it('a failed rebuild preserves the previous complete index', async () => {
  const { instance, cfg } = await setup(); await instance.search.build();
  const failing = new MemeSearch(instance.library, () => ({ url: cfg.memes.embeddingUrl, model: cfg.memes.embeddingModel, queryPrefix: '', key: '' }), async () => { throw new Error('service offline'); });
  await expect(failing.build()).rejects.toThrow('service offline');
  expect((await instance.search.search('开心', 1)).candidates).toHaveLength(1);
});
it('returns a selected image as a tool attachment without claiming delivery and respects disable', async () => {
  const { instance, cfg } = await setup();
  const entry = (await instance.library.entries())[0];
  const tool = instance.tools().find(t => t.name === 'get_meme')!;
  const output = await tool.handler({ id: entry.id }, { role: 'main', log: nullLogger() });
  expect(output).toMatchObject({ text: expect.stringContaining('"sent":false'), blobs: [{ bytes: PNG, mime: 'image/png' }] });
  await expect(tool.handler({ id: '../secret' }, { role: 'main', log: nullLogger() })).rejects.toThrow('Unknown meme');
  cfg.memes.enabled = false;
  await expect(tool.handler({ id: entry.id }, { role: 'main', log: nullLogger() })).rejects.toThrow('disabled');
});
it('edits descriptions and tags atomically, rejects stale editors, and excludes stale vectors', async () => {
  const { instance } = await setup(); await instance.search.build();
  const pack = (await instance.library.catalog())[0];
  const entry = (await instance.library.entries()).find(e => e.category === 'affection')!;
  const change = { kind: 'image', packId: pack.id, revision: pack.revision, id: entry.id,
    category: 'affection', caption: '新的安慰描述', visibleText: '抱抱', tags: ['陪伴', '温柔'] };
  await instance.library.edit(change);
  expect((await instance.library.image(entry.id)).bytes).toEqual(PNG);
  expect((await instance.library.entries()).find(e => e.id === entry.id)).toMatchObject({ caption: change.caption, tags: change.tags });
  await expect(instance.library.edit(change)).rejects.toThrow('Content changed');
  expect((await instance.search.search('抱抱', 5)).candidates.some(c => c.id === entry.id)).toBe(false);
});
it('category descriptions update only that category and invalid edits leave data unchanged', async () => {
  const { instance } = await setup(); const pack = (await instance.library.catalog())[0];
  await instance.library.edit({ kind: 'category', packId: pack.id, revision: pack.revision, category: 'affection', description: '温柔陪伴' });
  const entries = await instance.library.entries();
  expect(entries.find(e => e.category === 'affection')?.categoryDescription).toBe('温柔陪伴');
  expect(entries.find(e => e.category === 'happy')?.categoryDescription).toBe('高兴');
  const updated = (await instance.library.catalog())[0];
  await expect(instance.library.edit({ kind: 'image', packId: updated.id, revision: updated.revision, id: entries[0].id,
    category: '../escape', caption: 'bad', visibleText: '', tags: [] })).rejects.toThrow('Invalid category');
  expect((await instance.library.catalog())[0].revision).toBe(updated.revision);
});
