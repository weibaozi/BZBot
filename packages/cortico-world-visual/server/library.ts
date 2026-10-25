import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeGeneratedImage } from 'cortico/providers/image-generation.ts';

/**
 * 图像资料：`<visual>/<id>/entry.md` 加同目录的图片。目录名就是 id，`self` 是 bot 自己。
 * entry.md 的头部写名字、别名、主人（QQ 号）和来源（private / group:<群号>），正文是给生图模型看的设定。
 * 没有 entry.md 的文件夹也算条目，名字就是 id，方便直接往目录里放图。
 */
export interface VisualEntry { id: string; name: string; aliases: string[]; owner: string; source: string; description: string; images: string[] }
export interface LibraryState { revision: string; entries: VisualEntry[] }

const idPattern = /^(?![.\s])[^\\/:*?"<>|\x00-\x1f]{1,60}(?<!\s)$/;
const imagePattern = /^(?!\.)[^\\/:*?"<>|\x00-\x1f]{1,120}\.(png|jpe?g|webp)$/i;
const sourcePattern = /^(|private|group:\d{1,20})$/;
const ENTRY = 'entry.md';

function checkId(id: unknown): string {
  if (typeof id !== 'string' || !idPattern.test(id) || id.includes('..')) throw new Error(`Invalid visual entry id: ${String(id)}`);
  return id;
}
function checkImage(name: unknown): string {
  if (typeof name !== 'string' || !imagePattern.test(name) || name.includes('..')) throw new Error(`Invalid image file name: ${String(name)}`);
  return name;
}
function list(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner.split(',').map(s => s.trim()).filter(Boolean);
}

export function parseEntry(id: string, raw: string): Omit<VisualEntry, 'images'> {
  const entry = { id, name: id, aliases: [] as string[], owner: '', source: '', description: raw.trim() };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return entry;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2].trim();
    if (kv[1] === 'name' && value) entry.name = value;
    else if (kv[1] === 'aliases') entry.aliases = list(value);
    else if (kv[1] === 'owner') entry.owner = value;
    else if (kv[1] === 'source') entry.source = value;
  }
  entry.description = match[2].trim();
  return entry;
}

export function formatEntry(e: Omit<VisualEntry, 'id' | 'images'>): string {
  const head = [`name: ${e.name}`, `aliases: [${e.aliases.join(', ')}]`];
  if (e.owner) head.push(`owner: ${e.owner}`);
  if (e.source) head.push(`source: ${e.source}`);
  return `---\n${head.join('\n')}\n---\n${e.description.trim()}\n`;
}

export class VisualLibrary {
  constructor(readonly dir: string) {}

  read(): LibraryState {
    const hash = createHash('sha256');
    const entries: VisualEntry[] = [];
    let ids: string[] = [];
    try { ids = readdirSync(this.dir, { withFileTypes: true }).filter(d => d.isDirectory() && idPattern.test(d.name) && !d.name.includes('..')).map(d => d.name).sort(); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    for (const id of ids) {
      const folder = join(this.dir, id);
      const files = readdirSync(folder).sort();
      const raw = files.includes(ENTRY) ? readFileSync(join(folder, ENTRY), 'utf8') : '';
      const images = files.filter(f => imagePattern.test(f));
      hash.update(JSON.stringify([id, raw, images]));
      entries.push({ ...parseEntry(id, raw), images });
    }
    return { revision: hash.digest('hex'), entries };
  }

  entry(id: string): VisualEntry {
    const found = this.read().entries.find(e => e.id === id);
    if (!found) throw new Error(`Unknown visual entry: ${id}`);
    return found;
  }

  image(id: unknown, name: unknown) {
    const path = join(this.dir, checkId(id), checkImage(name));
    return decodeGeneratedImage(readFileSync(path).toString('base64'));
  }

  private check(revision: unknown): void {
    if (revision !== this.read().revision) throw new Error('资料已被修改，请重新读取');
  }

  /**
   * 选一个文件名放图：沿用原文件名（去掉路径和非法字符，扩展名按实际格式改正），
   * 没有就用内容哈希；文件夹里已有同样内容的图就复用它，同名不同图就加 -2、-3。
   */
  private place(entryId: string, image: { bytes: Uint8Array; mime: string }, original?: unknown): string {
    const ext = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
    const folder = join(this.dir, entryId);
    mkdirSync(folder, { recursive: true });
    const digest = createHash('sha256').update(image.bytes).digest('hex');
    for (const file of readdirSync(folder)) {
      if (imagePattern.test(file) && createHash('sha256').update(readFileSync(join(folder, file))).digest('hex') === digest) return file;
    }
    const raw = typeof original === 'string' ? original.split(/[\\/]/).pop()! : '';
    const stem = raw.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/^[.\s]+|\s+$/g, '').slice(0, 100) || digest.slice(0, 12);
    let file = `${stem}.${ext}`;
    for (let n = 2; existsSync(join(folder, file)); n++) file = `${stem}-${n}.${ext}`;
    checkImage(file);
    writeFileSync(join(folder, file), image.bytes);
    return file;
  }

