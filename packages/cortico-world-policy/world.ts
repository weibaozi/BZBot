import { join } from 'node:path';
import * as prefix from 'cortico/core/prefix.ts';
import type { World, PrefixSegment } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
import type { PolicyConfigSection } from './config.ts';
import { PolicyStore } from './server/layers.ts';

export class PolicyWorld implements World {
  readonly id = 'policy';
  readonly leadingSystemSegmentsAfter = 'orientation';
  readonly store: PolicyStore;
  constructor(ctx: WorldContext<PolicyConfigSection>) {
    if (prefix.WORLD_LEADING_SYSTEM_SEGMENTS !== 2) throw new Error('Update patch 0017: anchored system segments are required');
    // Deployment settings, outside the Persona memory workspace and memory cleanup.
    this.store = new PolicyStore(join(ctx.botDir, 'policy', 'layers.json'));
  }
  envPromptVars() { return null; }
  tools() { return []; }
  async start() { this.store.read(); }
  async stop() {}
  leadingSystemSegments(): PrefixSegment[] {
    return this.store.read().layers.filter(layer => layer.enabled && layer.text.trim())
      .map(layer => ({ title: layer.title, text: layer.text + '\n\n' }));
  }
  webUi(language: Language = 'zh') {
    const zh = language.startsWith('zh');
    return {
      label: zh ? '底层规则' : 'Base rules',
      panels: [{ id: 'layers', title: zh ? '规则分层' : 'Rule layers' }],
      invoke: async (panel: string, method: string, args: unknown[]) => {
        if (panel !== 'layers') throw new Error('Unknown panel');
        if (method === 'read') return this.store.read();
        if (method === 'save') return this.store.save(args[0], args[1]);
        throw new Error('Unknown method');
      },
    };
  }
}
