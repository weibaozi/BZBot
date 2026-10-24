import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { QQEXTRAS_DEFAULTS } from '../config.ts';
import { QqextrasWorld } from '../world.ts';
import type { Embed } from '../server/search.ts';
import type { Generate } from '../server/models.ts';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==', 'base64');
export async function archive(dir: string, extras: Record<string, string> = {}) {
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify({ id: 'fixture', name: 'Fixture pack', categories: { affection: { description: '安慰' }, happy: { description: '高兴' } } }),
    'semantic_metadata.json': JSON.stringify({ schema_version: '2.0', images: {
      a: { relative_path: 'memes/affection/a.png', category: 'affection', caption: '给对方一个抱抱', tags: ['安慰', '拥抱'], visible_text: '抱抱' },
      b: { relative_path: 'memes/happy/b.png', category: 'happy', caption: '开心庆祝', tags: ['开心'], visible_text: '耶' },
    } }), ...extras,
  };
  const manifest = join(dir, 'fixture-files.json'); await writeFile(manifest, JSON.stringify(files));
  const path = join(dir, 'pack.zip');
  await promisify(execFile)('python', ['-c', 'import zipfile,json,sys,base64; z=zipfile.ZipFile(sys.argv[1],"w"); d=json.load(open(sys.argv[2],encoding="utf-8")); [z.writestr(k,v) for k,v in d.items()]; [z.writestr(k,base64.b64decode(sys.argv[3])) for k in ["memes/affection/a.png","memes/happy/b.png"]]; z.close()', path, manifest, PNG.toString('base64')], { windowsHide: true });
  return path;
}
export const embed: Embed = async texts => texts.map(t => t.includes('抱') ? [1, 0] : [0, 1]);
export function world(dir: string, embedding = embed, generate?: Generate) {
  const cfg = structuredClone(QQEXTRAS_DEFAULTS);
  cfg.memes.embeddingUrl = 'http://embedding.test/v1'; cfg.memes.embeddingModel = 'fixture-model';
  const instance = new QqextrasWorld({ id: 'qqextras', cfg, timezone: 'UTC', botName: 'fixture', botDir: dir, packageDir: dir,
    dataDir: join(dir, 'data'), repoRoot: dir, secret: () => '', storeSecret: () => { throw new Error('No secrets in fixture'); },
    persist: () => { throw new Error('Unexpected configuration mutation'); }, restart: async () => {} }, embedding, generate);
  return { instance, cfg };
}
