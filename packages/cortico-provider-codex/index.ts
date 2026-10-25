import type { ProviderModule } from 'cortico/providers/base.ts';
import { providerDir } from 'cortico/paths.ts';
import { connectionBlocks } from 'cortico/providers/webui/config.ts';
import { CodexAuth, CODEX_BASE_URL } from './server/auth.ts';
import { CodexClient } from './server/client.ts';

const catalog = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
export default {
  id: 'codex', title: 'Codex OAuth', description: 'Browser sign-in for the Codex backend; account capabilities are verified by requests.',
  describe: { protocols: ['openai-responses'], auth: ['oauth'], local: false, input: ['text', 'image'] },
  modelTypes: ['chat', 'image'], defaultBaseUrl: CODEX_BASE_URL,
  reasoningTiers: [], effortSuggestions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], serviceTiers: [],
  normalize: entry => ({ ...entry, baseUrl: CODEX_BASE_URL, secret: undefined }),
  validateEntry: entry => {
    const model = entry.options?.imageControllerModel;
    if (model !== undefined && (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(model))) throw new Error('Invalid image controller model');
  },
  availability: (name, _entry, language) => new CodexAuth(providerDir(name.split('/')[0]!)).status().signedIn
    ? { ready: true } : { ready: false, reason: language.startsWith('zh') ? '请在供应商页登录 Codex' : 'Sign in with Codex on the provider page' },
  config: (name, _entry, language) => [{ id: `llm.codex.${name}.images`, owner: 'provider:codex', schema: { type: 'object',
    title: language.startsWith('zh') ? 'Codex 生图' : 'Codex image generation', properties: {
      [`providers.${name}.options.imageControllerModel`]: { type: 'string', title: language.startsWith('zh') ? '生图主控模型' : 'Image controller model', 'x-hot': true },
    } } }],
  create(_name, entry, host) {
    const auth = host.resource?.('codex-auth', () => new CodexAuth(host.stateDir)) ?? new CodexAuth(host.stateDir);
    const client = new CodexClient(auth, host, () => entry.multimodal === true,
      () => String(host.currentEntry?.().options?.imageControllerModel ?? entry.options?.imageControllerModel ?? 'gpt-6.1-sol'));
    return { client, control: auth, generateImage: request => client.generateImage(request),
      listModels: async () => catalog.map(id => ({ id })), stop: async () => auth.stop(), compatibilityKey: () => [CODEX_BASE_URL, host.stateDir] };
  },
  webUi(host) {
    return { panels: [{ id: 'account', title: host.language.startsWith('zh') ? 'Codex 登录' : 'Codex sign-in', defaultOpen: true }, connectionBlocks(host.language).pricing],
      invoke: async (panel, method, args) => {
        if (panel !== 'account') throw new Error('Unknown panel');
        const name = (args[0] as { name?: string })?.name;
        const found = host.entries().find(row => row.name === name); if (!found) throw new Error('Unknown provider');
        const auth = host.instance(found.name).control as CodexAuth;
        if (method === 'state') return { ...auth.status(), editing: !!host.editing,
          controllerModel: found.entry.options?.imageControllerModel ?? 'gpt-6.1-sol' };
        if (host.editing) throw new Error('Save the provider before signing in');
        if (method === 'login') return auth.begin();
        if (method === 'cancel') { auth.cancel(); return {}; }
        if (method === 'logout') { await auth.logout(); return {}; }
        throw new Error('Unknown method');
      } };
  },
} satisfies ProviderModule;
