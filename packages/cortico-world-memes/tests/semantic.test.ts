import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seed, archive, PNG, world, FakeModelHub } from './helpers.ts';
import type { Progress } from '../server/semantic.ts';
const dirs: string[] = [];
async function setup(models = new FakeModelHub()) {
  const dir = await mkdtemp(join(tmpdir(), 'meme-semantic-')); dirs.push(dir); const state = world(dir, models);
  const imported = await seed(state.instance.library);
  const edit = async (change: Record<string, unknown>) => { const p = (await state.instance.library.catalog())[0]; return state.instance.library.edit({ ...change, packId: p.id, revision: p.revision }); };
  return { ...state, dir, packId: imported.id, edit };
}
const progress = (): Progress => ({ stage: '', done: 0, total: 0, failed: 0, skipped: 0, errors: [] });
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('recall returns ranked candidates without any generation call and reuses query embeddings', async () => {
  let generations = 0;
  const { instance, cfg } = await setup(new FakeModelHub(async () => { generations++; throw new Error('Retrieval must not call a model'); }));
  cfg.memes.minScore = -1; await instance.search.build();
  const result = await instance.semantic.recall({ keywords: ['抱抱', '安慰', '抱抱'] });
  expect(result).toMatchObject({ query: '抱抱 安慰', reason: 'candidates', sent: false, queryCached: false });
  expect(result.candidates.map(c => c.category)).toEqual(['affection', 'happy']);
  expect(result.candidates[0]).toMatchObject({ caption: '给对方一个抱抱', tags: ['安慰', '拥抱'], visibleText: '抱抱' });
  expect(result).not.toHaveProperty('selected');
  expect(await instance.semantic.recall({ keywords: ['抱抱', '安慰'] })).toMatchObject({ queryCached: true });
  expect(generations).toBe(0);
});
it('gates and empty candidates return facts without making a final selection', async () => {
  const { instance, cfg } = await setup();
  cfg.memes.maxMemes = 0;
  expect(await instance.semantic.recall({ keywords: ['抱抱'] })).toMatchObject({ candidates: [], reason: 'disabled' });
  cfg.memes.maxMemes = 1;
  await expect(instance.semantic.recall({ keywords: ['抱抱'] })).rejects.toThrow('index unavailable');
  await instance.search.build(); cfg.memes.minScore = 0.5; cfg.memes.topK = 1;
  expect((await instance.semantic.recall({ keywords: ['抱抱'] })).candidates).toHaveLength(1);
  const pack = (await instance.library.catalog())[0];
  await instance.library.edit({ kind: 'pack', packId: pack.id, revision: pack.revision, name: pack.name, enabled: false });
  expect(await instance.semantic.recall({ keywords: ['抱抱'] })).toMatchObject({ candidates: [], reason: 'no_candidates', sent: false });
});
it('validates keyword boundaries and respects cancellation before retrieval', async () => {
  const { instance } = await setup();
  for (const keywords of [undefined, [], [' '], ['x'.repeat(201)], Array(9).fill('x'), [12]]) {
    await expect(instance.semantic.recall({ keywords })).rejects.toThrow('keywords');
  }
  const abort = new AbortController(); abort.abort();
  await expect(instance.semantic.recall({ keywords: ['抱抱'] }, abort.signal)).rejects.toThrow();
});
it('caption jobs resume missing images, retain manual work, and persist failures for targeted retry', async () => {
  let fail = true;
  const { instance, edit, packId } = await setup(new FakeModelHub(async context => {
    expect(JSON.stringify(context)).toContain(`data:image/png;base64,${PNG.toString('base64')}`); if (fail) throw new Error('service unavailable');
    return { caption: '新图片的含义', tags: ['温柔'], visible_text: '', needs_review: false };
  }));
  const entry = (await instance.library.entries())[0];
  await edit({ kind: 'image', id: entry.id, category: entry.category, caption: '人工保留', visibleText: '', tags: [] });
  await edit({ kind: 'createCategory', category: 'new', description: '新图片' });
  await edit({ kind: 'upload', category: 'new', base64: PNG.toString('base64') });
  const first = progress(); await instance.semantic.describe(packId, 'missing', first, new AbortController().signal);
  expect(first).toMatchObject({ done: 1, failed: 1 });
  expect((await instance.library.entries()).find(e => e.category === 'new')?.semanticError).toBe('service unavailable');
  fail = false; const retried = progress(); await instance.semantic.describe(packId, 'retry', retried, new AbortController().signal);
  expect(retried).toMatchObject({ done: 1, failed: 0 });
  expect((await instance.library.entries()).find(e => e.category === 'new')).toMatchObject({ caption: '新图片的含义', searchable: true });
  await instance.semantic.describe(packId, 'force', progress(), new AbortController().signal);
  expect((await instance.library.entries()).find(e => e.id === entry.id)?.caption).toBe('人工保留');
});
it('a human edit while the vision request is in flight wins over the stale result', async () => {
  let editDuring: () => Promise<void> = async () => {};
  const { instance, edit, packId } = await setup(new FakeModelHub(async () => { await editDuring(); return { caption: '自动覆盖', tags: [], visible_text: '', needs_review: false }; }));
  const first = (await instance.library.entries())[0];
  editDuring = async () => { await edit({ kind: 'image', id: first.id, category: first.category, caption: '人工胜出', tags: [], visibleText: '' }); };
  const p = progress(); await instance.semantic.describe(packId, 'force', p, new AbortController().signal);
  expect(p.skipped).toBeGreaterThan(0); expect((await instance.library.entries()).find(e => e.id === first.id)?.caption).toBe('人工胜出');
});
it('cancelling a caption job preserves completed descriptions and does not persist cancellation as failure', async () => {
  const abort = new AbortController(); let calls = 0;
  const { instance, packId } = await setup(new FakeModelHub(async () => { if (++calls === 2) abort.abort(); return { caption: '已完成', tags: [], visible_text: '', needs_review: false }; }));
  await expect(instance.semantic.describe(packId, 'force', progress(), abort.signal)).rejects.toThrow();
  const entries = await instance.library.entries(); expect(entries.filter(e => e.caption === '已完成')).toHaveLength(1);
  expect(entries.every(e => !e.semanticError)).toBe(true);
});
