/** 即将加入: the admin pages the design has that this version does not implement yet. */
import type { WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

const PLANNED: Array<{ k: string; v: string }> = [
  { k: '记忆知识库', v: 'M2：索引状态、检索测试（和 bot 的 recall 走同一条路）' },
  { k: '状态与主动性', v: 'M3：心情和当前活动、心跳与免打扰、闹钟、主动发起记录' },
  { k: 'MCP 服务', v: 'M4：接入生图、搜索等工具，启停与权限' },
  { k: '委派与插件审批', v: 'M5：Codex / Claude Code 委派任务，新插件的审批' },
  { k: '备份与迁移、多机器人', v: 'M6：bundle 导出导入、git 推送状态、机器人列表与切换' },
];

export const roadmapPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui } = ctx;
    const card = ui.sheet({ title: '即将加入', desc: '设计稿里还没实现的页面，按开工顺序（docs/architecture.md 第 7 节）。' });
    card.body.append(ui.kv(PLANNED));
    ctx.root.append(card.el);
  },
};
