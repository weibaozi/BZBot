import type { ProviderModule } from 'cortico/providers/base.ts';
import { providerDir } from 'cortico/paths.ts';
import { connectionBlocks } from 'cortico/providers/webui/config.ts';
import { ChatGptAuth, RESOURCE } from './server/auth.ts';
import { ChatGptClient, listPlanModels } from './server/client.ts';

export default {
  id: 'chatgpt', title: 'ChatGPT', description: 'Sign in with ChatGPT to use your plan. Local myBot tools and memory stay in myBot.',
  describe: { protocols: ['openai-responses'], auth: ['oauth'], local: false, input: ['text', 'image'] },
  defaultBaseUrl: RESOURCE, reasoningTiers: [], effortSuggestions: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], serviceTiers: [],
  normalize: entry => {
    if (entry.spec && (!entry.spec.thinking || !entry.spec.reasoningEffort?.trim())) delete entry.spec.reasoningEffort;
    return { ...entry, baseUrl: RESOURCE, secret: undefined };
  },
  validateEntry: entry => { if (entry.baseUrl !== RESOURCE) throw new Error('ChatGPT plan requests must use https://api.openai.com/v1'); },
  availability: (name, entry, language) => {
    const ready = entry.spec?.model !== '__login_required__' && new ChatGptAuth(providerDir(name)).status().signedIn;
    return ready ? { ready: true } : { ready: false, reason: language.startsWith('zh') ? '请登录 ChatGPT 并选择模型' : 'Sign in with ChatGPT and select a model' };
  },
  create(_name, entry, host) {
    const auth = host.resource?.('chatgpt-auth', () => new ChatGptAuth(host.stateDir)) ?? new ChatGptAuth(host.stateDir);
    return { client: new ChatGptClient(auth, host, () => entry.multimodal === true),
      control: auth, listModels: () => listPlanModels(auth), stop: async () => auth.cancel(),
      compatibilityKey: () => [RESOURCE, host.stateDir],
    };
  },
  webUi(host) {
    const zh = host.language.startsWith('zh');
    return {
      panels: [{ id: 'account', title: zh ? 'ChatGPT 登录与模型' : 'ChatGPT account and model', defaultOpen: true }, connectionBlocks(host.language).pricing],
      invoke: async (panel, method, args) => {
        if (panel !== 'account') throw new Error('Unknown panel');
        const name = (args[0] as { name?: string } | undefined)?.name;
        const found = host.entries().find(row => row.name === name);
        if (!found) throw new Error('Unknown provider entry');
        const auth = host.instance(found.name).control as ChatGptAuth;
        if (method === 'state') return { ...auth.status(), editing: !!host.editing, spec: found.entry.spec, images: !!found.entry.multimodal };
        if (host.editing) throw new Error(zh ? '请先保存供应商配置，再登录或获取模型' : 'Save this provider before signing in or listing models');
        if (method === 'login') return auth.begin();
        if (method === 'cancel') { auth.cancel(); return {}; }
        if (method === 'logout') return auth.logout();
        if (method === 'welcome') { await auth.acknowledgePlanUse(); return {}; }
        if (method === 'models') return listPlanModels(auth);
        throw new Error('Unknown method');
      },
    };
  },
} satisfies ProviderModule;
