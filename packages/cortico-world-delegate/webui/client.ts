import type { WebUiClientBundle } from 'cortico/web/shared/client-panel.ts';
import type { Job } from '../server/jobs.ts';
import { strings } from '../strings.ts';
export default {panels:{jobs:{async mount(ctx){
  const t=strings(ctx.language),list=document.createElement('div'),error=document.createElement('p'),refresh=document.createElement('button');
  refresh.textContent=t.refresh;ctx.root.append(refresh,error,list);
  async function load(){
    try{
      const state=await ctx.invoke<{jobs:Job[]}>('state');list.replaceChildren();error.textContent='';
      if(!state.jobs.length){list.textContent=t.empty;return;}
      for(const job of state.jobs){
        const card=document.createElement('section'),heading=document.createElement('h3'),task=document.createElement('p'),path=document.createElement('code');
        card.style.cssText='padding:12px 0;border-bottom:1px solid #8884';heading.textContent=`#${job.id} · ${t[job.status]} · QQ ${job.user}`;task.textContent=job.task;path.textContent=job.workspace;
        card.append(heading,task,path);
        if(job.result){const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';pre.textContent=job.result;card.append(pre);}
        if(job.status==='queued'||job.status==='running'){
          const cancel=document.createElement('button');cancel.textContent=t.cancel;
          cancel.addEventListener('click',()=>{void ctx.invoke('cancel',[job.id]).then(load).catch(e=>{error.textContent=String(e);});},{signal:ctx.signal});card.append(cancel);
        }
        list.append(card);
      }
    }catch(e){error.textContent=String(e);}
  }
  refresh.addEventListener('click',()=>{void load();},{signal:ctx.signal});await load();ctx.interval(()=>{void load();},2000);
}}}} satisfies WebUiClientBundle;
