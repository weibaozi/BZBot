import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import type { PolicyState } from '../server/layers.ts';
import './style.css';

export default { panels: { layers: { async mount(ctx) {
  const zh = ctx.language.startsWith('zh');
  const words = zh ? {
    add: '新增一层', save: '保存规则', reload: '重新读取', title: '层名称', enabled: '启用',
    up: '上移', down: '下移', remove: '删除', preview: '合并预览（按上到下顺序）',
    help: '启用且非空的层按顺序放在系统前缀最前面。聊天和梦境没有编辑工具。保存后，下次交接或手动重载前缀时生效；手动重载会损失一次缓存。',
    saved: '已保存。等待下次交接或到系统提示词页重载前缀后生效。', dirty: '有未保存的规则。',
    confirm: '保存这些底层规则？', empty: '暂无规则，点击“新增一层”开始。',
    reloadConfirm: '放弃未保存的修改并重新读取？', deleteConfirm: '删除这一层？', newTitle: '新规则层',
  } : {
    add: 'Add layer', save: 'Save rules', reload: 'Reload', title: 'Layer title', enabled: 'Enabled',
    up: 'Move up', down: 'Move down', remove: 'Delete', preview: 'Merged preview (top to bottom)',
    help: 'Enabled, nonempty layers precede the Persona system prefix. Chat and dream have no editing tools. Saved rules apply at the next handoff or manual prefix reload; reloading loses one cache hit.',
    saved: 'Saved. Apply at the next handoff or reload the prefix on the system prompts page.', dirty: 'Rules have unsaved changes.',
    confirm: 'Save these base rules?', empty: 'No rules. Add a layer to begin.',
    reloadConfirm: 'Discard edits and reload?', deleteConfirm: 'Delete this layer?', newTitle: 'New rule layer',
  };
  let state: PolicyState = await ctx.invoke('read');
  let dirty = false;
  const help = document.createElement('p'), toolbar = document.createElement('div'), list = document.createElement('div');
  const status = document.createElement('p'), previewTitle = document.createElement('h3'), preview = document.createElement('pre');
  help.textContent = words.help; help.className = 'policy-help';
  toolbar.className = 'policy-toolbar';
  list.className = 'policy-layers';
  preview.className = 'policy-preview';
  previewTitle.textContent = words.preview;
  status.setAttribute('role', 'status');
  const manager = document.createElement('div'); manager.className = 'policy-manager';
  manager.append(help, toolbar, status, list, previewTitle, preview); ctx.root.append(manager);
  ctx.guardLeave(() => dirty ? words.dirty : null);
  function updatePreview() {
    preview.textContent = state.layers.filter(layer => layer.enabled && layer.text.trim()).map(layer => layer.text + '\n\n').join('');
  }
  function changed() { dirty = true; status.textContent = words.dirty; updatePreview(); }
  function button(label: string, action: () => void | Promise<void>, variant: 'plain' | 'primary' | 'danger' = 'plain') {
    const el = ctx.ui.button(label, { variant }); el.type = 'button';
    el.addEventListener('click', () => { void Promise.resolve().then(action).catch(error => { status.textContent = String(error); }); }, { signal: ctx.signal });
    return el;
  }
  function render() {
    list.replaceChildren();
    if (!state.layers.length) { const empty = document.createElement('p'); empty.textContent = words.empty; list.append(empty); }
    state.layers.forEach((layer, index) => {
      const card = document.createElement('fieldset'), legend = document.createElement('legend');
      legend.textContent = `${index + 1}. ${layer.title}`;
      card.className = 'policy-layer';
      const row = document.createElement('div'); row.className = 'policy-layer-actions';
      const title = ctx.ui.input({ value: layer.title }); title.setAttribute('aria-label', words.title); title.maxLength = 200;
      title.addEventListener('input', () => { layer.title = title.value; legend.textContent = `${index + 1}. ${layer.title}`; changed(); }, { signal: ctx.signal });
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = layer.enabled;
      const enabledLabel = document.createElement('label'); enabledLabel.append(enabled, words.enabled);
      enabled.addEventListener('change', () => { layer.enabled = enabled.checked; changed(); }, { signal: ctx.signal });
      const move = (delta: number) => {
        const target = index + delta;
        [state.layers[index], state.layers[target]] = [state.layers[target], state.layers[index]];
        changed(); render();
      };
      const up = button(words.up, () => move(-1)), down = button(words.down, () => move(1));
      up.disabled = index === 0; down.disabled = index === state.layers.length - 1;
      const titleLabel = ctx.ui.field(words.title, title); titleLabel.classList.add('policy-title');
      enabledLabel.className = 'policy-enabled';
      row.append(enabledLabel, up, down, button(words.remove, async () => {
        if (!await ctx.ui.confirm({ title: words.deleteConfirm, danger: true })) return;
        state.layers.splice(index, 1); changed(); render();
      }, 'danger'));
      const content = ctx.ui.textarea({ value: layer.text }); content.rows = 8;
      content.setAttribute('aria-label', zh ? '规则正文' : 'Rule text'); content.classList.add('policy-content');
      content.addEventListener('input', () => { layer.text = content.value; changed(); }, { signal: ctx.signal });
      card.append(legend, titleLabel, row, ctx.ui.field(zh ? '规则正文' : 'Rule text', content)); list.append(card);
    });
    updatePreview();
  }
  const add = button(words.add, () => { state.layers.push({ id: crypto.randomUUID(), title: words.newTitle, enabled: true, text: '' }); changed(); render(); list.querySelector<HTMLInputElement>('fieldset:last-child input')?.focus(); }, 'primary');
  const save = button(words.save, async () => {
    if (!await ctx.ui.confirm({ title: words.confirm, body: words.help })) return;
    const controls = [...ctx.root.querySelectorAll('input,textarea,button')] as Array<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>;
    const disabled = ctx.ui.disable(...controls);
    try {
      state = await ctx.invoke<PolicyState>('save', [state.revision, state.layers]); dirty = false;
      status.textContent = words.saved; render(); await ctx.refresh();
    } finally { disabled.dispose(); }
  });
  const reload = button(words.reload, async () => {
    if (dirty && !await ctx.ui.confirm({ title: words.reloadConfirm })) return;
    state = await ctx.invoke('read'); dirty = false; status.textContent = ''; render();
  });
  toolbar.append(add, save, reload); render();
} } } } satisfies WebUiClientBundle;
