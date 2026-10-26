import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seed, archive, PNG, world } from './helpers.ts';
import { MemeLibrary } from '../server/library.ts';
const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'meme-management-')); dirs.push(dir); const { instance, cfg } = world(dir);
  const imported = await seed(instance.library);
  const edit = async (change: Record<string, unknown>) => { const p = (await instance.library.catalog()).find(p => p.id === imported.id)!; return instance.library.edit({ ...change, packId: p.id, revision: p.revision }); };
  return { dir, instance, cfg, edit, packId: imported.id };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('rejects importing an empty ZIP without inventing an image', async () => {
  const { instance, dir } = await setup(); const created = await instance.library.create('Empty');
  const exported = await instance.library.exportZip(created.id, dir, 'python');
  const reopened = new MemeLibrary(join(dir, 'empty-roundtrip')); await expect(reopened.importZip(exported.path, 'python')).rejects.toThrow('no PNG or JPEG');
  expect(await reopened.catalog()).toHaveLength(0);
});
it('creates empty categories, uploads verified image bytes, and rejects duplicates and unsafe names', async () => {
  const { instance, edit } = await setup();
  await edit({ kind: 'createCategory', category: 'new', description: '新分类说明' });
  await edit({ kind: 'upload', category: 'new', base64: PNG.toString('base64') });
  const image = (await instance.library.entries()).find(i => i.category === 'new')!;
  expect(image).toMatchObject({ caption: '', searchable: false, categoryDescription: '新分类说明' });
  expect((await instance.library.image(image.id)).bytes).toEqual(PNG);
  await expect(edit({ kind: 'upload', category: 'new', base64: PNG.toString('base64') })).rejects.toThrow('相同图片');
  await expect(edit({ kind: 'createCategory', category: '..', description: '' })).rejects.toThrow('Invalid category');
  await expect(edit({ kind: 'upload', category: 'new', base64: Buffer.from('<svg/>').toString('base64') })).rejects.toThrow('supported');
});
it('batch move, rename, soft delete and restore preserve metadata and image bytes across reopening', async () => {
  const { instance, edit } = await setup(); const entries = await instance.library.entries();
  await edit({ kind: 'createCategory', category: 'moved', description: '一起' });
  await edit({ kind: 'move', ids: entries.map(e => e.id), category: 'moved' });
  await edit({ kind: 'renameCategory', category: 'moved', name: 'renamed' });
  await edit({ kind: 'trash', ids: entries.map(e => e.id) });
  expect(await instance.library.entries()).toHaveLength(0);
  expect(await new MemeLibrary(instance.library.dir).entries(true)).toHaveLength(2);
  await expect(instance.library.image(entries[0].id)).rejects.toThrow('Unknown meme');
  await edit({ kind: 'restore', ids: entries.map(e => e.id) });
  expect((await instance.library.entries()).every(i => i.category === 'renamed' && i.categoryDescription === '一起')).toBe(true);
  expect((await instance.library.image(entries[0].id)).bytes).toEqual(PNG);
  await expect(edit({ kind: 'deleteCategory', category: 'renamed' })).rejects.toThrow('图片');
});
it('deleting an empty category does not resurrect it on later edits; restoring its trash restores the category', async () => {
  const { instance, edit } = await setup(); const image = (await instance.library.entries()).find(i => i.category === 'happy')!;
  await edit({ kind: 'trash', ids: [image.id] }); await edit({ kind: 'deleteCategory', category: 'happy' });
  await edit({ kind: 'pack', name: 'Renamed', enabled: true });
  expect((await instance.library.catalog())[0].categories.some(c => c.name === 'happy')).toBe(false);
  await edit({ kind: 'restore', ids: [image.id] });
  expect((await instance.library.catalog())[0].categories.some(c => c.name === 'happy')).toBe(true);
});
it('exported images can be imported as plain images, excluding trash', async () => {
  const { instance, edit, dir, packId } = await setup(); const entries = await instance.library.entries();
  const image = entries[0]; await edit({ kind: 'image', id: image.id, category: image.category, caption: '人工语义', tags: ['新标签'], visibleText: '配字' });
  await edit({ kind: 'createCategory', category: 'empty', description: '空分类也要保留' });
  await edit({ kind: 'trash', ids: [entries[1].id] });
  const exported = await instance.library.exportZip(packId, dir, 'python');
  const reopened = new MemeLibrary(join(dir, 'roundtrip')); await reopened.importZip(exported.path, 'python');
  const imported = await reopened.entries(); expect(imported).toHaveLength(1);
  expect(imported[0]).toMatchObject({ caption: '', tags: [], visibleText: '', category:'未分类' });
  expect((await reopened.image(imported[0].id)).bytes).toEqual(PNG);
  expect((await reopened.catalog())[0].categories).toHaveLength(1);
});
it('disabled packs and trash immediately leave semantic retrieval; restoring or enabling takes effect without reindexing', async () => {
  const { instance, edit } = await setup(); await instance.search.build();
  await edit({ kind: 'pack', name: 'Fixture', enabled: false });
  expect((await instance.search.search('抱抱', 5)).candidates).toHaveLength(0);
  await edit({ kind: 'pack', name: 'Fixture', enabled: true });
  expect((await instance.search.search('抱抱', 5)).candidates).toHaveLength(2);
  const id = (await instance.library.entries())[0].id; await edit({ kind: 'trash', ids: [id] });
  expect((await instance.search.search('抱抱', 5)).candidates.some(c => c.id === id)).toBe(false);
});
it('incremental vector generation reuses unchanged entries and rebuilds edited descriptions', async () => {
  const { instance, edit } = await setup(); await instance.search.build();
  expect((await instance.search.build(undefined, { force: false })).generated).toBe(0);
  const image = (await instance.library.entries())[0];
  await edit({ kind: 'image', id: image.id, category: image.category, caption: '修改后的描述', tags: [], visibleText: '' });
  expect((await instance.search.state()).pending).toBe(1);
  expect((await instance.search.build(undefined, { force: false })).generated).toBe(1);
  expect((await instance.search.state()).pending).toBe(0);
});
