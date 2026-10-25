import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import type { LibraryState } from '../server/library.ts';
import './style.css';
export default { panels: { references: { async mount(ctx) {
  const zh = ctx.language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  let state = await ctx.invoke<LibraryState>('read'), dirty = false;
  const urls = new Set<string>();
  ctx.signal.addEventListener('abort', () => { urls.forEach(url => URL.revokeObjectURL(url)); }, { once: true });
  const root = document.createElement('div'); root.className = 'image-library';
  const help = document.createElement('p'); help.textContent = t('登记自设图、角色和其他参考信息。画 bot 自己时自动附带标记的自设；提到条目名称或别名时自动带上对应资料。保存后下一次调用生效。', 'Register character designs and other reference information. Bot portraits use entries marked as bot identity; names and aliases attach matching references. Saved changes apply to the next call.');
  const toolbar = document.createElement('div'); toolbar.className = 'image-library-actions';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const list = document.createElement('div'); list.className = 'image-library-list';
  const mark = () => { dirty = true; status.textContent = t('有未保存的修改', 'Unsaved changes'); };
  ctx.guardLeave(() => dirty ? t('有未保存的修改', 'Unsaved changes') : null);
  function button(label: string, action: () => void | Promise<void>, danger = false) {
    const b = ctx.ui.button(label, { variant: danger ? 'danger' : 'primary' }); b.type = 'button';
    b.addEventListener('click', () => { b.disabled = true; void Promise.resolve().then(action).catch(e => { status.textContent = String(e); }).finally(() => { b.disabled = false; }); }, { signal: ctx.signal });
    return b;
  }
  function render() {
    urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); list.replaceChildren();
    if (!state.entries.length) { const empty = document.createElement('p'); empty.textContent = t('暂无资料。点击「新增资料」，填写说明并上传图片。纯文字资料也可以保存。', 'No references yet. Add an entry with text and optional pictures.'); list.append(empty); }
    state.entries.forEach(entry => {
      const card = document.createElement('section'); card.className = 'image-library-card';
      const editor = document.createElement('div'), pictures = document.createElement('div'); pictures.className = 'image-library-pictures';
      const name = ctx.ui.input({ value: entry.name }); name.maxLength = 100;
      name.addEventListener('input', () => { entry.name = name.value; mark(); }, { signal: ctx.signal });
      const aliases = ctx.ui.input({ value: entry.aliases.join(', ') });
      aliases.addEventListener('input', () => { entry.aliases = aliases.value.split(/[,，]/).map(s => s.trim()).filter(Boolean); mark(); }, { signal: ctx.signal });
      const description = ctx.ui.textarea({ value: entry.description }); description.rows = 5; description.maxLength = 8000;
      description.addEventListener('input', () => { entry.description = description.value; mark(); }, { signal: ctx.signal });
      const identity = document.createElement('input'); identity.type = 'checkbox'; identity.checked = entry.botIdentity;
      identity.addEventListener('change', () => { entry.botIdentity = identity.checked; mark(); }, { signal: ctx.signal });
      const label = document.createElement('label'); label.className = 'image-library-identity'; label.append(identity, t('这是 bot 自设（画自己时附带）', 'Bot identity (include in self portraits)'));
      editor.append(ctx.ui.field(t('名称', 'Name'), name), ctx.ui.field(t('别名（逗号分隔）', 'Aliases (comma separated)'), aliases), ctx.ui.field(t('说明 / 外观 / 参考信息', 'Description / appearance / information'), description), label);
      entry.images.forEach(id => {
        const figure = document.createElement('figure'), img = document.createElement('img'); img.alt = entry.name || t('参考图', 'Reference image');
        figure.append(img, button(t('移除图片', 'Remove image'), () => { entry.images = entry.images.filter(i => i !== id); mark(); render(); }, true)); pictures.append(figure);
        void ctx.invokeBinary('image', [id]).then(blob => { if (!img.isConnected || ctx.signal.aborted) return; const url = URL.createObjectURL(blob); urls.add(url); img.src = url; }).catch(e => { status.textContent = String(e); });
      });
      const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.multiple = true; upload.hidden = true;
      upload.addEventListener('change', () => { void (async () => {
        const files = [...(upload.files ?? [])];
        if (files.length + entry.images.length > 8) throw new Error(t('每个条目最多 8 张图片', 'Up to 8 pictures per entry'));
        for (const file of files) {
          if (file.size > 6_000_000) throw new Error(t('单张图片最多 6 MB', 'Each image must be at most 6 MB'));
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
          const id = await ctx.invoke<string>('upload', [data]); if (!entry.images.includes(id)) entry.images.push(id); mark();
        }
        render();
      })().catch(e => { status.textContent = String(e); }); }, { signal: ctx.signal });
      const actions = document.createElement('div'); actions.className = 'image-library-actions';
      actions.append(upload, button(t('上传参考图', 'Upload images'), () => upload.click()), button(t('删除条目', 'Delete entry'), async () => {
        if (!await ctx.ui.confirm({ title: t('删除这个资料条目？保存后生效。', 'Delete this entry? Applies after saving.'), danger: true })) return;
        state.entries = state.entries.filter(e => e.id !== entry.id); mark(); render();
      }, true));
      editor.append(actions); card.append(editor, pictures); list.append(card);
    });
  }
  toolbar.append(button(t('新增资料', 'Add reference'), () => { state.entries.push({ id: crypto.randomUUID(), name: '', aliases: [], description: '', botIdentity: false, images: [] }); mark(); render(); }),
    button(t('保存资料', 'Save references'), async () => {
      if (!await ctx.ui.confirm({ title: t('保存参考资料？', 'Save references?') })) return;
      const disabled = ctx.ui.disable(...Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button')));
      try { state = await ctx.invoke<LibraryState>('save', [state.revision, state.entries]); dirty = false; status.textContent = t('已保存，下次调用生效', 'Saved; applies to the next call'); render(); } finally { disabled.dispose(); }
    }), button(t('重新读取', 'Reload'), async () => {
      if (dirty && !await ctx.ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved changes?') })) return;
      state = await ctx.invoke<LibraryState>('read'); dirty = false; status.textContent = ''; render();
    }));
  root.append(help, toolbar, status, list); ctx.root.append(root); render();
} } } } satisfies WebUiClientBundle;
