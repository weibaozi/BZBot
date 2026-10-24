import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProviderEntry, WorldHost } from 'cortico/core/types.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { secretReader } from 'cortico/core/secrets.ts';
import { providersRoot } from 'cortico/paths.ts';
import { ProviderRegistry, providerModules } from 'cortico/providers/registry.ts';
import type { ProviderModule } from 'cortico/providers/base.ts';
import { responseRequest, usageCounters } from 'cortico/protocol/open-responses/context-helpers.ts';
import { itemText } from 'cortico/protocol/open-responses/context.ts';
import { parseModelJson, type ModelInput } from './models.ts';

/** World-owned calls reuse the registered provider adapters and endpoint credentials. */
export class SharedModels {
  private registry?: ProviderRegistry;
  constructor(private root: () => string = providersRoot, private repoRoot?: string,
    private host: () => WorldHost | undefined = () => undefined, private modules: readonly ProviderModule[] = providerModules) {}

  private entries(): Record<string, LLMProviderEntry> {
    const root = this.root();
    if (!existsSync(root)) return {};
    return Object.fromEntries(readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).flatMap(d => {
      const file = join(root, d.name, 'config.json');
      return existsSync(file) ? [[d.name, JSON.parse(readFileSync(file, 'utf8')) as LLMProviderEntry]] : [];
    }));
  }
  private entry(name: string) {
    const entry = this.entries()[name];
    if (!entry?.spec?.model) throw new Error('所选全局模型已删除或尚未配置，请重新选择');
    const module = this.modules.find(m => m.id === entry.kind);
    if (!module) throw new Error('所选全局模型的供应商扩展未加载');
    return { entry, module };
  }
  list() {
    return Object.entries(this.entries()).map(([name, entry]) => ({ name, model: entry.spec?.model ?? '',
      images: entry.multimodal === true, module: entry.kind }));
  }
  embedding(name: string, queryPrefix: string) {
    const { entry, module } = this.entry(name);
    if (module.describe?.auth.some(auth => auth !== 'api-key')) throw new Error('该登录供应商不能用于 /embeddings，请选择 embedding 端点');
    return { url: entry.baseUrl, model: entry.spec!.model, queryPrefix,
      key: entry.secret ? secretReader(join(this.root(), name, '.env'))(entry.secret) : '' };
  }
  async generate(name: string, input: ModelInput, timeoutSeconds: number, signal?: AbortSignal) {
    const { entry, module } = this.entry(name);
    const spec = entry.spec!;
    if (input.image && !(module.accepts?.(entry, spec, input.image.mime) ?? entry.multimodal))
      throw new Error('所选全局模型未启用图片输入，请在模型供应商中配置视觉能力');
    const available = module.availability?.(name, entry, 'zh');
    if (available && !available.ready) throw new Error(available.reason);
    this.registry ??= new ProviderRegistry(() => this.entries(), { stateRoot: this.root(), repoRoot: this.repoRoot,
      readBlob: () => null, keepThinking: () => false, log: this.host()?.log ?? nullLogger() }, this.modules);
    const request = responseRequest(spec, []);
    request.instructions = input.instruction;
    request.input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input.data) },
      ...(input.image ? [{ type: 'input_image' as const, detail: 'auto' as const, image_url: `data:${input.image.mime};base64,${input.image.bytes.toString('base64')}` }] : [])] }];
    const result = await this.registry.bind(name).respond(request, { nativeSpec: spec, role: 'memes.caption',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutSeconds * 1000)]) });
    for (const attempt of result.attempts) this.host()?.reportUsage(usageCounters(attempt.meters), {
      model: spec.model, label: '表情语义标注', charges: attempt.charges,
    });
    if (result.response.status !== 'completed') throw new Error('视觉模型响应未完成，请重试');
    return parseModelJson(result.response.output.filter(item => item.type === 'message').map(itemText).join('\n'));
  }
  async stop() { await this.registry?.stopAll(); this.registry = undefined; }
}
