import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
interface State { signedIn: boolean; pending: boolean; editing: boolean; email?: string; error?: string; controllerModel: string }
export default { panels: { account: { async mount(ctx: WebUiPanelContext) {
  const { ui, root, signal } = ctx; const zh = ctx.language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const name = ctx.scope.instance;
  const invoke = <T>(method: string) => ctx.invoke<T>(method, [{ name }]);
  const status = ui.msgline(), error = ui.msgline();
  const link = ui.h('a'); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = true;
  link.textContent = t('打开授权页面', 'Open authorization page');
  const call = async (fn: () => Promise<void>) => { try { error.textContent = ''; await fn(); } catch (e) { error.textContent = String(e); } };
  const login = ui.button(t('登录 Codex', 'Sign in with Codex'), { variant: 'primary', onClick: () => {
    // Open synchronously on the click so popup blocking cannot discard the authorization page.
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
    void call(async () => {
      try { const result = await invoke<{ url: string }>('login'); link.href = result.url; link.hidden = false;
        if (popup) popup.location.href = result.url; await refresh();
      } catch (e) { popup?.close(); throw e; }
    });
  } });
  const cancel = ui.button(t('取消登录', 'Cancel sign-in'), { onClick: () => call(async () => { await invoke('cancel'); link.hidden = true; await refresh(); }) });
  const logout = ui.button(t('退出登录', 'Sign out'), { onClick: () => call(async () => {
    await ui.confirm({ title: t('退出 Codex', 'Sign out of Codex'), body: t('删除此供应商的本地授权；其他 Codex 应用不受影响。', 'Remove this provider’s local authorization. Other Codex apps are unaffected.') });
    await invoke('logout'); await refresh();
  }) });
  const actions = ui.rowbar(); actions.append(login, cancel, logout, link);
  let state = await invoke<State>('state');
  const controller = ui.input({ value: state.controllerModel });
  controller.addEventListener('change', () => void call(async () => {
    if (!controller.value.trim()) throw new Error(t('请输入主控模型名称', 'Enter a controller model'));
    await ctx.setConfig('codex', { [`providers.${name}.options.imageControllerModel`]: controller.value.trim() });
  }), { signal });
  root.append(status, actions,
    ui.msgline(t('在运行 myBot 的电脑上打开此管理页。授权后自动接收 localhost:1455 回调，不需要往 QQ 发链接。', 'Open this page on the myBot computer. Authorization returns to localhost:1455 automatically; no chat commands are needed.')),
    ui.field(t('生图主控模型', 'Image controller model'), controller),
    ui.msgline(t('生图页选择图片模型；这里选择调用图片工具的对话模型。模型列表是候选目录，账号能力以实际请求为准。', 'Choose the image model in the Image generation tab. This field selects the chat model that invokes the image tool. Catalog entries do not guarantee account access.')), error);
  async function refresh() {
    state = await invoke<State>('state');
    status.textContent = state.signedIn ? t(`已登录 ${state.email ?? ''}`, `Signed in ${state.email ?? ''}`) : state.pending ? t('等待浏览器授权', 'Waiting for browser authorization') : t('尚未登录', 'Not signed in');
    login.disabled = state.editing || state.pending; cancel.hidden = !state.pending; logout.disabled = !state.signedIn || state.editing;
    if (state.error) error.textContent = state.error;
    if (state.signedIn && !state.pending) link.hidden = true;
  }
  await refresh(); ctx.interval(() => { if (state.pending) void call(refresh); }, 1500);
} } } };
