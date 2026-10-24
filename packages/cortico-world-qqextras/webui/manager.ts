import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import sharedCss from './upstream/ui.css';
import portCss from './port.css';

interface Entry { id: string; packId: string; caption: string; category: string; tags: string[]; visibleText: string; searchable: boolean; semanticError?: string; manual?: boolean }
interface Pack { id: string; name: string; revision: string; images: number; trash: number; enabled: boolean; categories: Array<{ name: string; description: string; count: number }> }
interface State {
  index: { indexed: number; valid: number; pending: number; compatible: boolean };
  semantic: { total: number; described: number; review: number; failed: number };
  job: { state: string; error?: string; result?: { path?: string }; progress?: { stage: string; done: number; total: number; failed: number; skipped: number; errors: Array<{ id: string; error: string }> } };
}
interface Settings { schema: { properties: Record<string, { type: string; title?: string; minimum?: number; maximum?: number }> }; values: Record<string, string | number | boolean>; keys: Record<string, boolean> }

export default { panels: { memes: { async mount(ctx: WebUiPanelContext) {
  const { root, signal } = ctx;
  const host = document.createElement('div'); root.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); e.textContent = text; e.className = cls; return e; };
  // Keep the embedded layout separate from the upstream full-page stylesheet.
  for (const css of [sharedCss.replaceAll(':root', ':host'), portCss]) {
    const style = h('style'); style.textContent = css; shadow.append(style);
  }
  const app = h('section', '', 'app-page meme-port'); shadow.append(app);
  const report = h('p', '', 'port-report'); report.setAttribute('role', 'status');
  const run = async (fn: () => Promise<void>) => { try { await fn(); } catch (e) { if (!signal.aborted) report.textContent = String(e); } };
  const button = (text: string, fn: () => Promise<void>, cls = 'secondary') => {
    const b = h('button', text, cls); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; void run(fn).finally(() => { b.disabled = false; }); }, { signal }); return b;
  };
  const field = (label: string, value = '', multi = false) => { const wrapper = h('label', label, 'port-field'); const input = multi ? h('textarea') : h('input'); input.value = value; input.setAttribute('aria-label', label); wrapper.append(input); return { wrapper, input }; };
  const header = h('header', '', 'page-header'); const title = h('div', '', 'page-title-block');
  title.append(h('p', 'Meme Pack Manager', 'eyebrow'), h('h1', '表情包管理'), h('p', '管理图片、整理语义、配置向量召回。', 'page-subtitle'));
  header.append(title, button('刷新', async () => { await reload(); await refreshJob(); }));
  const tabs = h('nav', '', 'port-tabs'); tabs.setAttribute('aria-label', '表情管理页签');
  const packSelect = h('select'); packSelect.setAttribute('aria-label', '当前管理包');
  const packRow = h('div', '', 'manage-pack-switch-row'); const usePack = h('input'); usePack.type = 'checkbox';
  const useLabel = h('label', '用于对话选图'); useLabel.prepend(usePack); packRow.append(h('label', '当前管理包'), packSelect, useLabel);
  const managerActions = h('div', '', 'port-actions');
  const semantic = h('section', '', 'port-semantic'); const stats = h('div', '', 'port-stats');
  const progressText = h('p'); const progress = h('progress'); progress.max = 1; progress.value = 0;
  const failures = h('details'); failures.append(h('summary', '任务详情')); const failureList = h('pre'); failures.append(failureList);
  const semanticActions = h('div', '', 'port-actions'); semantic.append(stats, semanticActions, progressText, progress, failures);
  const layout = h('div', '', 'port-layout'); const directory = h('aside', '', 'directory-panel'); const categoryList = h('div', '', 'port-categories');
  directory.append(h('h2', '分类目录'), categoryList);
  const main = h('main'); const toolbar = h('div', '', 'library-search-row'); const query = h('input'); query.type = 'search'; query.placeholder = '搜索描述、分类、标签或配字'; query.setAttribute('aria-label', query.placeholder);
  const statusFilter = h('select'); statusFilter.setAttribute('aria-label', '语义状态');
  for (const [value, label] of [['', '全部状态'], ['missing', '未生成描述'], ['review', '待人工审核'], ['error', '生成失败']]) { const o = h('option', label); o.value = value; statusFilter.append(o); }
  const count = h('span', '', 'hint'); toolbar.append(query, statusFilter, button('搜索', async () => { offset = 0; await browse(); }), count);
  const categoryActions = h('div', '', 'category-header'); const description = h('p', '', 'hint'); const batch = h('div', '', 'port-actions');
  const selectionCount = h('span'); const moveSelect = h('select'); moveSelect.setAttribute('aria-label', '移动到分类');
  const grid = h('div', '', 'port-sections'); const pager = h('div', '', 'port-pager'); main.append(toolbar, categoryActions, description, batch, grid, pager); layout.append(directory, main);
  const settingsPanel = h('section', '', 'port-settings'); const workflow = h('div', '', 'port-workflow'); const settingsBody = h('div');
  settingsPanel.append(h('h2', '设置中心 · 模式'), h('p', '向量召回 · 主模型选图', 'port-mode'), workflow,
    h('p', '主模型按表情预设判断是否配图 → 给出关键词 → 向量召回 → 在当前对话中选图或放弃 → 当前渠道发送。', 'hint'), h('p', '表情使用预设模板可在系统提示词页面编辑。当前会话和人设直接复用，无需配置参考轮数。', 'hint'), settingsBody);
  const testArea = h('section', '', 'port-retrieval'); const testReply = field('召回测试：关键词（逗号分隔）', '', true); const testOutput = h('pre');
  testArea.append(testReply.wrapper, button('测试向量召回', async () => {
    testOutput.textContent = '正在召回候选…';
    try { testOutput.textContent = JSON.stringify(await ctx.invoke('search', [{ keywords: testReply.input.value.split(/[,，、\n]+/).map(word => word.trim()).filter(Boolean) }]), null, 2); } catch (e) { testOutput.textContent = String(e); }
  }), h('p', '此处只测试候选召回；最终选图由主模型在实际对话中完成。', 'hint'), testOutput); semantic.append(testArea);
  app.append(header, tabs, report, packRow, managerActions, semantic, layout, settingsPanel);

  let packs: Pack[] = []; let packId = ''; let category = ''; let offset = 0; let trash = false; let tab = 'manage';
  let dirtySettings = false; let dirtyEditor = false; let previousJob = ''; let entries: Entry[] = []; const selected = new Set<string>();
  let generation = 0; let request = 0; let urls: string[] = []; let observer: IntersectionObserver | undefined;
  let tasks: Array<() => Promise<void>> = []; let workers = 0;
  const current = () => { const p = packs.find(p => p.id === packId); if (!p) throw new Error('请先创建或导入表情包'); return p; };
  ctx.guardLeave(() => dirtySettings || dirtyEditor ? '有尚未保存的修改，确定离开？' : null);
  const clearImages = () => { generation++; observer?.disconnect(); tasks = []; urls.forEach(URL.revokeObjectURL); urls = []; grid.replaceChildren(); };
  ctx.own({ dispose: () => { clearImages(); shadow.querySelectorAll('dialog').forEach(d => d.close()); } });
  function modal(title: string, build: (body: HTMLDivElement, close: () => void) => void) {
    const d = h('dialog', '', 'ui-dialog port-editor'); d.setAttribute('aria-label', title); const body = h('div', '', 'port-form'); const close = () => d.close();
    d.append(h('h2', title), body, button('关闭', async () => close())); d.addEventListener('close', () => { dirtyEditor = false; d.remove(); }, { once: true });
    build(body, close); app.append(d); d.showModal(); return d;
  }
  async function confirmAction(title: string, detail: string, action: () => Promise<void>) { modal(title, (body, close) => { body.append(h('p', detail), button('确认', async () => { await action(); close(); }, 'primary')); }); }
  async function edit(change: Record<string, unknown>) { const p = current(); await ctx.invoke('edit', [{ ...change, packId: p.id, revision: p.revision }]); selected.clear(); await reload(); }
  async function renamePack() { const p = current(); modal('表情包设置', (body, close) => { const name = field('名称', p.name); body.append(name.wrapper, button('保存', async () => { await edit({ kind: 'pack', name: name.input.value, enabled: p.enabled }); close(); })); }); }
  async function categoryEditor(create = false) {
    const p = current(); const cat = p.categories.find(c => c.name === category);
    modal(create ? '新建分类' : '编辑分类', (body, close) => {
      const name = field('分类名称', create ? '' : category); const desc = field('分类说明', cat?.description ?? '', true);
      body.append(name.wrapper, desc.wrapper, button('保存', async () => {
        if (create) await edit({ kind: 'createCategory', category: name.input.value, description: desc.input.value });
        else { if (name.input.value !== category) { const renamed = name.input.value; await edit({ kind: 'renameCategory', category, name: renamed }); category = renamed; } await edit({ kind: 'category', category, description: desc.input.value }); }
        close();
      }));
    });
  }
  async function editor(entry: Entry) {
    const p = current(); const revision = p.revision; const localUrls: string[] = [];
    const d = modal(trash ? '回收站图片' : '表情详情与语义编辑', (body, close) => {
      const image = h('img', '', 'port-detail-image'); image.alt = entry.caption || entry.category; body.append(image);
      void ctx.invokeBinary('image', [{ id: entry.id, trash }]).then(blob => { if (image.isConnected && !signal.aborted) { const url = URL.createObjectURL(blob); localUrls.push(url); image.src = url; } }).catch(() => { image.alt = '图片加载失败'; });
      if (trash) { body.append(h('p', entry.caption), button('恢复图片', async () => { await edit({ kind: 'restore', ids: [entry.id] }); close(); })); return; }
      const cat = field('分类', entry.category); const caption = field('语义描述', entry.caption, true); const tags = field('语义标签（逗号分隔）', entry.tags.join('，')); const visible = field('图片配字', entry.visibleText, true);
      body.append(cat.wrapper, caption.wrapper, tags.wrapper, visible.wrapper, h('p', '人工保存会标为已审核，批量语义化时保留；修改后补生成向量即可。', 'hint'));
      body.addEventListener('input', () => { dirtyEditor = true; }, { signal });
      const error = h('p'); error.setAttribute('role', 'alert'); body.append(error, button('保存并标为已审核', async () => {
        try { await ctx.invoke('edit', [{ kind: 'image', packId: p.id, revision, id: entry.id, category: cat.input.value, caption: caption.input.value, tags: tags.input.value.split(/[,，\n]/).map(t => t.trim()).filter(Boolean), visibleText: visible.input.value }]); dirtyEditor = false; close(); await reload(); await refreshJob(); }
        catch (e) { error.textContent = String(e); }
      }, 'primary'));
    }); d.addEventListener('close', () => localUrls.forEach(URL.revokeObjectURL), { once: true });
  }
  function pump() { while (workers < 4 && tasks.length) { const task = tasks.shift()!; workers++; void task().finally(() => { workers--; pump(); }); } }
  async function preview(image: HTMLImageElement, id: string, version: number) {
    try { const blob = await ctx.invokeBinary('image', [{ id, trash }]); if (version !== generation || signal.aborted || !image.isConnected) return; const url = URL.createObjectURL(blob); urls.push(url); image.src = url; }
    catch { image.alt = '图片加载失败'; }
  }
  function render(items: Entry[]) {
    clearImages(); entries = items; selected.clear(); selectionCount.textContent = '已选 0 张'; const version = generation;
    if (!items.length) { grid.append(h('p', trash ? '回收站为空' : '没有匹配的图片', 'port-empty')); return; }
    observer = new IntersectionObserver(list => { for (const item of list) if (item.isIntersecting) { observer?.unobserve(item.target); const image = item.target as HTMLImageElement; tasks.push(() => version === generation ? preview(image, image.dataset.id!, version) : Promise.resolve()); pump(); } }, { rootMargin: '160px' });
    const groups = new Map<string, HTMLDivElement>();
    for (const name of [...new Set(items.map(e => e.category))]) {
      const section = h('section', '', 'port-category-section'); const heading = h('div', '', 'port-category-heading');
      const meta = current().categories.find(c => c.name === name);
      heading.append(h('h3', name), h('span', `${meta?.count ?? items.filter(e => e.category === name).length} 张`, 'hint'));
      if (!trash) heading.append(button('编辑类别', async () => { category = name; categories(); await categoryEditor(); }), button('本类选择', async () => {
        for (const entry of items.filter(e => e.category === name)) selected.add(entry.id);
        grid.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(e => { e.checked = selected.has(e.dataset.id!); e.closest('.port-card')?.classList.toggle('selected', e.checked); });
        selectionCount.textContent = `已选 ${selected.size} 张`;
      }));
      const gallery = h('div', '', 'port-grid'); groups.set(name, gallery);
      section.append(heading, h('p', meta?.description ?? '', 'port-category-description'), gallery); grid.append(section);
    }
    for (const entry of items) {
      const card = h('article', '', 'port-card'); const check = h('input'); check.type = 'checkbox'; check.dataset.id = entry.id; check.setAttribute('aria-label', `选择 ${entry.caption || entry.category}`);
      check.addEventListener('change', () => { check.checked ? selected.add(entry.id) : selected.delete(entry.id); card.classList.toggle('selected', check.checked); selectionCount.textContent = `已选 ${selected.size} 张`; }, { signal });
      const open = button('', async () => editor(entry), 'port-image-button'); open.setAttribute('aria-label', `查看与编辑：${entry.caption || entry.category}`);
      const image = h('img'); image.alt = entry.caption || entry.category; image.dataset.id = entry.id; open.append(image);
      const state = entry.semanticError ? '生成失败' : !entry.caption ? '未生成描述' : !entry.searchable ? '待审核' : entry.manual ? '人工已审核' : '已有语义';
      card.dataset.review = entry.manual ? 'manual' : !entry.searchable ? 'pending' : 'ready';
      card.title = `${state}\n${entry.caption || entry.semanticError || '尚无描述'}\n${entry.tags.join('、')}`;
      const badge = h('span', `category:${entry.category}`, 'port-category'); badge.title = `${entry.category} · ${state}`;
      card.append(open, check, badge); groups.get(entry.category)!.append(card); observer.observe(image);
    }
    if (!trash) for (const [name, gallery] of groups) gallery.append(button('＋\n上传表情包', async () => { category = name; categories(); upload.click(); }, 'port-upload-tile'));
  }
  function categories() {
    categoryList.replaceChildren(); const p = packs.find(p => p.id === packId); if (category && !p?.categories.some(c => c.name === category)) category = '';
    for (const c of [{ name: '', count: p?.images ?? 0, description: '' }, ...(p?.categories ?? [])]) { const b = button(`${c.name || '全部图片'} · ${c.count}`, async () => { category = c.name; trash = false; offset = 0; categories(); await browse(); }, !trash && c.name === category ? 'port-category-active' : 'ghost'); b.setAttribute('aria-pressed', String(!trash && c.name === category)); categoryList.append(b); }
    categoryList.append(button(`回收站 · ${p?.trash ?? 0}`, async () => { trash = true; category = ''; offset = 0; categories(); await browse(); }, trash ? 'port-category-active' : 'ghost'));
    categoryActions.replaceChildren(h('h2', trash ? '回收站' : category || '全部图片'));
    if (category && !trash) categoryActions.append(button('编辑分类', async () => categoryEditor()), button('删除空分类', async () => confirmAction('删除分类', '仅能删除没有图片的分类。', async () => { await edit({ kind: 'deleteCategory', category }); category = ''; await reload(); })));
    description.textContent = p?.categories.find(c => c.name === category)?.description ?? '';
    moveSelect.replaceChildren(...(p?.categories ?? []).map(c => { const o = h('option', c.name); o.value = c.name; return o; })); usePack.checked = p?.enabled ?? false; usePack.disabled = !p;
  }
  async function reload() {
    packs = await ctx.invoke<Pack[]>('catalog'); if (signal.aborted) return; if (!packs.some(p => p.id === packId)) packId = packs[0]?.id ?? '';
    packSelect.replaceChildren(...packs.map(p => { const o = h('option', `${p.name} · ${p.images} 张`); o.value = p.id; return o; })); packSelect.value = packId; categories(); await browse();
  }
  async function browse(): Promise<void> {
    const serial = ++request; if (!packId) { render([]); count.textContent = '0 张'; pager.replaceChildren(); return; }
    const page = await ctx.invoke<{ entries: Entry[]; total: number }>('list', [{ packId, category, query: query.value, offset, trash, status: statusFilter.value }]); if (serial !== request || signal.aborted) return;
    if (offset && !page.entries.length && page.total <= offset) { offset = Math.max(0, Math.ceil(page.total / 24) * 24 - 24); return browse(); }
    render(page.entries); count.textContent = `${page.total} 张`; pager.replaceChildren(); const prev = button('上一页', async () => { offset = Math.max(0, offset - 24); await browse(); }); prev.disabled = !offset;
    const next = button('下一页', async () => { offset += 24; await browse(); }); next.disabled = offset + 24 >= page.total; pager.append(prev, h('span', page.total ? `${offset + 1}–${Math.min(offset + 24, page.total)} / ${page.total}` : '0 / 0'), next);
  }
  async function refreshJob() {
    const state = await ctx.invoke<State>('state'); if (signal.aborted) return; const s = state.semantic;
    stats.replaceChildren(...[[s.total, '图片'], [s.described, '已有描述'], [state.index.valid, '有效向量'], [state.index.pending, '待补向量'], [s.review, '待审核'], [s.failed, '标注失败']].map(([value, label]) => { const e = h('div'); e.append(h('strong', String(value)), h('span', String(label))); return e; }));
    const p = state.job.progress; const status = ({ running: '进行中', done: '已完成', error: '失败', cancelled: '已停止', idle: '暂无任务' } as Record<string, string>)[state.job.state];
    progressText.textContent = `${status}${p ? ` · ${p.stage} ${p.done}/${p.total} · 失败 ${p.failed} · 跳过 ${p.skipped}` : ''}`; progress.max = Math.max(1, p?.total ?? 1); progress.value = p?.done ?? 0;
    failureList.textContent = p?.errors.map(e => `${e.id}: ${e.error}`).join('\n') || '无失败记录';
    semanticActions.querySelectorAll<HTMLButtonElement>('button[data-job]').forEach(b => { b.disabled = state.job.state === 'running'; });
    if (state.job.error) report.textContent = state.job.error;
    if (previousJob === 'running' && state.job.state !== 'running') { await reload(); if (state.job.result?.path) report.textContent = `已导出：${state.job.result.path}`; } previousJob = state.job.state;
  }
  async function job(method: string, args: Record<string, unknown>) { await ctx.invoke(method, [args]); previousJob = 'running'; await refreshJob(); }
  for (const [label, method, args] of [ ['补全语义描述', 'semantic', { mode: 'missing' }], ['一键完整语义化', 'semantic', { mode: 'missing', vectors: true }], ['重试失败项', 'semantic', { mode: 'retry' }], ['仅补生成向量', 'build', {}], ['重建全部向量', 'build', { force: true }] ] as Array<[string, string, Record<string, unknown>]>) {
    const b = button(label, async () => { current(); if (args.force) await confirmAction(label, '重新计算全部表情的向量，期间旧索引继续可用。', async () => job(method, args)); else await job(method, { ...args, packId }); }); b.dataset.job = 'true'; semanticActions.append(b);
  }
  semanticActions.append(button('重新生成自动描述', async () => confirmAction('重新语义化', '重新分析当前包中的自动描述。保留人工编辑的图片，不自动重建向量。', async () => job('semantic', { packId, mode: 'force' }))), button('停止任务', async () => { await ctx.invoke('cancel'); await refreshJob(); }));
  semantic.append(h('p', '语义描述逐张保存，可停止后继续；人工修改不会被批量任务覆盖。GIF 可能仅识别首帧。', 'hint'));
  const upload = h('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/gif,image/webp'; upload.multiple = true; upload.hidden = true;
  managerActions.append(button('新建表情包', async () => { modal('新建表情包', (body, close) => { const name = field('名称'); body.append(name.wrapper, button('创建', async () => { const result = await ctx.invoke<{ id: string }>('create', [{ name: name.input.value }]); packId = result.id; close(); await reload(); })); }); }), button('包设置', renamePack), button('新建分类', async () => categoryEditor(true)),
    button('上传图片', async () => { if (!category || trash) throw new Error('请先选择一个目标分类'); upload.click(); }), upload,
    button('导入 AstrBot ZIP', async () => { const path = await ctx.pickPath({ kind: 'file', extensions: ['zip'] }); if (path) await job('import', { path }); }),
    button('导出当前包', async () => { current(); const directory = await ctx.pickPath({ kind: 'directory', title: '导出表情包到目录' }); if (directory) await job('export', { packId, directory }); }));
  upload.addEventListener('change', () => { const files = Array.from(upload.files ?? []); upload.value = ''; const target = { packId, category }; void run(async () => {
    let done = 0; const errors: string[] = []; for (const file of files) { if (signal.aborted) return;
      try { if (file.size > 25 * 1024 * 1024) throw new Error('超过 25 MiB');
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(file); });
        const catalog = await ctx.invoke<Pack[]>('catalog'); const p = catalog.find(p => p.id === target.packId); if (!p) throw new Error('目标包已不存在');
        await ctx.invoke('edit', [{ kind: 'upload', ...target, revision: p.revision, base64 }]); done++;
      } catch (e) { errors.push(`${file.name}: ${e}`); } report.textContent = `已上传 ${done}/${files.length} 张`;
    } await reload(); report.textContent = `已上传 ${done}/${files.length} 张${errors.length ? '\n' + errors.join('\n') : '，可在语义化中生成描述。'}`;
  }); }, { signal });
  batch.append(button('选择本页', async () => { entries.forEach(e => selected.add(e.id)); grid.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(e => { e.checked = true; e.closest('.port-card')?.classList.add('selected'); }); selectionCount.textContent = `已选 ${selected.size} 张`; }), selectionCount, moveSelect,
    button('移动所选', async () => { if (trash) throw new Error('请先恢复图片'); await edit({ kind: 'move', ids: [...selected], category: moveSelect.value }); }),
    button('移入回收站', async () => { if (!selected.size) throw new Error('请先选择图片'); const ids = [...selected]; await confirmAction('移入回收站', `将 ${ids.length} 张图片移入回收站，可恢复。`, async () => edit({ kind: 'trash', ids })); }),
    button('恢复所选', async () => { if (!trash) throw new Error('请先打开回收站'); await edit({ kind: 'restore', ids: [...selected] }); }));
  usePack.addEventListener('change', () => { void run(async () => { const p = current(); try { await edit({ kind: 'pack', name: p.name, enabled: usePack.checked }); } catch (e) { usePack.checked = p.enabled; throw e; } }); }, { signal });
  packSelect.addEventListener('change', () => { packId = packSelect.value; category = ''; offset = 0; trash = false; categories(); void run(browse); }, { signal });
  statusFilter.addEventListener('change', () => { offset = 0; void run(browse); }, { signal }); query.addEventListener('keydown', e => { if (e.key === 'Enter') { offset = 0; void run(browse); } }, { signal });

  async function loadSettings() {
    const settings = await ctx.invoke<Settings>('settings'); settingsBody.replaceChildren(); workflow.replaceChildren(); const inputs = new Map<string, HTMLInputElement>();
    const groups: Array<[string, string[]]> = [['配图控制', ['enabled', 'probability', 'maxMemes']], ['语义检索', ['embeddingUrl', 'embeddingModel', 'queryPrefix', 'topK', 'minScore']], ['视觉标注', ['visionUrl', 'visionModel', 'timeoutSeconds']], ['导入导出', ['pythonFile']]];
    for (const [title, keys] of groups) {
      const section = h('section', '', 'port-settings-group'); section.append(h('h3', title)); workflow.append(button(title, async () => { section.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 'ghost'));
      for (const key of keys) {
        const path = `worlds.qqextras.memes.${key}`; const schema = settings.schema.properties[path]; if (!schema) continue; const label = h('label', schema.title ?? key, 'port-field'); const input = h('input');
        input.type = schema.type === 'boolean' ? 'checkbox' : ['integer', 'number'].includes(schema.type) ? 'number' : 'text'; input.setAttribute('aria-label', schema.title ?? key);
        if (input.type === 'checkbox') input.checked = settings.values[key] === true; else input.value = String(settings.values[key] ?? '');
        if (schema.minimum !== undefined) input.min = String(schema.minimum); if (schema.maximum !== undefined) input.max = String(schema.maximum); if (schema.type === 'number') input.step = '0.01';
        input.addEventListener('input', () => { dirtySettings = true; }, { signal }); label.append(input); section.append(label); inputs.set(path, input);
      }
      const kind = title === '视觉标注' ? 'vision' : title === '语义检索' ? 'embedding' : '';
      if (kind) { const secret = h('input'); secret.type = 'password'; secret.autocomplete = 'new-password'; secret.placeholder = settings.keys[kind] ? '密钥已配置；输入新值可替换' : 'API Key（本地无鉴权服务可留空）'; secret.setAttribute('aria-label', `${title} API Key`);
        section.append(secret, button('保存密钥', async () => { await ctx.invoke('key', [{ kind, key: secret.value }]); secret.value = ''; secret.placeholder = '密钥已配置'; report.textContent = '密钥已保存'; })); }
      settingsBody.append(section);
    }
    settingsBody.append(button('保存模式设置', async () => {
      const values: Record<string, string | number | boolean> = {}; for (const [path, input] of inputs) { if (!input.checkValidity()) { input.reportValidity(); return; } values[path] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value; }
      await ctx.setConfig('world:qqextras', values); dirtySettings = false; report.textContent = '设置已保存，对下次调用生效。'; await refreshJob();
    }, 'primary'), button('重新读取设置', async () => { if (dirtySettings) await confirmAction('放弃未保存设置', '重新读取已保存的配置。', async () => { dirtySettings = false; await loadSettings(); }); else await loadSettings(); }));
  }
  async function showTab(name: string) {
    tab = name; managerActions.hidden = tab !== 'manage'; semantic.hidden = tab !== 'semantic'; layout.hidden = tab === 'settings'; packRow.hidden = tab === 'settings'; settingsPanel.hidden = tab !== 'settings';
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.tab === tab)); }); if (tab === 'settings' && !settingsBody.childElementCount) await loadSettings();
  }
  for (const [id, label] of [['manage', '表情包管理'], ['semantic', '语义化'], ['settings', '设置中心']]) { const b = button(label, async () => showTab(id)); b.dataset.tab = id; tabs.append(b); }
  await showTab('manage'); await reload(); await refreshJob(); ctx.interval(() => { void run(refreshJob); }, 2500);
} } } };
