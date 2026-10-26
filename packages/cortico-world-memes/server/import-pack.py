"""Import PNG/JPEG files from a ZIP, ignoring application-specific metadata."""
import hashlib
import json
import pathlib
import sys
import zipfile

MAX_TOTAL = 2 * 1024**3
MAX_IMAGE = 25 * 1024**2

def run(source, target):
    target = pathlib.Path(target)
    target.mkdir(exist_ok=False, parents=True)
    records = []
    hashes = set()
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > 20000 or sum(i.file_size for i in infos) > MAX_TOTAL:
            raise ValueError('Archive exceeds import limits')
        for info in infos:
            path = pathlib.PurePosixPath(info.filename)
            if path.is_absolute() or '\\' in info.filename or any(p == '..' or ':' in p for p in path.parts):
                raise ValueError('Unsafe archive path')
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Archive symlinks are not supported')
            ext = path.suffix.lower()
            if info.is_dir() or ext not in ('.png', '.jpg', '.jpeg'):
                continue
            if info.file_size > MAX_IMAGE:
                raise ValueError('Image exceeds 25 MiB limit')
            data = archive.read(info)
            if not (ext == '.png' and data.startswith(b'\x89PNG\r\n\x1a\n') or ext in ('.jpg', '.jpeg') and data.startswith(b'\xff\xd8\xff')):
                raise ValueError('Image signature does not match extension: ' + info.filename)
            digest = hashlib.sha256(data).hexdigest()
            if digest in hashes:
                continue
            hashes.add(digest)
            ext = '.png' if ext == '.png' else '.jpg'
            dest = target / 'images' / (digest + ext)
            dest.parent.mkdir(exist_ok=True)
            dest.write_bytes(data)
            records.append({'id': digest[:24], 'file': 'images/' + dest.name,
                'mime': 'image/png' if ext == '.png' else 'image/jpeg', 'category': '未分类', 'categoryDescription': '',
                'caption': '', 'tags': [], 'visibleText': '', 'searchable': False})
    if not records:
        raise ValueError('ZIP contains no PNG or JPEG images')
    pack = {'name': pathlib.Path(source).stem, 'sourceId': '', 'images': records,
        'categories': {'未分类': ''}, 'license': '', 'author': '', 'enabled': True}
    (target / 'pack.json').write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'images': len(records), 'searchable': 0}))

if __name__ == '__main__':
    run(*sys.argv[1:])
