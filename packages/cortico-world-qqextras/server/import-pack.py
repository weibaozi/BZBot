"""Read AstrBot meme exports into a fresh staging directory; never execute archive content."""
import hashlib
import json
import pathlib
import re
import sys
import zipfile

MAX_TOTAL = 2 * 1024**3
MAX_IMAGE = 25 * 1024**2
EXTENSIONS = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}

def run(source, target):
    target = pathlib.Path(target)
    target.mkdir(exist_ok=False, parents=True)
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > 20000 or sum(i.file_size for i in infos) > MAX_TOTAL:
            raise ValueError('Archive exceeds import limits')
        seen = set()
        for info in infos:
            path = pathlib.PurePosixPath(info.filename)
            if path.is_absolute() or '\\' in info.filename or any(p in ('.', '..') or ':' in p for p in path.parts):
                raise ValueError('Unsafe archive path')
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Archive symlinks are not supported')
            key = info.filename.casefold()
            if key in seen:
                raise ValueError('Duplicate archive path')
            seen.add(key)
        roots = [i.filename[:-len('manifest.json')] for i in infos if pathlib.PurePosixPath(i.filename).name == 'manifest.json']
        roots = [r for r in roots if any(i.filename.startswith(r + 'memes/') for i in infos)]
        if len(roots) != 1:
            raise ValueError('Expected one AstrBot pack with manifest.json and memes/')
        root = roots[0]
        def read_json(name):
            name = root + name
            if name not in archive.namelist():
                return {}
            if archive.getinfo(name).file_size > 32 * 1024**2:
                raise ValueError('Metadata file exceeds import limit')
            return json.loads(archive.read(name).decode('utf-8-sig'))
        manifest = read_json('manifest.json')
        metadata = read_json('semantic_metadata.json')
        raw_images = metadata.get('images', {})
        if not isinstance(raw_images, dict):
            raise ValueError('Unsupported semantic metadata: images must be an object')
        by_path = {str(v.get('relative_path', '')): v for v in raw_images.values() if isinstance(v, dict)}
        records = []
        for info in infos:
            if info.is_dir() or not info.filename.startswith(root + 'memes/'):
                continue
            rel = info.filename[len(root):]
            ext = pathlib.PurePosixPath(rel).suffix.lower()
            if ext not in EXTENSIONS:
                continue
            if info.file_size > MAX_IMAGE:
                raise ValueError('Image exceeds 25 MiB limit')
            data = archive.read(info)
            valid = (ext == '.png' and data.startswith(b'\x89PNG\r\n\x1a\n') or
                     ext in ('.jpg', '.jpeg') and data.startswith(b'\xff\xd8\xff') or
                     ext == '.gif' and data[:6] in (b'GIF87a', b'GIF89a') or
                     ext == '.webp' and data[:4] == b'RIFF' and data[8:12] == b'WEBP')
            if not valid:
                raise ValueError('Image signature does not match extension: ' + rel)
            digest = hashlib.sha256(data).hexdigest()
            entry = by_path.get(rel, {})
            if entry.get('content_sha256') and entry['content_sha256'] != digest:
                raise ValueError('Image hash differs from semantic metadata: ' + rel)
            category = str(entry.get('category') or pathlib.PurePosixPath(rel).parts[1])
            if not category or len(category) > 100 or re.search(r'[\\/:\x00-\x1f]', category) or category in ('.', '..', '__proto__', 'constructor', 'prototype'):
                raise ValueError('Invalid category')
            cat = manifest.get('categories', {}).get(category, {})
            description = cat.get('description', '') if isinstance(cat, dict) else str(cat)
            caption = str(entry.get('caption') or '')
            tags = entry.get('tags', [])
            if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
                raise ValueError('Invalid semantic tags')
            if len(caption) > 8000 or len(tags) > 100 or any(len(t) > 200 for t in tags):
                raise ValueError('Semantic description exceeds import limits')
            dest = target / 'images' / (digest + ext)
            dest.parent.mkdir(exist_ok=True)
            if not dest.exists():
                dest.write_bytes(data)
            records.append({'id': hashlib.sha256(rel.encode()).hexdigest()[:24], 'file': 'images/' + dest.name,
                'mime': EXTENSIONS[ext], 'category': category, 'categoryDescription': str(entry.get('category_description') or description),
                'caption': caption, 'tags': tags, 'visibleText': str(entry.get('visible_text') or ''), 'manual': bool(entry.get('manual_override', False)),
                'searchable': bool(caption.strip()) and category not in ('needs_review', '_pending_review') and entry.get('category_fit') != 'conflict'})
        pack = {'name': str(manifest.get('name') or manifest.get('id') or 'Imported pack'), 'sourceId': str(manifest.get('id') or ''),
            'images': records, 'categories': {str(k): str(v.get('description', '') if isinstance(v, dict) else v) for k, v in manifest.get('categories', {}).items()},
            'license': manifest.get('license', ''), 'author': manifest.get('author', '')}
        (target / 'pack.json').write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
        # Preserve attribution and the source metadata for later migration; no FAISS deserialization.
        for name in ('manifest.json', 'semantic_metadata.json', 'LICENSE'):
            if root + name in archive.namelist():
                info = archive.getinfo(root + name)
                if info.file_size <= 32 * 1024**2:
                    (target / name).write_bytes(archive.read(info))
        print(json.dumps({'images': len(records), 'searchable': sum(r['searchable'] for r in records)}))

if __name__ == '__main__':
    try:
        run(sys.argv[1], sys.argv[2])
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
