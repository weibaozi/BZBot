import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

interface State {
  signedIn: boolean; email?: string; pending: boolean; editing: boolean; error?: string; needsWelcome: boolean;
  spec?: { model: string; reasoningEffort?: string; thinking: boolean; contextWindow?: number }; images: boolean;
}
export default { panels: { account: { async mount(ctx: WebUiPanelContext) {
  const { ui, root, signal } = ctx;
  const zh = ctx.language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const name = ctx.scope.instance;
  const invoke = <T>(method: string) => ctx.invoke<T>(method, [{ name }]);
  const note = ui.msgline();
  const account = ui.msgline();
  const report = ui.msgline();
  const actions = ui.rowbar();
  const loginLink = ui.h('a'); loginLink.textContent = t('打开 ChatGPT 授权页', 'Open ChatGPT authorization');
  loginLink.target = '_blank'; loginLink.rel = 'noopener noreferrer'; loginLink.hidden = true;
  const usage = ui.h('a'); usage.href = 'https://chatgpt.com/#settings/Usage'; usage.target = '_blank'; usage.rel = 'noopener noreferrer';
  usage.textContent = t('在 ChatGPT 中管理用量与授权', 'Manage usage and access in ChatGPT');
  const call = async (fn: () => Promise<void>) => { try { report.textContent = ''; await fn(); } catch (error) { report.textContent = String(error); } };
  let state = await invoke<State>('state');
  const write = async (path: string, value: string | number | boolean) => { await ctx.setConfig('chatgpt', { [`providers.${name}.${path}`]: value }); };
  if (!state.spec?.model) await write('spec.model', '__login_required__');
  const login = ui.button('Continue with ChatGPT', { onClick: () => call(async () => {
    const result = await invoke<{ url: string }>('login');
    loginLink.href = result.url; loginLink.hidden = false;
    await refresh();
  }) });
  const cancel = ui.button(t('取消登录', 'Cancel sign-in'), { onClick: () => call(async () => { await invoke('cancel'); loginLink.hidden = true; await refresh(); }) });
  const logout = ui.button(t('退出登录', 'Sign out'), { onClick: () => call(async () => {
    const result = await invoke<{ revoked: boolean }>('logout'); await refresh();
    report.textContent = result.revoked ? t('已退出登录', 'Signed out') : t('本地已退出；远程撤销未确认，请在 ChatGPT 设置中断开应用。', 'Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT settings.');
  }) });
  actions.append(login, cancel, logout, loginLink);
  const model = ui.select({ options: [{ value: state.spec?.model ?? '__login_required__', label: state.spec?.model && state.spec.model !== '__login_required__' ? state.spec.model : t('登录后选择模型', 'Sign in to select a model') }],
    onChange: value => call(async () => { await write('spec.model', value); }) });
  const loadModels = ui.button(t('获取账号模型', 'Load account models'), { onClick: () => call(async () => {
    const models = await invoke<Array<{ id: string; displayName?: string }>>('models');
    const selected = model.value;
    model.replaceChildren(...[{ id: '', displayName: t('请选择模型', 'Select a model') }, ...models].map(row => {
      const option = ui.h('option'); option.value = row.id; option.textContent = row.displayName ?? row.id; return option;
    }));
    model.value = models.some(row => row.id === selected) ? selected : '';
  }) });
  const effort = ui.input({ value: state.spec?.thinking === false ? 'none' : state.spec?.reasoningEffort ?? '' });
  effort.placeholder = t('模型默认；或填写该模型支持的强度', 'Model default, or an effort supported by the model');
  effort.addEventListener('change', () => void call(async () => {
    await write('spec.thinking', effort.value.trim() !== 'none');
    await write('spec.reasoningEffort', effort.value.trim() === 'none' ? '' : effort.value.trim());
  }), { signal });
  const context = ui.input({ value: String(state.spec?.contextWindow ?? 1_000_000) }); context.type = 'number'; context.min = '1'; context.step = '1';
  const images = ui.checkbox(t('允许图片输入（需模型支持）', 'Allow image input (model support required)'), {
    checked: state.images, onChange: checked => void call(async () => { await write('multimodal', checked); }),
  });
  context.addEventListener('change', () => void call(async () => {
    const value = Number(context.value); if (!Number.isSafeInteger(value) || value < 1) throw new Error(t('上下文必须为正整数', 'Context must be a positive integer'));
    await write('spec.contextWindow', value);
  }), { signal });
  root.append(note, account, actions, usage, ui.field(t('模型', 'Model'), model), loadModels,
    ui.field(t('推理强度', 'Reasoning effort'), effort), ui.field(t('本地上下文上限', 'Local context limit'), context),
    images.el,
    ui.msgline(t('温度和服务端输出上限由模型决定，此接入不发送这两个参数。上下文仍受所选模型限制。', 'Temperature and the server output limit use model defaults. The selected model still limits context capacity.')), report);
  let welcoming = false;
  async function refresh() {
    state = await invoke<State>('state');
    note.textContent = state.editing ? t('先保存配置，再完成登录。登录需在运行 myBot 的这台电脑上打开授权页。', 'Save the configuration first. Open the authorization page on the computer running myBot.') : '';
    account.textContent = state.signedIn ? t(`正在使用 ChatGPT 套餐 · ${state.email ?? ''}`, `Using ChatGPT plan · ${state.email ?? ''}`)
      : state.pending ? t('等待浏览器授权', 'Waiting for browser authorization') : t('尚未登录 ChatGPT', 'Not signed in to ChatGPT');
    login.disabled = state.editing || state.pending; cancel.hidden = !state.pending;
    logout.disabled = state.editing || !state.signedIn; loadModels.disabled = state.editing || !state.signedIn;
    if (!state.pending) loginLink.hidden = true;
    if (state.error) report.textContent = state.error;
    if (state.signedIn && state.needsWelcome && !state.editing && !welcoming) {
      welcoming = true;
      try {
        await ui.confirm({ title: t('正在使用你的 ChatGPT 套餐', 'You’re using your ChatGPT plan'),
          body: t('myBot 的模型请求将使用你的 ChatGPT 套餐额度或点数。你可以在 ChatGPT 设置中管理用量和应用授权。', 'Eligible myBot requests use your ChatGPT plan or credits. Manage usage and app access in ChatGPT settings.') });
        await invoke('welcome');
      } finally { welcoming = false; }
    }
  }
  await refresh();
  ctx.interval(() => { if (state.pending) void call(refresh); }, 1500);
} } } };
