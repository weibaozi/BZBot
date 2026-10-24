import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
interface Entry { id: string; caption: string; category: string; tags: string[]; visibleText: string }
export default { panels: { memes: { async mount(ctx: WebUiPanelContext) {
  const { root, signal } = ctx;
  const t = (zh: string, en: string) => ctx.language.startsWith('zh') ? zh : en;
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
  const status = h('p'); const report = h('p'); const actions = h('div'); const results = h('div');
  const run = async (fn: () => Promise<void>) => { try { report.textContent = ''; await fn(); } catch (error) { report.textContent = String(error); } };
  const button = (label: string, fn: () => Promise<void>) => {
    const b = h('button', label); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; void run(fn).finally(() => { b.disabled = false; }); }, { signal }); return b;
  };
  let urls: string[] = []; let offset = 0;
  const clear = () => { urls.forEach(URL.revokeObjectURL); urls = []; results.replaceChildren(); };
  ctx.own({ dispose: clear });
  async function show(entries: Entry[]) {
    clear();
    for (const entry of entries) {
      const box = h('article'); box.style.cssText = 'padding:12px;border-bottom:1px solid #8885';
      box.append(h('strong', entry.category), h('p', entry.caption || t('缺少语义描述，暂不能建立索引', 'Missing semantic description; not indexable')), h('p', entry.tags.join(' · ')));
      box.append(button(t('查看图片', 'View image'), async () => {
        const blob = await ctx.invokeBinary('image', [{ id: entry.id }]); if (signal.aborted || !box.isConnected) return;
        const url = URL.createObjectURL(blob); urls.push(url);
        const image = h('img'); image.src = url; image.alt = entry.caption; image.style.cssText = 'max-width:240px;max-height:240px'; box.append(image);
      })); results.append(box);
    }
  }
  async function refresh() {
    const state = await ctx.invoke<{ packs: Array<{ name: string; images: number; searchable: number }>; index: { indexed: number; compatible: boolean }; job: { state: string; error?: string; result?: unknown } }>('state');
    if (signal.aborted) return;
    status.textContent = state.packs.map(p => `${p.name}: ${p.images} / ${p.searchable} ${t('张有语义描述', 'with descriptions')}`).join('\n')
      + `\n${t('索引', 'Index')}: ${state.index.indexed} · ${state.index.compatible ? t('模型配置匹配', 'model settings match') : t('待建立索引', 'index needed')} · ${state.job.state}`;
    if (state.job.error) report.textContent = state.job.error;
  }
  actions.append(button(t('导入 AstrBot ZIP', 'Import AstrBot ZIP'), async () => {
    const path = await ctx.pickPath({ kind: 'file', extensions: ['zip'] });
    if (path) { await ctx.invoke('import', [{ path }]); await refresh(); }
  }), button(t('生成向量索引', 'Build vector index'), async () => { await ctx.invoke('build'); await refresh(); }));
  const query = h('input'); query.placeholder = t('例如：温柔安慰对方，抱抱', 'For example: comfort someone with a hug');
  actions.append(query, button(t('测试检索', 'Test retrieval'), async () => {
    const answer = await ctx.invoke<{ candidates: Entry[]; embeddingMs: number; searchMs: number; queryCached: boolean }>('search', [{ query: query.value }]);
    await show(answer.candidates); report.textContent = `Embedding ${answer.embeddingMs} ms · Search ${answer.searchMs} ms · Cache ${answer.queryCached}`;
  }));
  const browse = async () => { const page = await ctx.invoke<{ entries: Entry[]; total: number }>('list', [{ offset }]); await show(page.entries); report.textContent = `${offset + 1}–${Math.min(offset + 20, page.total)} / ${page.total}`; };
  actions.append(button(t('浏览图片', 'Browse images'), async () => { offset = 0; await browse(); }), button(t('下一页', 'Next page'), async () => { offset += 20; await browse(); }));
  root.append(h('p', t('先导入图片和语义描述，再配置服务器 embedding 地址并生成索引。查询结果只用于选图，发送仍由 QQ 工具完成。', 'Import images and semantic descriptions, configure your embedding server, then build the index. QQ tools send the selected images.')), actions, status, report, results);
  await refresh(); ctx.interval(() => { void run(refresh); }, 2500);
} } } };
