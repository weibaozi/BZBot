import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Meme {
  id: string; file: string; mime: string; category: string; categoryDescription: string;
  caption: string; tags: string[]; visibleText: string; searchable: boolean;
}
export interface Pack { name: string; sourceId: string; images: Meme[]; license: unknown; author: unknown }
export interface Entry extends Meme { packId: string; packName: string }
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export class MemeLibrary {
  private editing: Promise<unknown> = Promise.resolve();
  constructor(readonly dir: string) {}
  async packs(): Promise<Array<Pack & { id: string }>> {
    await mkdir(join(this.dir, 'packs'), { recursive: true });
    const names = await readdir(join(this.dir, 'packs'));
    return Promise.all(names.filter(n => /^[a-f0-9-]{36}$/.test(n)).sort().map(async id => ({
      ...JSON.parse(await readFile(join(this.dir, 'packs', id, 'pack.json'), 'utf8')) as Pack, id,
    })));
  }
  async entries(): Promise<Entry[]> {
    return (await this.packs()).flatMap(pack => pack.images.map(image => ({
      ...image, id: `${pack.id}:${image.id}`, packId: pack.id, packName: pack.name,
    })));
  }
  async catalog() {
    return (await this.packs()).map(({ id, ...pack }) => ({ id, name: pack.name, revision: hash(JSON.stringify(pack)),
      images: pack.images.length, categories: [...new Set(pack.images.map(i => i.category))].sort().map(name => ({
        name, count: pack.images.filter(i => i.category === name).length,
        description: pack.images.find(i => i.category === name)?.categoryDescription ?? '',
      })) }));
  }
  async edit(input: Record<string, unknown>) {
    const run = async () => {
      if (typeof input.packId !== 'string' || typeof input.revision !== 'string') throw new Error('Pack and revision are required');
      const found = (await this.packs()).find(p => p.id === input.packId);
      if (!found) throw new Error('Unknown pack');
      const { id, ...pack } = found;
      if (hash(JSON.stringify(pack)) !== input.revision) throw new Error('内容已更新，请刷新后重新编辑 / Content changed; refresh before editing');
      const string = (key: string, max: number) => {
        const value = input[key];
        if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${key}`);
        return value.trim();
      };
      if (input.kind === 'category') {
        const category = string('category', 100); const description = string('description', 4000);
        if (!pack.images.some(i => i.category === category)) throw new Error('Unknown category');
        for (const image of pack.images.filter(i => i.category === category)) image.categoryDescription = description;
      } else if (input.kind === 'image') {
        const image = pack.images.find(i => `${id}:${i.id}` === input.id);
        if (!image) throw new Error('Unknown meme');
        const category = string('category', 100);
        if (!category || /[\\/\x00-\x1f]/.test(category)) throw new Error('Invalid category');
        const caption = string('caption', 8000); const visibleText = string('visibleText', 4000);
        if (!Array.isArray(input.tags) || input.tags.length > 100 || input.tags.some(t => typeof t !== 'string' || t.length > 200)) throw new Error('Invalid tags');
        const description = pack.images.find(i => i.category === category)?.categoryDescription ?? '';
        Object.assign(image, { category, categoryDescription: description, caption, visibleText,
          tags: [...new Set((input.tags as string[]).map(t => t.trim()).filter(t => t && !t.startsWith('category:')))],
          searchable: Boolean(caption) && !['needs_review', '_pending_review'].includes(category) });
      } else throw new Error('Unknown edit kind');
      const destination = join(this.dir, 'packs', id, 'pack.json');
      const temporary = destination + '.' + randomUUID();
      try { await writeFile(temporary, JSON.stringify(pack)); await rename(temporary, destination); }
      finally { await rm(temporary, { force: true }); }
      return { saved: true, revision: hash(JSON.stringify(pack)), indexNeedsRebuild: true };
    };
    const result = this.editing.then(run);
    this.editing = result.catch(() => {});
    return result;
  }
  async importZip(path: string, python: string, signal?: AbortSignal): Promise<{ id: string; images: number; searchable: number }> {
    if (!path.toLowerCase().endsWith('.zip')) throw new Error('Select an AstrBot ZIP export');
    await mkdir(join(this.dir, 'packs'), { recursive: true });
    const id = randomUUID();
    const stage = join(this.dir, `.import-${id}`);
    try {
      const { stdout } = await promisify(execFile)(python, [fileURLToPath(new URL('./import-pack.py', import.meta.url)), path, stage],
        { windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024, signal });
      const result = JSON.parse(stdout) as { images: number; searchable: number };
      await rename(stage, join(this.dir, 'packs', id));
      return { id, ...result };
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async image(id: string) {
    const entry = (await this.entries()).find(e => e.id === id);
    if (!entry) throw new Error('Unknown meme id');
    if (!/^images\/[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/.test(entry.file)) throw new Error('Invalid stored image path');
    const bytes = await readFile(join(this.dir, 'packs', entry.packId, entry.file));
    return { entry, bytes };
  }
  async saveIndex(value: unknown): Promise<void> {
    const tmp = join(this.dir, `.index-${randomUUID()}.json`);
    try { await writeFile(tmp, JSON.stringify(value)); await rename(tmp, join(this.dir, 'index.json')); }
    finally { await rm(tmp, { force: true }); }
  }
}

export function semanticText(meme: Meme): string {
  return [`图片含义：${meme.caption.trim()}`, `固定分类标签：category:${meme.category}`,
    `分类含义：${meme.categoryDescription.trim()}`,
    `语义标签：${meme.tags.filter(t => !t.startsWith('category:')).join('、')}`,
    `图片文字：${meme.visibleText.trim()}`].join('\n');
}
