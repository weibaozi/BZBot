import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archive, PNG, world } from './helpers.ts';
import type { Generate, ModelInput } from '../server/models.ts';
import type { Progress } from '../server/semantic.ts';
const dirs: string[] = [];
async function setup(generate: Generate) {
  const dir = await mkdtemp(join(tmpdir(), 'meme-semantic-')); dirs.push(dir); const state = world(dir, undefined, generate);
  const imported = await state.instance.library.importZip(await archive(dir), 'python');
  const edit = async (change: Record<string, unknown>) => { const p = (await state.instance.library.catalog())[0]; return state.instance.library.edit({ ...change, packId: p.id, revision: p.revision }); };
  return { ...state, dir, packId: imported.id, edit };
}
const progress = (): Progress => ({ stage: '', done: 0, total: 0, failed: 0, skipped: 0, errors: [] });
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
it('auxiliary selection uses a short query and a second candidate decision, with bounded reference context', async () => {
  const inputs: ModelInput[] = [];
  const { instance, cfg } = await setup(async input => { inputs.push(input); return inputs.length === 1 ? { query: '抱抱安慰' } : { meme_id: (input.data as { candidates: Array<{ id: string }> }).candidates[0].id }; });
  cfg.memes.contextTurns = 1; cfg.memes.injectPersona = false; await instance.search.build();
  const result = await instance.semantic.choose({ reply: '给你一个抱抱', context: ['earlier', 'latest'], persona: 'excluded' });
  expect(result.selected?.category).toBe('affection'); expect(result.sent).toBe(false);
  expect(inputs[0].data).toEqual({ reply: '给你一个抱抱', context: ['latest'] });
  expect(inputs).toHaveLength(2); expect(inputs[1].data).toHaveProperty('candidates');
});
it('declining and invalid candidate ids never turn into an image; disabled probability skips model work', async () => {
  let calls = 0; let invalid = false;
  const { instance, cfg } = await setup(async input => { calls++; return input.instruction.includes('检索词') ? { query: '抱抱' } : { meme_id: invalid ? 'outside' : '' }; }); await instance.search.build();
  expect((await instance.semantic.choose({ reply: '好呀' })).selected).toBeNull();
  invalid = true; await expect(instance.semantic.choose({ reply: '好呀' })).rejects.toThrow('候选之外');
  const before = calls; cfg.memes.probability = 0; expect((await instance.semantic.choose({ reply: '好呀' })).reason).toBe('probability'); expect(calls).toBe(before);
});
it('caption jobs resume missing images, retain manual work, and persist failures for targeted retry', async () => {
  let fail = true;
  const { instance, edit, packId } = await setup(async input => {
    expect(input.image?.bytes).toEqual(PNG); if (fail) throw new Error('service unavailable');
    return { caption: '新图片的含义', tags: ['温柔'], visible_text: '', needs_review: false };
  });
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
  const { instance, edit, packId } = await setup(async () => { await editDuring(); return { caption: '自动覆盖', tags: [], visible_text: '', needs_review: false }; });
  const first = (await instance.library.entries())[0];
  editDuring = async () => { await edit({ kind: 'image', id: first.id, category: first.category, caption: '人工胜出', tags: [], visibleText: '' }); };
  const p = progress(); await instance.semantic.describe(packId, 'force', p, new AbortController().signal);
  expect(p.skipped).toBeGreaterThan(0); expect((await instance.library.entries()).find(e => e.id === first.id)?.caption).toBe('人工胜出');
});
it('cancelling a caption job preserves completed descriptions and does not persist cancellation as failure', async () => {
  const abort = new AbortController(); let calls = 0;
  const { instance, packId } = await setup(async () => { if (++calls === 2) abort.abort(); return { caption: '已完成', tags: [], visible_text: '', needs_review: false }; });
  await expect(instance.semantic.describe(packId, 'force', progress(), abort.signal)).rejects.toThrow();
  const entries = await instance.library.entries(); expect(entries.filter(e => e.caption === '已完成')).toHaveLength(1);
  expect(entries.every(e => !e.semanticError)).toBe(true);
});
