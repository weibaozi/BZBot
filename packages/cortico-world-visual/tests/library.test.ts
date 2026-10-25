import { expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { VisualLibrary, parseEntry, formatEntry } from '../server/library.ts';
import { makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');

it('round-trips entry.md front matter', () => {
  const entry = { name: '团子', aliases: ['你家的猫', '那只橘猫'], owner: '361270936', source: 'private', description: '橘色短毛猫，左耳有缺口。' };
  expect(parseEntry('团子', formatEntry(entry))).toEqual({ id: '团子', ...entry });
  expect(parseEntry('bare', '只写了说明')).toMatchObject({ name: 'bare', aliases: [], description: '只写了说明' });
});

it('keeps entries as folders, protects revisions and rejects paths', () => {
  const tmp = makeTmpDir(), lib = new VisualLibrary(join(tmp.dir, 'visual'));
  try {
    expect(lib.read().entries).toEqual([]);
    const { file, revision } = lib.upload(lib.read().revision, 'self', png.toString('base64'));
    expect(file).toMatch(/^[a-f0-9]{12}\.png$/);
    // 只有图、还没写 entry.md 的文件夹也是条目，名字取 id。
    expect(lib.read().entries).toEqual([{ id: 'self', name: 'self', aliases: [], owner: '', source: '', description: '', images: [file] }]);
    const state = lib.save(revision, [
      { id: 'self', name: 'Yuki', aliases: ['我'], owner: '', source: '', description: 'blue hair', images: [file] },
      { id: '团子', name: '团子', aliases: [], owner: '361270936', source: 'private', description: 'orange cat', images: [] },
    ]);
    expect(readFileSync(join(lib.dir, 'self', 'entry.md'), 'utf8')).toBe('---\nname: Yuki\naliases: [我]\n---\nblue hair\n');
    expect(new VisualLibrary(lib.dir).entry('团子')).toMatchObject({ owner: '361270936', source: 'private' });
    expect(() => lib.save(revision, [])).toThrow('修改');
    // 保存时去掉的图片和条目会从目录里删除。
    lib.save(state.revision, [{ ...state.entries.find(e => e.id === 'self')!, images: [] }]);
    expect(existsSync(join(lib.dir, 'self', file))).toBe(false);
    expect(existsSync(join(lib.dir, '团子'))).toBe(false);
    expect(() => lib.image('../..', 'secret.png')).toThrow('Invalid');
    expect(() => lib.image('self', '../x.png')).toThrow('Invalid');
    expect(() => lib.upload(lib.read().revision, 'a/b', png.toString('base64'))).toThrow('Invalid');
    expect(() => lib.upload(lib.read().revision, 'self', Buffer.from('<svg/>').toString('base64'))).toThrow();
    expect(() => lib.save(lib.read().revision, [{ id: 'x', name: 'x', aliases: [], owner: '', source: 'somewhere', description: '', images: [] }])).toThrow('来源');
  } finally { tmp.cleanup(); }
});

it('keeps the uploaded file name, fixes its extension and reuses identical pictures', () => {
  const tmp = makeTmpDir(), lib = new VisualLibrary(join(tmp.dir, 'visual'));
  const other = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  try {
    const up = (bytes: Buffer, name?: string) => lib.upload(lib.read().revision, 'self', bytes.toString('base64'), name).file;
    expect(up(png, '正面 立绘.PNG')).toBe('正面 立绘.png');
    expect(up(png, 'copy.png')).toBe('正面 立绘.png');
    expect(up(other, 'C:\\fakepath\\正面 立绘.jpg')).toBe('正面 立绘-2.png');
    expect(up(other, '../../evil.png')).toBe('正面 立绘-2.png');
    expect(lib.upload(lib.read().revision, 'x', other.toString('base64'), '..\\..\\evil<>.png').file).toBe('evil.png');
    expect(up(Buffer.concat([png]), undefined)).toBe('正面 立绘.png');
    expect(lib.read().entries.find(e => e.id === 'self')!.images).toEqual(['正面 立绘-2.png', '正面 立绘.png']);
  } finally { tmp.cleanup(); }
});

it('adds pictures to an entry without rewriting other entries, and only tightens the source', () => {
  const tmp = makeTmpDir(), lib = new VisualLibrary(join(tmp.dir, 'visual'));
  try {
    lib.save(lib.read().revision, [{ id: 'other', name: 'Other', aliases: [], owner: '', source: '', description: 'kept', images: [] }]);
    const handWritten = '---\nname: Other\naliases: []\n---\nkept\n\n# 手写的标题\n';
    writeFileSync(join(lib.dir, 'other', 'entry.md'), handWritten);
    const first = lib.add('团子', { bytes: png, mime: 'image/png' }, { description: 'orange cat', owner: '361270936', source: 'group:922728092' });
    expect(first).toMatchObject({ created: true, entry: { name: '团子', owner: '361270936', source: 'group:922728092', images: [first.file] } });
    const again = lib.add('团子', { bytes: png, mime: 'image/png' }, { owner: '779070626', source: 'private' });
    expect(again).toMatchObject({ created: false, entry: { owner: '361270936', source: 'private', description: 'orange cat', images: [first.file] } });
    expect(lib.add('团子', { bytes: png, mime: 'image/png' }, { owner: '', source: 'group:1' }).entry.source).toBe('private');
    expect(readFileSync(join(lib.dir, 'other', 'entry.md'), 'utf8')).toBe(handWritten);
    expect(() => lib.add('x', { bytes: png, mime: 'image/gif' }, { owner: '', source: '' })).toThrow('PNG');
  } finally { tmp.cleanup(); }
});
