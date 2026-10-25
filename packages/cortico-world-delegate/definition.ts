import { describeTools,type WorldDefinition } from 'cortico/world.ts';
import { DELEGATE_DEFAULTS,type DelegateConfigSection } from './config.ts';
import { DELEGATE_TOOL_DECLS,DelegateWorld } from './world.ts';
export const DELEGATE:WorldDefinition<DelegateConfigSection>={
  id:'delegate',label:'Codex 委派',defaults:()=>structuredClone(DELEGATE_DEFAULTS),create:ctx=>new DelegateWorld(ctx),
  describe:{tools:describeTools(DELEGATE_TOOL_DECLS,{}),events:[{type:'delegate.completed',trigger:'debounce',description:{zh:'后台 Codex 任务结果，交回当前上下文。',en:'Return a background Codex task result to the current context.'}}]},
};
