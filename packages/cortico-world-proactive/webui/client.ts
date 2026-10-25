import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import { strings } from '../strings.ts';
export default { panels: { status: { async mount(ctx) {
  const t = strings(ctx.language), summary = document.createElement('dl'), actions = document.createElement('div'), error = document.createElement('p');
  summary.style.cssText = 'display:grid;grid-template-columns:max-content 1fr;gap:8px 24px';
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  ctx.root.append(summary, actions, error);
  async function refresh() {
    const state = await ctx.invoke<{status: keyof typeof t;target: string;timezone: string;nextAt: number|null;unanswered:number;sentToday:number}>('state');
    summary.replaceChildren();
    for (const [label, value] of [[t.status,t[state.status]], [t.target,state.target || '—'], [t.next,state.nextAt ? new Date(state.nextAt).toLocaleString(undefined,{timeZone:state.timezone}) + ` (${state.timezone})` : '—'], [t.sent,String(state.sentToday)],[t.waiting,String(state.unanswered)]]) {
      const key = document.createElement('dt'), val = document.createElement('dd'); key.textContent=label;val.textContent=value;val.style.margin='0';summary.append(key,val);
    }
  }
  async function run(action: () => Promise<unknown>) { try { await action(); error.textContent=''; await refresh(); } catch(e) { error.textContent=String(e); } }
  for (const [label, method] of [[t.trigger,'trigger'],[t.postpone,'postpone'],[t.refresh,'state']]) {
    const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>{void run(()=>ctx.invoke(method));},{signal:ctx.signal});actions.append(button);
  }
  await run(refresh);ctx.interval(()=>{void run(refresh);},3000);
} } } } satisfies WebUiClientBundle;