  /** 上传一张图到条目文件夹（没有就建），返回文件名与新的 revision。 */
  upload(revision: unknown, id: unknown, base64: unknown, name?: unknown): { file: string; revision: string } {
    this.check(revision);
    const entryId = checkId(id);
    if (typeof base64 !== 'string' || base64.length > 8_000_000) throw new Error('图片需为 PNG/JPEG/WebP，大小不超过 6 MB');
    const file = this.place(entryId, decodeGeneratedImage(base64), name);
    return { file, revision: this.read().revision };
  }

  /**
   * 她存图：把一张图加进条目（没有就新建），给了的字段覆盖原值。
   * 主人只在条目还没有主人时填；来源只往更私密的方向改：一旦有私聊来的图，整条就算私聊所得。
   */
  add(id: unknown, image: { bytes: Uint8Array; mime: string }, fields: { name?: string; aliases?: string[]; description?: string; owner: string; source: string }): { entry: VisualEntry; file: string; created: boolean } {
    const entryId = checkId(id);
    const old = this.read().entries.find(e => e.id === entryId);
    if (!['image/png', 'image/webp', 'image/jpeg'].includes(image.mime)) throw new Error('只能存 PNG/JPEG/WebP 图片');
    if (image.bytes.byteLength > 6_000_000) throw new Error('单张图片最多 6 MB');
    const file = this.place(entryId, image);
    const images = old?.images.includes(file) ? old.images : [...(old?.images ?? []), file];
    if (images.length > 8) {
      rmSync(join(this.dir, entryId, file));
      throw new Error(`条目 ${entryId} 已有 8 张图，先在管理页删掉一些`);
    }
    const next: VisualEntry = {
      id: entryId,
      name: fields.name?.trim() || old?.name || entryId,
      aliases: fields.aliases ?? old?.aliases ?? [],
      description: fields.description ?? old?.description ?? '',
      owner: old?.owner || fields.owner,
      source: fields.source === 'private' || !old?.source ? fields.source : old.source,
      images,
    };
    // 只写这一条的 entry.md，别的条目原样不动（手写的格式不被重排）。
    this.write(this.validate(next));
    return { entry: this.entry(entryId), file, created: !old };
  }

  private validate(v: VisualEntry): VisualEntry {
    const id = checkId(v?.id);
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100 || /[\r\n]/.test(v.name)) throw new Error('名称不能为空、不能换行，最多 100 字');
    if (typeof v.description !== 'string' || v.description.length > 8000) throw new Error('说明最多 8000 字');
    if (!Array.isArray(v.aliases) || v.aliases.length > 20 || v.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 100 || /[\r\n,[\]]/.test(a))) throw new Error('别名最多 20 个，不能含逗号、方括号或换行');
    if (typeof v.owner !== 'string' || !/^\d{0,20}$/.test(v.owner)) throw new Error('主人填 QQ 号，或留空');
    if (typeof v.source !== 'string' || !sourcePattern.test(v.source)) throw new Error('来源填 private、group:<群号>，或留空');
    if (!Array.isArray(v.images) || v.images.length > 8) throw new Error('每个条目最多 8 张图片');
    for (const name of v.images) if (!existsSync(join(this.dir, id, checkImage(name)))) throw new Error(`Missing image: ${id}/${name}`);
    return { id, name: v.name.trim(), aliases: v.aliases.map(a => a.trim()), owner: v.owner, source: v.source, description: v.description, images: v.images };
  }

  /** 写 entry.md，删掉文件夹里不再列出的图片。 */
  private write(e: VisualEntry): void {
    const folder = join(this.dir, e.id);
    mkdirSync(folder, { recursive: true });
    for (const file of readdirSync(folder)) if (imagePattern.test(file) && !e.images.includes(file)) rmSync(join(folder, file));
    const temp = join(folder, `${randomUUID()}.tmp-entry`);
    writeFileSync(temp, formatEntry(e), { flag: 'wx' });
    renameSync(temp, join(folder, ENTRY));
  }

  /** 整体保存：写每条的 entry.md，删掉条目里不再列出的图片和不再列出的条目文件夹。 */
  save(revision: unknown, value: unknown): LibraryState {
    this.check(revision);
    if (!Array.isArray(value) || value.length > 200) throw new Error('最多 200 个资料条目');
    const ids = new Set<string>();
    const entries = value.map((v: VisualEntry) => {
      const e = this.validate(v);
      if (ids.has(e.id)) throw new Error(`Duplicate visual entry id: ${e.id}`);
      ids.add(e.id);
      return e;
    });
    for (const old of this.read().entries) if (!ids.has(old.id)) rmSync(join(this.dir, old.id), { recursive: true, force: true });
    for (const e of entries) this.write(e);
    return this.read();
  }
}
