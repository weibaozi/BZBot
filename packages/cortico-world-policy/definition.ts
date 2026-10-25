import type { WorldDefinition } from 'cortico/world.ts';
import { POLICY_DEFAULTS, type PolicyConfigSection } from './config.ts';
import { PolicyWorld } from './world.ts';
export const POLICY: WorldDefinition<PolicyConfigSection> = {
  id: 'policy', label: '底层规则', defaults: () => ({ ...POLICY_DEFAULTS }),
  create: ctx => new PolicyWorld(ctx), describe: { tools: [], events: [] },
};
