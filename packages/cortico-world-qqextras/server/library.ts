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
