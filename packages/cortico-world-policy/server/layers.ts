import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PolicyLayer { id: string; title: string; enabled: boolean; text: string }
export interface PolicyDocument { version: 1; layers: PolicyLayer[] }
export interface PolicyState { revision: string; layers: PolicyLayer[]; preview: string }

export function validateLayers(value: unknown): PolicyLayer[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Expected up to 64 rule layers');
  const ids = new Set<string>();
  let size = 0;
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid rule layer');
    const row = item as Partial<PolicyLayer>;
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id)) throw new Error('Invalid or duplicate layer id');
    if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 200) throw new Error('A layer needs a title (1–200 characters)');
    if (typeof row.enabled !== 'boolean' || typeof row.text !== 'string') throw new Error('Invalid layer content');
    size += row.text.length;
    if (size > 200_000) throw new Error('Rules exceed 200,000 characters');
    ids.add(row.id);
    return { id: row.id, title: row.title, enabled: row.enabled, text: row.text };
  });
}

/** Text is literal; templates inside operator rules are never expanded. */
export function renderLayers(layers: readonly PolicyLayer[]): string {
  return layers.filter(layer => layer.enabled && layer.text.trim()).map(layer => layer.text + '\n\n').join('');
}

export class PolicyStore {
  constructor(readonly file: string) {}
  read(): PolicyState {
    let raw: string;
    try { raw = readFileSync(this.file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      raw = JSON.stringify({ version: 1, layers: [] });
    }
    const doc = JSON.parse(raw) as PolicyDocument;
    if (doc.version !== 1) throw new Error('Unsupported rules version');
    const layers = validateLayers(doc.layers);
    return { revision: createHash('sha256').update(raw).digest('hex'), layers, preview: renderLayers(layers) };
  }
  save(revision: unknown, value: unknown): PolicyState {
    const current = this.read();
    if (typeof revision !== 'string' || current.revision !== revision) throw new Error('Rules changed in another editor; reload before saving');
    const layers = validateLayers(value);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, layers }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, this.file);
    } finally {
      try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return this.read();
  }
}
