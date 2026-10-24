import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Meme {
  id: string; file: string; mime: string; category: string; categoryDescription: string;
  caption: string; tags: string[]; visibleText: string; searchable: boolean;
  deletedAt?: string; manual?: boolean; semanticError?: string; reviewed?: boolean;
}
export interface Pack { name: string; sourceId: string; images: Meme[]; license: unknown; author: unknown; enabled?: boolean; categories?: Record<string, string> }
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
  async entries(trash = false): Promise<Entry[]> {
    return (await this.packs()).flatMap(pack => pack.images.filter(i => Boolean(i.deletedAt) === trash).map(image => ({
      ...image, id: `${pack.id}:${image.id}`, packId: pack.id, packName: pack.name,
    })));
  }
  async catalog() {
    return (await this.packs()).map(({ id, ...pack }) => ({ id, name: pack.name, revision: hash(JSON.stringify(pack)),
      enabled: pack.enabled !== false, trash: pack.images.filter(i => i.deletedAt).length,
      images: pack.images.filter(i => !i.deletedAt).length, categories: [...new Set([...Object.keys(pack.categories ?? {}), ...pack.images.filter(i => !i.deletedAt).map(i => i.category)])].sort().map(name => ({
        name, count: pack.images.filter(i => !i.deletedAt && i.category === name).length,
        description: pack.categories?.[name] ?? pack.images.find(i => i.category === name)?.categoryDescription ?? '',
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
      const categoryName = (key = 'category') => { const value = string(key, 100); if (!value || /[\\/:\x00-\x1f]/.test(value) || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Invalid category'); return value; };
      const categories = pack.categories ??= Object.fromEntries(pack.images.filter(i => !i.deletedAt).map(i => [i.category, i.categoryDescription]));
      if (input.kind === 'category') {
        const category = categoryName(); const description = string('description', 4000);
        if (!Object.hasOwn(categories, category)) throw new Error('Unknown category');
        categories[category] = description;
        for (const image of pack.images.filter(i => i.category === category)) image.categoryDescription = description;
      } else if (input.kind === 'createCategory') {
        const category = categoryName(); if (Object.hasOwn(categories, category)) throw new Error('Category already exists');
        categories[category] = string('description', 4000);
      } else if (input.kind === 'renameCategory' || input.kind === 'deleteCategory') {
        const category = categoryName(); if (!Object.hasOwn(categories, category)) throw new Error('Unknown category');
        if (input.kind === 'deleteCategory') {
          if (pack.images.some(i => i.category === category && !i.deletedAt)) throw new Error('请先移动或删除分类中的图片');
        } else {
          const name = categoryName('name'); if (Object.hasOwn(categories, name)) throw new Error('Category already exists');
          categories[name] = categories[category];
          for (const image of pack.images.filter(i => i.category === category)) { image.category = name; if (['needs_review', '_pending_review'].includes(name)) image.searchable = false; }
        }
        delete categories[category];
      } else if (input.kind === 'pack') {
        const name = string('name', 200); if (!name || typeof input.enabled !== 'boolean') throw new Error('Invalid pack settings');
        pack.name = name; pack.enabled = input.enabled;
      } else if (['move', 'trash', 'restore'].includes(String(input.kind))) {
        if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 20000) throw new Error('Select images');
        const chosen = pack.images.filter(i => input.ids instanceof Array && input.ids.includes(`${id}:${i.id}`));
        if (chosen.length !== new Set(input.ids).size) throw new Error('Unknown meme');
        const category = input.kind === 'move' ? categoryName() : '';
        if (category && !Object.hasOwn(categories, category)) throw new Error('Unknown category');
        for (const image of chosen) {
          if (input.kind === 'trash') image.deletedAt = new Date().toISOString();
          if (input.kind === 'restore') { delete image.deletedAt; if (!Object.hasOwn(categories, image.category)) categories[image.category] = image.categoryDescription; }
          if (input.kind === 'move') Object.assign(image, { category, categoryDescription: categories[category], searchable: Boolean(image.caption) && !['needs_review', '_pending_review'].includes(category) });
        }
      } else if (input.kind === 'upload') {
        const category = categoryName(); if (!Object.hasOwn(categories, category)) throw new Error('Unknown category');
        const base64 = string('base64', 36 * 1024 * 1024);
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid image encoding');
        const bytes = Buffer.from(base64, 'base64');
        if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Image exceeds 25 MiB limit');
        const ext = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png' : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg' : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ? 'gif' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
        if (!ext) throw new Error('Only PNG, JPEG, GIF and WebP are supported');
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (pack.images.some(i => i.file === `images/${digest}.${ext}` && i.category === category && !i.deletedAt)) throw new Error('此分类已存在相同图片');
        await mkdir(join(this.dir, 'packs', id, 'images'), { recursive: true });
        await writeFile(join(this.dir, 'packs', id, 'images', `${digest}.${ext}`), bytes);
        pack.images.push({ id: randomUUID(), file: `images/${digest}.${ext}`, mime: `image/${ext === 'jpg' ? 'jpeg' : ext}`, category, categoryDescription: categories[category], caption: '', tags: [], visibleText: '', searchable: false });
      } else if (input.kind === 'image') {
        const image = pack.images.find(i => `${id}:${i.id}` === input.id);
        if (!image) throw new Error('Unknown meme');
        const category = categoryName();
        const caption = string('caption', 8000); const visibleText = string('visibleText', 4000);
        if (!Array.isArray(input.tags) || input.tags.length > 100 || input.tags.some(t => typeof t !== 'string' || t.length > 200)) throw new Error('Invalid tags');
        const description = categories[category] ?? '';
        categories[category] = description;
        Object.assign(image, { category, categoryDescription: description, caption, visibleText,
          tags: [...new Set((input.tags as string[]).map(t => t.trim()).filter(t => t && !t.startsWith('category:')))],
          searchable: Boolean(caption) && !['needs_review', '_pending_review'].includes(category), manual: true, reviewed: true });
        delete image.semanticError;
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
  async create(name: string) {
    if (!name.trim() || name.length > 200) throw new Error('Invalid pack name');
    const id = randomUUID(); const stage = join(this.dir, `.create-${id}`);
    await mkdir(stage, { recursive: true });
    try { await writeFile(join(stage, 'pack.json'), JSON.stringify({ name: name.trim(), sourceId: id, images: [], categories: {}, license: '', author: '', enabled: true }));
      await mkdir(join(this.dir, 'packs'), { recursive: true }); await rename(stage, join(this.dir, 'packs', id));
    } finally { await rm(stage, { recursive: true, force: true }); }
    return { id };
  }
  async exportZip(packId: string, directory: string, python: string, signal?: AbortSignal) {
    if (!isAbsolute(directory)) throw new Error('Select an absolute export directory');
    const pack = (await this.packs()).find(p => p.id === packId); if (!pack) throw new Error('Unknown pack');
    const snapshot = join(this.dir, `.export-${randomUUID()}.json`);
    const destination = join(directory, `meme-pack-${Date.now()}-${randomUUID().slice(0, 8)}.zip`);
    try { await writeFile(snapshot, JSON.stringify(pack));
      await promisify(execFile)(python, [fileURLToPath(new URL('./export-pack.py', import.meta.url)), snapshot, join(this.dir, 'packs', pack.id), destination], { windowsHide: true, timeout: 300_000, signal });
      return { path: destination };
    } finally { await rm(snapshot, { force: true }); }
  }
  async applySemantic(id: string, expected: string, result: Partial<Pick<Meme, 'caption' | 'tags' | 'visibleText' | 'searchable' | 'semanticError'>>) {
    const run = async () => {
      const found = (await this.packs()).find(p => id.startsWith(p.id + ':')); if (!found) return false;
      const { id: packId, ...pack } = found; const image = pack.images.find(i => `${packId}:${i.id}` === id);
      if (!image || image.deletedAt || hash(JSON.stringify(image)) !== expected) return false;
      Object.assign(image, result); if (!result.semanticError) delete image.semanticError;
      const path = join(this.dir, 'packs', packId, 'pack.json'); const temporary = path + '.' + randomUUID();
      try { await writeFile(temporary, JSON.stringify(pack)); await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
      return true;
    };
    const pending = this.editing.then(run); this.editing = pending.catch(() => {}); return pending;
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
  async image(id: string, trash = false) {
    const entry = (await this.entries(trash)).find(e => e.id === id);
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
