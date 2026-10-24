"""Export a metadata snapshot and immutable image bytes in AstrBot's portable format."""
import hashlib
import json
import pathlib
import re
import sys
import zipfile

snapshot, source, destination = map(pathlib.Path, sys.argv[1:])
pack = json.loads(snapshot.read_text(encoding='utf-8'))
categories = {k: {'description': v} for k, v in pack.get('categories', {}).items()}
metadata = {}
created = False
try:
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        created = True
        archive.writestr('memes/', b'')
        for image in pack['images']:
            if image.get('deletedAt'):
                continue
            category = image['category']
            if not category or re.search(r'[\\/\x00-\x1f]', category) or category in ('.', '..'):
                raise ValueError('Invalid category')
            if not re.fullmatch(r'images/[a-f0-9]{64}\.(png|jpg|jpeg|gif|webp)', image['file']):
                raise ValueError('Invalid image path')
            data = (source / image['file']).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            relative = f"memes/{category}/{image['id']}{pathlib.Path(image['file']).suffix}"
            archive.writestr(relative, data)
            categories.setdefault(category, {'description': image['categoryDescription']})
            metadata[image['id']] = {'relative_path': relative, 'entry_id': image['id'], 'content_sha256': digest,
                'category': category, 'category_description': image['categoryDescription'], 'caption': image['caption'],
                'tags': image['tags'], 'visible_text': image['visibleText'], 'category_fit': 'match' if image['searchable'] else 'conflict',
                'manual_override': image.get('manual', False)}
        manifest = {'id': pack['sourceId'] or pack['id'], 'name': pack['name'], 'categories': categories,
            'license': pack['license'], 'author': pack['author']}
        archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
        archive.writestr('semantic_metadata.json', json.dumps({'schema_version': '2.0', 'images': metadata}, ensure_ascii=False))
        if (source / 'LICENSE').is_file():
            archive.write(source / 'LICENSE', 'LICENSE')
except Exception:
    # The destination uses exclusive creation; leave no partial archive produced by this invocation.
    if created and destination.exists():
        destination.unlink()
    raise
