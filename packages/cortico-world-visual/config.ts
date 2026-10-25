import type { WorldSection } from 'cortico/world.ts';
import type { Language } from 'cortico/core/language.ts';
export interface VisualConfig extends WorldSection {
  /** 全局白名单 QQ 之外，还能让她存图的 QQ 号，逗号或空格分隔。 */
  savers: string;
  /** 控制台（管理后台）发来的图能不能存。 */
  consoleCanSave: boolean;
}
export const VISUAL_DEFAULTS: VisualConfig = { enabled: false, savers: '', consoleCanSave: true };
/** 能让她存图的 QQ：设置页「人格 → 全局变量」的白名单 QQ，加上本插件自己的名单。 */
export function saversOf(cfg: VisualConfig, trusted: readonly string[] = []): Set<string> {
  return new Set([...trusted, ...cfg.savers.split(/[\s,，]+/)].filter(s => /^\d{1,20}$/.test(s)));
}
export function visualConfigGroups(language: Language) {
  const zh = language.startsWith('zh');
  return [{ id: 'world:visual', owner: 'world:visual' as const, schema: { type: 'object' as const,
    title: zh ? '图像资料设置' : 'Visual library', properties: {
      'worlds.visual.savers': { type: 'string' as const, title: zh ? '额外的存图白名单' : 'Additional picture savers', 'x-hot': true,
        description: zh ? '设置 → 人格 → 全局变量里的白名单 QQ 总是可以；这里再加别的 QQ 号，多个用逗号分隔。' : 'Trusted QQ numbers from Settings → Persona → Global variables are always allowed; add more QQ numbers here, comma separated.' },
      'worlds.visual.consoleCanSave': { type: 'boolean' as const, title: zh ? '控制台发的图也能存' : 'Allow pictures sent from the console', 'x-hot': true },
    } } }];
}
