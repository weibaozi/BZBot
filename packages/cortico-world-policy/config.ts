import type { WorldSection } from 'cortico/world.ts';
export interface PolicyConfigSection extends WorldSection { enabled: boolean }
export const POLICY_DEFAULTS: PolicyConfigSection = { enabled: false };
