import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { MEMES_DEFAULTS } from '../config.ts';
import { MemesWorld } from '../world.ts';
import type { ModelHub, ModelInfo, ChatOptions } from 'cortico/providers/model-hub.ts';
import type { ContextRecord } from 'cortico/protocol/open-responses/context.ts';
import { responseRequest } from 'cortico/protocol/open-responses/context-helpers.ts';
import { FakeLLM, textReply } from '../../../vendor/cortico/tests/core/helpers.ts';
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
export class FakeModelHub implements ModelHub {
  readonly chatCalls: Array<{ ref: string; context: readonly ContextRecord[]; options?: ChatOptions }> = [];
  readonly embedCalls: Array<{ ref: string; texts: readonly string[]; signal?: AbortSignal }> = [];
  readonly llm = new FakeLLM();
  constructor(private reply: (context: readonly ContextRecord[], options?: ChatOptions) => Promise<Record<string, unknown> | string>
    = async () => { throw new Error('Unexpected caption request'); }) {
    this.llm.usage = { promptTokens: 12, completionTokens: 7, cacheHitTokens: 4, cacheMissTokens: 8 };
  }
  list(type?: ModelInfo['type'], filter?: { image?: boolean }): ModelInfo[] {
    const models: ModelInfo[] = [
      { ref: 'fixture/embedding', source: 'fixture', model: 'embedding', type: 'embedding', multimodal: false },
      { ref: 'fixture/caption', source: 'fixture', model: 'caption', type: 'chat', multimodal: true },
    ];
    return models.filter(m => (!type || m.type === type) && (!filter?.image || m.multimodal));
  }
  async chat(ref: string, context: readonly ContextRecord[], options?: ChatOptions) {
    options?.signal?.throwIfAborted();
    this.chatCalls.push({ ref, context: structuredClone(context), options });
    const result = await this.reply(context, options);
    this.llm.script(textReply(typeof result === 'string' ? result : JSON.stringify(result)));
    const spec = { model: ref.split('/')[1], thinking: true, ...options?.overrides };
    return this.llm.respond(responseRequest(spec, context), { nativeSpec: spec, role: options?.role });
  }
  async embed(ref: string, texts: readonly string[], signal?: AbortSignal) {
    signal?.throwIfAborted(); this.embedCalls.push({ ref, texts: [...texts], signal });
    return texts.map(t => t.includes('抱') ? [3, 0] : [0, 2]);
  }
  async rerank(): Promise<Array<{ index: number; score: number }>> { throw new Error('Unexpected rerank request'); }
  async transcribe(): Promise<string> { throw new Error('Unexpected transcription request'); }
  async speak(): Promise<{ bytes: Uint8Array; mime: string }> { throw new Error('Unexpected speech request'); }
}
export function world(dir: string, models: ModelHub = new FakeModelHub()) {
  const cfg = structuredClone(MEMES_DEFAULTS);
  cfg.memes.embeddingModel = 'fixture/embedding'; cfg.memes.captionModel = 'fixture/caption';
  const instance = new MemesWorld({ id: 'memes', cfg, timezone: 'UTC', botName: 'fixture', botDir: dir, packageDir: dir,
    dataDir: join(dir, 'data'), repoRoot: dir, models, secret: () => { throw new Error('Unexpected secret read'); }, storeSecret: () => { throw new Error('Unexpected secret write'); },
    persist: () => { throw new Error('Unexpected configuration mutation'); }, restart: async () => {} });
  return { instance, cfg, models };
}
