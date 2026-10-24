/**
 * The Persona page of myBot: our panels first, then corti-soulmate's own (checkpoints, reset, dream).
 * The page id is `persona:<bot id>` so the framework merges it with the half the Persona reports
 * (workspace, memory, history); `webui/client.ts` carries the browser half of every panel listed here.
 */
import type { Core } from 'cortico/core/core.ts';
import type { CoreConfig } from 'cortico/core/types.ts';
import { estimateTokens } from 'cortico/core/util.ts';
import { hasRole, textOf } from 'cortico/protocol/open-responses/context-helpers.ts';
import { pageIdFor, type WebUiPageContribution, type WebUiPanelDecl } from 'cortico/web/shared/webui-protocol.ts';
import type { OverviewState, TiersState } from '../shapes.ts';
import { LONG_TERM_BUDGET_TOKENS, longTermFiles, longTermTokens, pendingFiles, shortTerm, todayUsage } from './state.ts';

export const MYBOT_PANELS: WebUiPanelDecl[] = [
  { id: 'overview', title: '总览', description: '运行状态、上下文与缓存、今天的请求和最近发生的事。' },
  { id: 'tiers', title: '记忆分层', description: '短期和长期两层现在的内容，以及做梦交回的摘要和记忆的提交记录。' },
  { id: 'roadmap', title: '即将加入', description: '设计里还没实现的后台页面。' },
];
const OWN = new Set(MYBOT_PANELS.map((panel) => panel.id));

/** What the panels read from corti-soulmate's Persona. */
export interface PersonaView {
  readonly git: {
    available(): boolean;
    log(opts?: { limit?: number }): Array<{ hash: string; date: string; author: string; message: string }>;
  };
  readonly dream: { getStatus(): { dreaming: boolean } };
  emergences(): string[];
}

export interface PanelDeps {
  /** Set once the bot has started; panels answer only after that. */
  core(): Core<CoreConfig> | null;
  persona: PersonaView;
  memoryDir: string;
  dataDir: string;
  context(): { maxTokens: number; softRatio: number };
}

const EVENT_LIMIT = 12;
const COMMIT_LIMIT = 15;
const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

function started(deps: PanelDeps): Core<CoreConfig> {
  const core = deps.core();
  if (!core) throw new Error('Core 还没有启动');
  return core;
}

function systemText(core: Core<CoreConfig>): string {
  const system = core.session.records.find((record) => hasRole(record, 'system'));
  return system ? textOf(system) : '';
}

export function overviewState(deps: PanelDeps): OverviewState {
  const core = started(deps);
  const status = core.loop.getStatus();
  const prefix = systemText(core);
  return {
    run: { paused: status.paused, phase: status.phase.state, batches: status.batchesHandled },
    context: {
      estTokens: status.estTokens,
      ...deps.context(),
      prefixTokens: estimateTokens(prefix),
      lastUsage: status.lastUsage ? { prompt: status.lastUsage.promptTokens, cached: status.lastUsage.cacheHitTokens } : null,
    },
    pending: pendingFiles(longTermFiles(deps.memoryDir, prefix)),
    today: todayUsage(deps.dataDir),
    events: core.store.range({ limit: EVENT_LIMIT }).reverse().map((event) => ({
      ts: event.ts, source: event.source, type: event.type, origin: event.origin ?? 'external', text: oneLine(event.text ?? '', 140),
    })),
  };
}

export function tiersState(deps: PanelDeps): TiersState {
  const core = started(deps);
  const status = core.loop.getStatus();
  const files = longTermFiles(deps.memoryDir, systemText(core));
  let commits: TiersState['dream']['commits'] = [];
  if (deps.persona.git.available()) {
    try { commits = deps.persona.git.log({ limit: COMMIT_LIMIT }).map(({ hash, date, author, message }) => ({ hash, date, author, message })); }
    catch { commits = []; }
  }
  return {
    short: { ...shortTerm(deps.memoryDir), estTokens: status.estTokens, ...deps.context() },
    long: { budget: LONG_TERM_BUDGET_TOKENS, used: longTermTokens(files), files },
    dream: { dreaming: deps.persona.dream.getStatus().dreaming, emergences: deps.persona.emergences(), commits },
  };
}

async function invokeOwn(deps: PanelDeps, panel: string, method: string): Promise<unknown> {
  if (panel === 'overview' && method === 'state') return overviewState(deps);
  if (panel === 'overview' && method === 'reloadPrefix') {
    await started(deps).loop.reloadSystemPrefix();
    return overviewState(deps);
  }
  if (panel === 'tiers' && method === 'state') return tiersState(deps);
  if (panel === 'roadmap' && method === 'state') return {};
  throw new Error(`未知的方法: ${panel}.${method}`);
}

/**
 * Re-addresses corti-soulmate's Persona page to `botId` and puts our panels in front of its own.
 * Pages of other kinds pass through unchanged.
 */
export function withMyBotPanels(pages: WebUiPageContribution[], botId: string, deps: PanelDeps): WebUiPageContribution[] {
  const base = pages.find((page) => page.kind === 'persona');
  const rest = pages.filter((page) => page !== base);
  return [{
    ...base,
    id: pageIdFor('persona', botId),
    kind: 'persona',
    label: base?.label ?? botId,
    panels: [...MYBOT_PANELS, ...(base?.panels ?? [])],
    invoke: async (panel: string, method: string, args: unknown[]) => {
      if (OWN.has(panel)) return invokeOwn(deps, panel, method);
      if (!base?.invoke) throw new Error(`未知的面板: ${panel}`);
      return base.invoke(panel, method, args);
    },
  }, ...rest];
}
