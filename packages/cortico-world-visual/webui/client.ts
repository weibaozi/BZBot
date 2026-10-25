import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import type { LibraryState, VisualEntry } from '../server/library.ts';
import './style.css';
type Loaded = LibraryState & { dir: string };
export default { panels: { library: { async mount(ctx) {
  const zh = ctx.language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  let state = await ctx.invoke<Loaded>('read'), dirty = false;
  // 读进来的条目 id 不能改：id 就是文件夹名，改名会丢掉已有图片。
  let saved = new Set(state.entries.map(e => e.id));
  const urls = new Set<string>();
  ctx.signal.addEventListener('abort', () => { urls.forEach(url => URL.revokeObjectURL(url)); }, { once: true });
  const root = document.createElement('div'); root.className = 'image-library';
  const help = document.createElement('p');
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
  function text(value: string, set: (v: string) => void, max: number) {
    const input = ctx.ui.input({ value }); input.maxLength = max;
    input.addEventListener('input', () => { set(input.value); mark(); }, { signal: ctx.signal });
    return input;
  }
  function render() {
    help.textContent = t(`资料存在 ${state.dir}，一个条目一个文件夹，文件夹名就是 id。她自己用 id「self」。画图时她自己挑图，把 mem:visual/<id>/<文件名> 交给生图工具，工具附上条目的说明。改完要重载前缀，她才看得到新的条目列表。`,
      `Stored in ${state.dir}, one folder per entry; the folder name is the id. Use "self" for the bot itself. Reload the prefix after changes so the persona sees the new list.`);
    urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); list.replaceChildren();
    if (!state.entries.length) { const empty = document.createElement('p'); empty.textContent = t('还没有资料。点「新增资料」，先填 id（她自己填 self），再上传图片。', 'No entries yet. Add one, set its id (self for the bot), then upload pictures.'); list.append(empty); }
    state.entries.forEach(entry => {
      const card = document.createElement('section'); card.className = 'image-library-card';
      const editor = document.createElement('div'), pictures = document.createElement('div'); pictures.className = 'image-library-pictures';
      const id = text(entry.id, v => { entry.id = v.trim(); }, 60);
      id.readOnly = saved.has(entry.id) || entry.images.length > 0;
      editor.append(
        ctx.ui.field(t('id（文件夹名）', 'Id (folder name)'), id),
        ctx.ui.field(t('名称', 'Name'), text(entry.name, v => { entry.name = v; }, 100)),
        ctx.ui.field(t('别名（逗号分隔）', 'Aliases (comma separated)'), text(entry.aliases.join(', '), v => { entry.aliases = v.split(/[,，]/).map(s => s.trim()).filter(Boolean); }, 2000)),
        ctx.ui.field(t('主人 QQ（可空）', 'Owner QQ (optional)'), text(entry.owner, v => { entry.owner = v.trim(); }, 20)),
        ctx.ui.field(t('来源（private / group:群号，可空）', 'Source (private / group:<id>, optional)'), text(entry.source, v => { entry.source = v.trim(); }, 30)),
      );
      const description = ctx.ui.textarea({ value: entry.description }); description.rows = 5; description.maxLength = 8000;
      description.addEventListener('input', () => { entry.description = description.value; mark(); }, { signal: ctx.signal });
      editor.append(ctx.ui.field(t('说明 / 外观（会交给生图模型）', 'Description / appearance (sent to the image model)'), description));
      entry.images.forEach(file => {
        const figure = document.createElement('figure'), img = document.createElement('img'); img.alt = `${entry.name || entry.id} · ${file}`;
        const caption = document.createElement('figcaption'); caption.textContent = file;
        figure.append(img, caption, button(t('移除图片', 'Remove image'), () => { entry.images = entry.images.filter(i => i !== file); mark(); render(); }, true)); pictures.append(figure);
        void ctx.invokeBinary('image', [entry.id, file]).then(blob => { if (!img.isConnected || ctx.signal.aborted) return; const url = URL.createObjectURL(blob); urls.add(url); img.src = url; }).catch(e => { status.textContent = String(e); });
      });
      const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp'; upload.multiple = true; upload.hidden = true;
      upload.addEventListener('change', () => { void (async () => {
        const files = [...(upload.files ?? [])];
        if (files.length + entry.images.length > 8) throw new Error(t('每个条目最多 8 张图片', 'Up to 8 pictures per entry'));
        for (const file of files) {
          if (file.size > 6_000_000) throw new Error(t('单张图片最多 6 MB', 'Each image must be at most 6 MB'));
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
          const result = await ctx.invoke<{ file: string; revision: string }>('upload', [state.revision, entry.id, data, file.name]);
          state.revision = result.revision;
          if (!entry.images.includes(result.file)) entry.images.push(result.file); mark();
        }
        render();
      })().catch(e => { status.textContent = String(e); }); }, { signal: ctx.signal });
      const actions = document.createElement('div'); actions.className = 'image-library-actions';
      actions.append(upload, button(t('上传图片', 'Upload images'), () => {
        if (!entry.id) throw new Error(t('先填 id', 'Set the id first'));
        upload.click();
      }), button(t('删除条目', 'Delete entry'), async () => {
        if (!await ctx.ui.confirm({ title: t('删除这个条目和它的图片？保存后生效，记忆的 git 历史里还能找回。', 'Delete this entry and its pictures? Applies after saving; the memory git history keeps a copy.'), danger: true })) return;
        state.entries = state.entries.filter(e => e !== entry); mark(); render();
      }, true));
      editor.append(actions); card.append(editor, pictures); list.append(card);
    });
  }
  const blank = (): VisualEntry => ({ id: state.entries.some(e => e.id === 'self') ? '' : 'self', name: '', aliases: [], owner: '', source: '', description: '', images: [] });
  toolbar.append(button(t('新增资料', 'Add entry'), () => { state.entries.push(blank()); mark(); render(); }),
    button(t('保存资料', 'Save'), async () => {
      if (!await ctx.ui.confirm({ title: t('保存图像资料？', 'Save the visual library?') })) return;
      const disabled = ctx.ui.disable(...Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>('input,textarea,button')));
      try {
        const next = await ctx.invoke<LibraryState>('save', [state.revision, state.entries]);
        state = { ...next, dir: state.dir }; saved = new Set(state.entries.map(e => e.id)); dirty = false;
        status.textContent = t('已保存。生图马上用新资料；重载前缀后她才看到新的条目列表。', 'Saved. Reload the prefix so the persona sees the new list.'); render();
      } finally { disabled.dispose(); }
    }), button(t('重新读取', 'Reload'), async () => {
      if (dirty && !await ctx.ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved changes?') })) return;
      state = await ctx.invoke<Loaded>('read'); saved = new Set(state.entries.map(e => e.id)); dirty = false; status.textContent = ''; render();
    }));
  root.append(help, toolbar, status, list); ctx.root.append(root); render();
} } } } satisfies WebUiClientBundle;
