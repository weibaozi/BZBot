import { expect, it } from 'vitest';
import { join } from 'node:path';
import { makeCfg, makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { ProviderRegistry } from 'cortico/providers/registry.ts';
import { ProviderSettings } from 'cortico/providers/webui/settings.ts';
import { ProviderHub } from 'cortico/providers/webui/hub.ts';
import codex from '../index.ts';

it('exposes browser sign-in instead of the default API key editor', () => {
  const tmp = makeTmpDir(); const cfg = makeCfg({ providers: {} });
  const registry = new ProviderRegistry(() => cfg.providers, { stateRoot: tmp.dir, readBlob: () => null, keepThinking: () => true, log: nullLogger() }, [codex]);
  try {
    const settings = new ProviderSettings(cfg, registry, join(tmp.dir, 'config.json'), tmp.dir, [codex]);
    const hub = new ProviderHub(cfg, registry, settings, join(tmp.dir, 'config.json'), tmp.dir, [codex]);
    const sections = hub.moduleList('zh')[0].sections;
    expect(sections.map(section => section.id)).toEqual(['account', 'pricing']);
    expect(sections.some(section => section.builtin === 'connection-endpoint')).toBe(false);
  } finally { tmp.cleanup(); }
});
