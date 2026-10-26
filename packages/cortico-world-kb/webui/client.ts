import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import './style.css';

interface Status {
  counts: { chat: number; file: number; group: number; vectors: number };
  cursor: number; lastRun: number | null; embeddingModel: string; configuredModel: string;
  running: boolean; lastError: string; path: string;
  lastResult: { chats: number; files: number; removed: number; expired: number; embedded: number } | null;
}
interface Hit { id: number; kind: string; where: string; time: string; people: string[]; score: number; fullText: number | null; vector: number | null; text: string }
interface Members { group: string; groupName: string; days: number; members: Array<{ qq: string; names: string[]; messages: number; lastAt: string; peopleFile: boolean }> }

export default { panels: { index: { async mount(ctx) {
  const zh = ctx.language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const root = document.createElement('div'); root.className = 'kb-panel';
  const status = document.createElement('div'); status.className = 'kb-status';
  const message = document.createElement('p'); message.setAttribute('role', 'status');
  const actions = document.createElement('div'); actions.className = 'kb-actions';
  const results = document.createElement('div'); results.className = 'kb-results';

  function button(label: string, action: () => Promise<void>, variant: 'primary' | 'danger' = 'primary') {
    const b = ctx.ui.button(label, { variant }); b.type = 'button';
    b.addEventListener('click', () => { b.disabled = true; void action().catch((e) => { message.textContent = String(e); }).finally(() => { b.disabled = false; }); }, { signal: ctx.signal });
    return b;
  }
  function row(label: string, value: string) {
    const line = document.createElement('div');
    const k = document.createElement('span'); k.className = 'kb-key'; k.textContent = label;
    const v = document.createElement('span'); v.textContent = value;
    line.append(k, v); return line;
  }
  async function refresh() {
    const s = await ctx.invoke<Status>('status');
    status.replaceChildren(
      row(t('聊天片段', 'Chat windows'), `${s.counts.chat}${t('(其中群聊 ', ' (group ')}${s.counts.group})`),
      row(t('笔记片段', 'Note sections'), String(s.counts.file)),
      row(t('已有向量', 'With vectors'), `${s.counts.vectors} / ${s.counts.chat + s.counts.file}`),
      row(t('嵌入模型', 'Embedding model'), s.configuredModel || t('未配置(只用全文检索)', 'none (full-text only)')),
      row(t('索引到事件', 'Indexed up to event'), `#${s.cursor}`),
      row(t('上次索引', 'Last run'), s.lastRun ? new Date(s.lastRun).toLocaleString() : t('还没有', 'never')),
      row(t('索引文件', 'Index file'), s.path),
    );
    message.textContent = s.lastError ? t(`上次索引出错:${s.lastError}`, `Last run failed: ${s.lastError}`) : s.running ? t('正在索引…', 'Indexing…') : '';
  }

  const query = ctx.ui.input({ value: '' }); query.placeholder = t('检索测试:和她的 recall 走同一条路,但看得到全部', 'Test search: same path as her recall, without the per-chat limit');
  const group = ctx.ui.input({ value: '' }); group.placeholder = t('群号', 'Group number');
  actions.append(
    button(t('立即索引', 'Index now'), async () => { await ctx.invoke('run'); await refresh(); message.textContent = t('索引完成', 'Done'); }),
    button(t('重建索引', 'Rebuild'), async () => {
      if (!await ctx.ui.confirm({ title: t('清空索引并从头重建?事件库和记忆文件不受影响。', 'Clear the index and rebuild it? Chat logs and memory files are untouched.'), danger: true })) return;
      await ctx.invoke('rebuild'); await refresh(); message.textContent = t('已重建', 'Rebuilt');
    }, 'danger'),
  );
  const searchRow = document.createElement('div'); searchRow.className = 'kb-search';
  searchRow.append(query, button(t('搜索', 'Search'), async () => {
    const hits = await ctx.invoke<Hit[]>('search', [query.value]);
    results.replaceChildren(...(hits.length ? hits.map((h) => {
      const card = document.createElement('article'); card.className = 'kb-hit';
      const meta = document.createElement('div'); meta.className = 'kb-meta';
      meta.textContent = `#${h.id} · ${h.kind === 'file' ? t('笔记', 'note') : t('聊天', 'chat')} · ${h.where} · ${h.time} · ${t('分数', 'score')} ${h.score}`
        + (h.fullText !== null ? ` · ${t('全文', 'text')} ${h.fullText}` : '') + (h.vector !== null ? ` · ${t('向量', 'vector')} ${h.vector}` : '');
      const body = document.createElement('pre'); body.textContent = h.text;
      card.append(meta, body); return card;
    }) : [Object.assign(document.createElement('p'), { textContent: t('没有结果', 'No results') })]));
  }));
  const membersRow = document.createElement('div'); membersRow.className = 'kb-search';
  membersRow.append(group, button(t('查群成员', 'Group members'), async () => {
    const m = await ctx.invoke<Members>('members', [group.value]);
    const table = document.createElement('table'); table.className = 'kb-members';
    const head = document.createElement('tr');
    for (const h of ['QQ', t('昵称', 'Names'), t('消息数', 'Messages'), t('最后发言', 'Last'), t('people 档案', 'People file')]) head.append(Object.assign(document.createElement('th'), { textContent: h }));
    table.append(head);
    for (const p of m.members) {
      const tr = document.createElement('tr');
      for (const v of [p.qq, p.names.join(' / '), String(p.messages), p.lastAt, p.peopleFile ? '✓' : '—']) tr.append(Object.assign(document.createElement('td'), { textContent: v }));
      table.append(tr);
    }
    const title = Object.assign(document.createElement('p'), { textContent: `${m.groupName || m.group}(${m.group}) · ${t(`最近 ${m.days} 天`, `last ${m.days} days`)} · ${m.members.length} ${t('人', 'people')}` });
    results.replaceChildren(title, table);
  }));

  root.append(status, actions, message, searchRow, membersRow, results);
  ctx.root.append(root);
  await refresh();
} } } } satisfies WebUiClientBundle;
