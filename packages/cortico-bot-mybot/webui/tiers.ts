/** 记忆分层: the short and long tiers as they stand, and what dreaming handed back. */
import type { WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { autoload, stamp } from '../../../vendor/cortico/bots/cormini/webui/shared.ts';
import type { TiersState } from '../shapes.ts';

/** The long tier is checked for consolidation past this share of its budget (docs/memory.md §3). */
const BUDGET_WARN = 0.9;
const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export const tiersPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    autoload<TiersState>(ctx, {
      loading: '读取记忆分层…',
      failed: '记忆分层不可用',
      load: () => ctx.invoke<TiersState>('state'),
      render: (state) => [shortCard(ctx, state), longCard(ctx, state), dreamCard(ctx, state)],
    });
  },
};

function shortCard(ctx: WebUiPanelContext, { short }: TiersState): HTMLElement {
  const { ui } = ctx;
  const card = ui.sheet({ title: '短期记忆', desc: '当前会话、正在跟进的事（memo/active，前缀只列文件名）和交接笔记。' });
  const gauge = ui.progress({ label: '当前会话', value: short.estTokens, max: short.maxTokens, format: (value, max) => `${value.toLocaleString()} / ${max.toLocaleString()} tok` });
  const active = ui.table({ head: ['正在跟进', '更新于'] });
  for (const file of short.memoActive) active.addRow([{ text: file.name, cls: 'mono' }, { text: stamp(file.mtime), cls: 'mono' }]);
  const handoffs = ui.table({ head: ['交接笔记', '写于', '大小'] });
  for (const file of short.handoffs) handoffs.addRow([{ text: file.name, cls: 'mono' }, { text: stamp(file.mtime), cls: 'mono' }, { text: kb(file.bytes), cls: 'mono' }]);
  card.body.append(
    gauge.el,
    short.memoActive.length ? active.el : ui.msgline('memo/active 是空的。'),
    short.handoffs.length ? handoffs.el : ui.msgline('还没有交接过。'),
    ui.msgline(`memo/archived 里有 ${short.archived} 条归档。`),
  );
  return card.el;
}

function longCard(ctx: WebUiPanelContext, { long }: TiersState): HTMLElement {
  const { ui } = ctx;
  const card = ui.sheet({ title: '长期记忆', desc: '整篇放进前缀，每次请求都要付费；会话中途改动要等下次交接才进前缀。' });
  const over = long.used >= long.budget * BUDGET_WARN;
  const gauge = ui.progress({ label: '占用', value: long.used, max: long.budget, tone: over ? 'warn' : undefined, format: (value, max) => `${value.toLocaleString()} / ${max.toLocaleString()} tok` });
  const table = ui.table({ head: ['文件', '内容', 'token', '平时 / 做梦时', '前缀'] });
  for (const file of long.files) {
    const status = file.inPrefix === null
      ? ui.pill('按需读取', 'plain')
      : file.inPrefix ? ui.pill('与前缀一致', 'on') : ui.chip('已修改，待生效', 'warn');
    table.addRow([
      { text: file.path, cls: 'mono' },
      { text: file.what, cls: 'txt' },
      { text: file.tokens.toLocaleString(), cls: 'mono' },
      { text: file.perm, cls: 'txt' },
      status,
    ]);
  }
  card.body.append(gauge.el, long.files.length ? table.el : ui.msgline('还没有长期记忆文件。'));
  if (over) card.body.append(ui.msgline('超过预算的 90%：下次做梦时应合并，或降级到知识库。', true));
  return card.el;
}

function dreamCard(ctx: WebUiPanelContext, { dream }: TiersState): HTMLElement {
  const { ui } = ctx;
  const card = ui.sheet({ title: '做梦与提交记录', desc: '做梦在每次交接后整理工作区；工作区的每次改动都有 git 提交。要手动入梦，用「强制入梦」页签。' });
  const state = ui.rowbar();
  state.append(ui.h('span', 'ct-dim', '梦'), ui.pill(dream.dreaming ? '进行中' : '空闲', dream.dreaming ? 'on' : 'off'));
  const surfaced = ui.table({ head: ['最近交回的摘要'] });
  for (const text of [...dream.emergences].reverse()) surfaced.addRow([{ text, cls: 'txt' }]);
  const commits = ui.table({ head: ['时间', '作者', '说明', '提交'] });
  for (const commit of dream.commits) {
    commits.addRow([
      { text: stamp(commit.date), cls: 'mono' },
      { text: commit.author, cls: 'mono' },
      { text: commit.message, cls: 'txt' },
      { text: commit.hash, cls: 'mono' },
    ]);
  }
  card.body.append(
    state,
    dream.emergences.length ? surfaced.el : ui.msgline('做梦还没有交回过摘要。'),
    dream.commits.length ? commits.el : ui.msgline('没有提交记录（工作区未启用 git，或还没有改动）。'),
  );
  return card.el;
}
