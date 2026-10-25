import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeneratedImage } from 'cortico/providers/image-generation.ts';

export interface ReferenceEntry { id: string; name: string; aliases: string[]; description: string; botIdentity: boolean; images: string[] }
export interface LibraryState { revision: string; entries: ReferenceEntry[] }
const assetPattern = /^[a-f0-9]{64}$/;
export class ReferenceLibrary {
  constructor(readonly dir: string) {}
  read(): LibraryState {
    let raw = '[]';
    try { raw = readFileSync(join(this.dir, 'entries.json'), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return { revision: createHash('sha256').update(raw).digest('hex'), entries: JSON.parse(raw) as ReferenceEntry[] };
  }
  save(revision: unknown, value: unknown): LibraryState {
    if (revision !== this.read().revision) throw new Error('资料已被修改，请重新读取');
    if (!Array.isArray(value) || value.length > 200) throw new Error('最多 200 个资料条目');
    const ids = new Set<string>();
    const entries = value.map((v: ReferenceEntry) => {
      if (!v || typeof v.id !== 'string' || !/^[\w-]{1,80}$/.test(v.id) || ids.has(v.id)) throw new Error('Invalid reference id');
      ids.add(v.id);
      if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100 || typeof v.description !== 'string' || v.description.length > 8000 || typeof v.botIdentity !== 'boolean') throw new Error('名称不能为空，说明最多 8000 字');
      if (!Array.isArray(v.aliases) || v.aliases.length > 20 || v.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 100)) throw new Error('Invalid aliases');
      if (!Array.isArray(v.images) || v.images.length > 8) throw new Error('每个条目最多 8 张图片');
      v.images.forEach(id => this.image(id));
      return { id: v.id, name: v.name.trim(), aliases: v.aliases, description: v.description, botIdentity: v.botIdentity, images: v.images };
    });
    mkdirSync(this.dir, { recursive: true });
    const temp = join(this.dir, `${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(entries, null, 2), { flag: 'wx' });
    renameSync(temp, join(this.dir, 'entries.json'));
    return this.read();
  }
  upload(base64: unknown): string {
    if (typeof base64 !== 'string' || base64.length > 8_000_000) throw new Error('图片需为 PNG/JPEG/WebP，大小不超过 6 MB');
    const image = decodeGeneratedImage(base64);
    const id = createHash('sha256').update(image.bytes).digest('hex');
    mkdirSync(join(this.dir, 'images'), { recursive: true });
    writeFileSync(join(this.dir, 'images', id), image.bytes);
    return id;
  }
  image(id: unknown) {
    if (typeof id !== 'string' || !assetPattern.test(id)) throw new Error('Invalid reference image id');
    return decodeGeneratedImage(readFileSync(join(this.dir, 'images', id)).toString('base64'));
  }
  select(query: string, ids: string[] = [], botIdentity = false): ReferenceEntry[] {
    const entries = this.read().entries;
    for (const id of ids) if (!entries.some(e => e.id === id)) throw new Error(`Unknown reference: ${id}`);
    const text = query.toLocaleLowerCase();
    return entries.filter(e => ids.includes(e.id) || (botIdentity && e.botIdentity) || [e.name, ...e.aliases].some(a => text.includes(a.toLocaleLowerCase())));
  }
  search(query: string): ReferenceEntry[] {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.read().entries.filter(e => !terms.length || terms.some(t => `${e.name} ${e.aliases.join(' ')} ${e.description}`.toLocaleLowerCase().includes(t))).slice(0, 20);
  }
}
