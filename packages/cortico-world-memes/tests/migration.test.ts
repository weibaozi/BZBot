import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateQqextras } from '../server/migration.ts';
import { archive, world, PNG } from './helpers.ts';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it('migrates config, prompt and real image/vector data with a backup and an idempotent retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meme-migration-')); dirs.push(dir);
  const { instance, cfg } = world(dir);
  await instance.library.importZip(await archive(dir), 'python'); await instance.search.build();
  const entry = (await instance.library.entries())[0];
  const { rename } = await import('node:fs/promises');
  await mkdir(join(dir, 'qqextras')); await rename(join(dir, 'memes'), join(dir, 'qqextras', 'memes'));
  const config = { worlds: { qqextras: cfg, qq: { enabled: false } }, untouched: 'kept' };
  await writeFile(join(dir, 'config.json'), JSON.stringify(config));
  await mkdir(join(dir, 'prompts'));
  await writeFile(join(dir, 'prompts', 'QQEXTRAS.md'), 'Prefer gentle images; use qqextras_search_memes then qqextras_get_meme.');
  expect(await migrateQqextras(dir)).toMatchObject({ applied: false, changes: { config: true, data: true, prompt: true } });
  expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual(config);
  await migrateQqextras(dir, true);
  expect(JSON.parse(await readFile(join(dir, 'config.before-memes.json'), 'utf8'))).toEqual(config);
  expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual({ worlds: { memes: cfg, qq: { enabled: false } }, untouched: 'kept' });
  expect(await readFile(join(dir, 'prompts', 'MEMES.md'), 'utf8')).toBe('Prefer gentle images; use search_meme then get_meme.');
  const reopened = world(dir).instance;
  expect((await reopened.library.image(entry.id)).bytes).toEqual(PNG);
  expect((await reopened.search.search('抱抱', 5)).candidates[0].category).toBe('affection');
  expect(await migrateQqextras(dir, true)).toMatchObject({ changes: { config: false, data: false, prompt: false } });
});

it('refuses an ambiguous existing World before writing anything', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'meme-migration-')); dirs.push(dir);
  const config = { worlds: { qqextras: { enabled: true }, memes: { enabled: false } } };
  await writeFile(join(dir, 'config.json'), JSON.stringify(config));
  await expect(migrateQqextras(dir, true)).rejects.toThrow('Both worlds');
  expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))).toEqual(config);
});
