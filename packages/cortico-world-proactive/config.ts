import type { ConfigGroup, ConfigProperty } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
import { strings } from './strings.ts';
export interface ProactiveConfigSection {
  enabled: boolean;
  active: boolean;
  targetQQ: string;
  intervalMinutes: [number, number];
  maxUnanswered: number;
  dailyLimit: number;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}
export const PROACTIVE_DEFAULTS: ProactiveConfigSection = {
  enabled: false, active: true, targetQQ: '', intervalMinutes: [30, 90], maxUnanswered: 2,
  dailyLimit: 6, quietEnabled: false, quietStart: '23:00', quietEnd: '08:00',
};
export function proactiveConfigGroup(language: Language): ConfigGroup {
  const t = strings(language);
  const fields: Record<string, ConfigProperty> = {
    active: { type: 'boolean', title: t.active },
    targetQQ: { type: 'string', title: t.target },
    intervalMinutes: { type: 'array', title: t.interval, minItems: 2, maxItems: 2, items: { type: 'number', minimum: 1, maximum: 10080 } },
    maxUnanswered: { type: 'integer', title: t.unanswered, minimum: 1, maximum: 100 },
    dailyLimit: { type: 'integer', title: t.daily, minimum: 1, maximum: 100 },
    quietEnabled: { type: 'boolean', title: t.quiet },
    quietStart: { type: 'string', title: t.start },
    quietEnd: { type: 'string', title: t.end },
  };
  return { id: 'world:proactive', owner: 'world:proactive', schema: { type: 'object', title: t.title,
    description: t.description, properties: Object.fromEntries(Object.entries(fields).map(([key, field]) => [`worlds.proactive.${key}`, { ...field, 'x-hot': true }])) } };
}
