import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import sharedCss from './upstream/ui.css';
import manageCss from './upstream/manage.css';
import portCss from './port.css';
interface Entry {
    id: string;
    packId: string;
    caption: string;
    category: string;
    tags: string[];
    visibleText: string;
}
interface Pack {
    id: string;
    name: string;
    revision: string;
    images: number;
    categories: Array<{
        name: string;
        description: string;
        count: number;
    }>;
}
export default { panels: { memes: { async mount(ctx: WebUiPanelContext) {
                const { root, signal } = ctx;
                const host = document.createElement('div');
                root.append(host);
                const shadow = host.attachShadow({ mode: 'open' });
                const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); e.textContent = text; e.className = cls; return e; };
                const style = h('style');
                style.textContent = sharedCss.replaceAll(':root', ':host') + manageCss + portCss;
                shadow.append(style);
                const app = h('section', '', 'app-page meme-port');
                shadow.append(app);
                const report = h('p', '', 'port-report');
                report.setAttribute('role', 'status');
                const run = async (fn: () => Promise<void>) => { try {
                    await fn();
                }
                catch (error) {
                    if (!signal.aborted)
                        report.textContent = String(error);
                } };
                const button = (text: string, fn: () => Promise<void>, cls = 'secondary') => { const b = h('button', text, cls); b.type = 'button'; b.addEventListener('click', () => { b.disabled = true; void run(fn).finally(() => { b.disabled = false; }); }, { signal }); return b; };
                const header = h('header', '', 'page-header');
                const title = h('div', '', 'page-title-block');
                title.append(h('p', 'Meme Pack Manager', 'eyebrow'), h('h1', '表情包管理'), h('p', '整理每一种心情，让表情随手可用。', 'page-subtitle'));
                const actions = h('div', '', 'category-actions');
                header.append(title, actions);
                const packSelect = h('select');
                packSelect.setAttribute('aria-label', '选择管理的表情包');
                const status = h('span', '', 'hint');
                const switchRow = h('div', '', 'manage-pack-switch-row');
                switchRow.append(h('label', '管理表情包'), packSelect, status);
                const layout = h('div', '', 'port-layout');
                const directory = h('aside', '', 'directory-panel');
                const categoryList = h('div', '', 'port-categories');
                directory.append(h('h2', '分类目录'), categoryList);
                const main = h('main');
                const toolbar = h('div', '', 'library-search-row');
                const query = h('input');
                query.type = 'search';
                query.placeholder = '搜索描述、分类、标签或配字';
                query.setAttribute('aria-label', query.placeholder);
                const count = h('span', '', 'hint');
                const categoryTitle = h('h2', '全部表情');
                const description = h('p', '', 'hint');
                const categoryActions = h('div', '', 'category-header');
                const grid = h('div', '', 'port-grid');
                const pager = h('div', '', 'port-pager');
                toolbar.append(query, button('搜索', async () => { offset = 0; await browse(); }), count);
                main.append(toolbar, categoryActions, description, grid, pager);
                layout.append(directory, main);
                const retrieval = h('details', '', 'port-retrieval');
                retrieval.append(h('summary', '语义检索与索引'));
                const semanticQuery = h('input');
                semanticQuery.placeholder = '例如：温柔地安慰对方';
                semanticQuery.setAttribute('aria-label', '语义检索意图');
                retrieval.append(h('p', '先在配置中填写 embedding 服务，再生成索引。编辑图片描述后需重新生成索引。'), semanticQuery, button('测试检索', async () => {
                    const r = await ctx.invoke<{
                        candidates: Entry[];
                        embeddingMs: number;
                        searchMs: number;
                        queryCached: boolean;
                    }>('search', [{ query: semanticQuery.value }]);
                    render(r.candidates);
                    count.textContent = `${r.candidates.length} 个候选`;
                    pager.replaceChildren();
                    report.textContent = `查询 ${r.embeddingMs} ms · 检索 ${r.searchMs} ms · 缓存 ${r.queryCached}`;
                }), button('生成向量索引', async () => { await ctx.invoke('build'); await refreshJob(); }));
                app.append(header, switchRow, report, layout, retrieval);
                let packs: Pack[] = [];
                let packId = '';
                let category = '';
                let offset = 0;
                let generation = 0;
                let browseRequest = 0;
                let urls: string[] = [];
                let observer: IntersectionObserver | undefined;
                let tasks: Array<() => Promise<void>> = [];
                let workers = 0;
                const pump = () => { while (workers < 4 && tasks.length) {
                    const task = tasks.shift()!;
                    workers++;
                    void task().finally(() => { workers--; pump(); });
                } };
                const clear = () => { generation++; observer?.disconnect(); tasks = []; urls.forEach(URL.revokeObjectURL); urls = []; grid.replaceChildren(); };
                ctx.own({ dispose: () => { clear(); shadow.querySelectorAll('dialog').forEach(d => d.close()); } });
                async function preview(image: HTMLImageElement, id: string, version: number) { try {
                    const blob = await ctx.invokeBinary('image', [{ id }]);
                    if (signal.aborted || version !== generation || !image.isConnected)
                        return;
                    const url = URL.createObjectURL(blob);
                    urls.push(url);
                    image.src = url;
                }
                catch {
                    image.alt = '图片加载失败，点击详情重试';
                } }
                const field = (label: string, value: string, multi = false) => { const wrapper = h('label', label, 'port-field'); const input = multi ? h('textarea') : h('input'); input.value = value; input.setAttribute('aria-label', label); wrapper.append(input); return { wrapper, input }; };
                async function editor(entry?: Entry) {
                    const selected = packs.find(p => p.id === (entry?.packId ?? entry?.id.split(':')[0] ?? packId));
                    if (!selected)
                        throw new Error('请先选择资源包');
                    const revision = selected.revision;
                    const dialog = h('dialog', '', 'ui-dialog port-editor');
                    dialog.setAttribute('aria-label', entry ? '表情详情与语义编辑' : '编辑分类说明');
                    const heading = h('div', '', 'category-header');
                    heading.append(h('h2', entry ? '表情详情与语义编辑' : '编辑分类说明'), button('关闭', async () => { dialog.close(); }));
                    dialog.append(heading);
                    const form = h('div', '', 'port-form');
                    dialog.append(form);
                    const localUrls: string[] = [];
                    dialog.addEventListener('close', () => { localUrls.forEach(URL.revokeObjectURL); dialog.remove(); }, { once: true });
                    let save: () => Promise<void>;
                    if (entry) {
                        const image = h('img', '', 'port-detail-image');
                        image.alt = entry.caption;
                        form.append(image);
                        void ctx.invokeBinary('image', [{ id: entry.id }]).then(blob => { if (dialog.isConnected && !signal.aborted) {
                            const url = URL.createObjectURL(blob);
                            localUrls.push(url);
                            image.src = url;
                        } }).catch(() => { image.alt = '图片加载失败'; });
                        const cat = field('分类', entry.category);
                        const caption = field('语义描述', entry.caption, true);
                        const tags = field('语义标签（逗号分隔）', entry.tags.join('，'));
                        const visible = field('图片配字', entry.visibleText, true);
                        form.append(cat.wrapper, caption.wrapper, tags.wrapper, visible.wrapper);
                        save = async () => { await ctx.invoke('edit', [{ kind: 'image', packId: selected.id, revision, id: entry.id, category: cat.input.value, caption: caption.input.value, visibleText: visible.input.value, tags: tags.input.value.split(/[,，\n]/).map(t => t.trim()).filter(Boolean) }]); };
                    }
                    else {
                        const current = selected.categories.find(c => c.name === category);
                        if (!current)
                            throw new Error('请选择分类');
                        const desc = field('分类说明', current.description, true);
                        form.append(h('h3', current.name), desc.wrapper);
                        save = async () => { await ctx.invoke('edit', [{ kind: 'category', packId, revision, category, description: desc.input.value }]); };
                    }
                    const errorLine = h('p');
                    errorLine.setAttribute('role', 'alert');
                    dialog.append(h('p', '保存后保留原图片。修改过的条目需重新建立索引。', 'hint'), errorLine, button('保存修改', async () => { try {
                        await save();
                        dialog.close();
                        await reloadCatalog();
                        await browse();
                        report.textContent = '已保存。重建索引后，修改的条目将重新参与语义检索。';
                    }
                    catch (error) {
                        errorLine.textContent = String(error);
                    } }, 'primary'));
                    app.append(dialog);
                    dialog.showModal();
                }
                function render(entries: Entry[]) {
                    clear();
                    const version = generation;
                    if (!entries.length) {
                        grid.append(h('p', '没有匹配的表情。请切换分类、清空搜索，或导入资源包。', 'port-empty'));
                        return;
                    }
                    observer = new IntersectionObserver(items => { for (const item of items)
                        if (item.isIntersecting) {
                            observer?.unobserve(item.target);
                            const image = item.target as HTMLImageElement;
                            tasks.push(() => version === generation ? preview(image, image.dataset.memeId!, version) : Promise.resolve());
                            pump();
                        } }, { rootMargin: '160px' });
                    for (const entry of entries) {
                        const card = h('article', '', 'emoji-item port-card');
                        const open = button('查看与编辑', async () => { await editor(entry); }, 'port-image-button');
                        const image = h('img');
                        image.alt = entry.caption || entry.category;
                        image.dataset.memeId = entry.id;
                        open.prepend(image);
                        const text = h('p', entry.caption || '尚无语义描述', 'port-caption');
                        text.title = entry.caption;
                        const tags = h('div', '', 'port-tags');
                        entry.tags.slice(0, 4).forEach(tag => tags.append(h('span', tag)));
                        card.append(open, h('span', entry.category, 'port-category'), text, tags);
                        grid.append(card);
                        observer.observe(image);
                    }
                }
                function categories() { categoryList.replaceChildren(); const selected = packs.find(p => p.id === packId); for (const cat of [{ name: '', count: selected?.images ?? 0, description: '' }, ...(selected?.categories ?? [])]) {
                    const b = button(`${cat.name || '全部表情'} · ${cat.count}`, async () => { category = cat.name; offset = 0; categories(); await browse(); }, cat.name === category ? 'port-category-active' : 'ghost');
                    b.setAttribute('aria-pressed', String(cat.name === category));
                    categoryList.append(b);
                } categoryTitle.textContent = category || '全部表情'; description.textContent = selected?.categories.find(c => c.name === category)?.description ?? ''; categoryActions.replaceChildren(categoryTitle); if (category)
                    categoryActions.append(button('编辑分类说明', async () => { await editor(); })); }
                async function reloadCatalog() { packs = await ctx.invoke<Pack[]>('catalog'); if (signal.aborted)
                    return; if (!packs.some(p => p.id === packId))
                    packId = packs[0]?.id ?? ''; packSelect.replaceChildren(...packs.map(p => { const option = h('option', `${p.name} · ${p.images} 张`); option.value = p.id; return option; })); packSelect.value = packId; categories(); }
                async function browse() { const request = ++browseRequest; const page = await ctx.invoke<{
                    entries: Entry[];
                    total: number;
                }>('list', [{ packId, category, query: query.value, offset }]); if (signal.aborted || request !== browseRequest)
                    return; render(page.entries); count.textContent = `${page.total} 张`; pager.replaceChildren(); const prev = button('上一页', async () => { offset = Math.max(0, offset - 24); await browse(); }); prev.disabled = offset === 0; const next = button('下一页', async () => { offset += 24; await browse(); }); next.disabled = offset + 24 >= page.total; pager.append(prev, h('span', page.total ? `${offset + 1}–${Math.min(offset + 24, page.total)} / ${page.total}` : '0 / 0'), next); }
                let previousJob = '';
                async function refreshJob() { const state = await ctx.invoke<{
                    index: {
                        indexed: number;
                        compatible: boolean;
                    };
                    job: {
                        state: string;
                        error?: string;
                    };
                }>('state'); if (signal.aborted)
                    return; status.textContent = `索引 ${state.index.indexed} 张 · ${state.index.compatible ? '模型配置匹配' : '待建立索引'}${state.job.state === 'running' ? ' · 正在处理…' : ''}`; if (state.job.error)
                    report.textContent = state.job.error; if (previousJob === 'running' && state.job.state === 'done') {
                    await reloadCatalog();
                    await browse();
                } previousJob = state.job.state; }
                actions.append(button('导入表情包 ZIP', async () => { const path = await ctx.pickPath({ kind: 'file', extensions: ['zip'] }); if (path) {
                    await ctx.invoke('import', [{ path }]);
                    await refreshJob();
                } }), button('刷新', async () => { await reloadCatalog(); await browse(); await refreshJob(); }));
                packSelect.addEventListener('change', () => { packId = packSelect.value; category = ''; offset = 0; categories(); void run(browse); }, { signal });
                query.addEventListener('keydown', event => { if (event.key === 'Enter') {
                    offset = 0;
                    void run(browse);
                } }, { signal });
                await reloadCatalog();
                await browse();
                await refreshJob();
                ctx.interval(() => { void run(refreshJob); }, 3000);
            } } } };
