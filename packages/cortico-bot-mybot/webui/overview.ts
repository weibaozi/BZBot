/** 总览: run state, context and cache, edits waiting for the next prefix, today's requests, recent events. */
import type { WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { autoload, errText, setMsg, stamp } from '../../../vendor/cortico/bots/cormini/webui/shared.ts';
import type { OverviewState } from '../shapes.ts';

const POLL_MS = 5000;
const PHASES: Record<string, string> = {
  idle: '空闲', delivering: '投递中', model: '思考中', tools: '执行工具', backoff: '等待重试', handoff: '交接中',
};
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export const overviewPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    autoload<OverviewState>(ctx, {
      loading: '读取运行状态…',
      failed: '总览不可用',
      load: () => ctx.invoke<OverviewState>('state'),
      render: (state) => {
        const view = render(ctx, state);
        ctx.interval(() => {
          void ctx.invoke<OverviewState>('state').then((next) => { if (!ctx.signal.aborted) view.paint(next); }, () => {});
        }, POLL_MS);
        return view.nodes;
      },
    });
  },
};

function render(ctx: WebUiPanelContext, initial: OverviewState) {
  const { ui } = ctx;
  const stats = ui.h('div');
  const contextCard = ui.sheet({ title: '上下文与缓存', desc: '前缀在会话中途冻结；会变的内容都追加在末尾。' });
  const gauge = ui.progress({ label: '会话 token', format: (value, max) => `${value.toLocaleString()} / ${max.toLocaleString()}` });
  const contextFacts = ui.h('div');
  const pending = ui.h('div');
  const msg = ui.msgline('');
  const reload = ui.button('立即生效（损失一次缓存）', { onClick: () => void apply() });
  const bar = ui.actions(); bar.append(msg, ui.h('span', 'grow'), reload);
  contextCard.body.append(gauge.el, contextFacts, pending, bar);
  const eventsCard = ui.sheet({ title: '最近发生的事', desc: '来自事件库，最新的在上面。' });
  const events = ui.h('div');
  eventsCard.body.append(events);

  const paint = (state: OverviewState): void => {
    const { run, context, today } = state;
    const lastHit = context.lastUsage ? pct(context.lastUsage.cached, context.lastUsage.prompt) : '—';
    stats.replaceChildren(ui.statgrid([
      { k: '状态', v: run.paused ? '已暂停' : PHASES[run.phase] ?? run.phase, accent: !run.paused },
      { k: '今天的请求', v: today.requests, unit: '次' },
      { k: '今天的缓存命中', v: pct(today.cachedTokens, today.promptTokens) },
      { k: '最近一条命中', v: lastHit },
    ]));
    gauge.setValue(context.estTokens, context.maxTokens);
    contextFacts.replaceChildren(ui.kv([
      { k: '软阈值', v: `${Math.round(context.softRatio * 100)}%（${Math.round(context.maxTokens * context.softRatio).toLocaleString()} tok），越过后先提醒记笔记，下一批结束时交接` },
      { k: '冻结前缀', v: `${context.prefixTokens.toLocaleString()} tok` },
    ]));
    const waiting = state.pending.length > 0;
    pending.replaceChildren(waiting
      ? ui.msgline(`${state.pending.length} 个文件改过，等下次交接生效：${state.pending.join('、')}`, true)
      : ui.msgline('长期记忆的文件都和前缀一致。'));
    reload.disabled = !waiting;
    const table = ui.table({ head: ['时间', '来源', '类型', '内容'] });
    for (const event of state.events) {
      table.addRow([
        { text: stamp(event.ts), cls: 'mono' },
        { text: event.source, cls: 'mono' },
        { text: event.type, cls: 'mono' },
        { text: event.text, cls: 'txt' },
      ]);
    }
    events.replaceChildren(state.events.length ? table.el : ui.msgline('还没有事件。'));
  };

  const apply = async (): Promise<void> => {
    const ok = await ui.confirm({
      title: '立即生效',
      body: '重建前缀后，改过的文件马上进入上下文；下一条请求的缓存会全部失效，之后恢复正常。',
    });
    if (!ok) return;
    reload.disabled = true;
    try {
      paint(await ctx.invoke<OverviewState>('reloadPrefix'));
      setMsg(msg, '前缀已重建');
    } catch (err) {
      setMsg(msg, `重建失败: ${errText(err)}`, true);
      reload.disabled = false;
    }
  };

  paint(initial);
  return { nodes: [stats, contextCard.el, eventsCard.el], paint };
}
