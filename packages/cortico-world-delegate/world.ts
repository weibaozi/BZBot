import { existsSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef,ToolCallContext,World,WorldHost } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext } from 'cortico/world.ts';
import { registerDeliveryHint } from 'cortico/worlds/delivery-hints.ts';
import { allowedUsers,delegateConfigGroup,type DelegateConfigSection } from './config.ts';
import { requestGrant,type RequestGrant } from './server/authorization.ts';
import { Jobs,type Job } from './server/jobs.ts';
import { CodexRunner,codexExecutable,taskWorkspace,writableDirectories } from './server/runner.ts';
import { strings } from './strings.ts';

export const DELEGATE_TOOL_DECLS:Array<Omit<ToolDef,'handler'>>=[
  {name:'delegate',tags:['write'],description:'Queue a local Codex task requested by the current allowlisted private user. Returns a task number immediately; completion arrives later as an event. Work is isolated in a new task directory. One task per user message. Do not use for routine chat or tasks your existing tools can handle.',
    parameters:{type:'object',properties:{agent:{type:'string',enum:['codex']},task:{type:'string',minLength:1,maxLength:12000}},required:['agent','task']}},
  {name:'delegate_status',tags:['read'],description:'Read one delegated task belonging to the current allowlisted private user. Use only when the user asks for progress; completion is pushed automatically.',
    parameters:{type:'object',properties:{id:{type:'integer',minimum:1}},required:['id']}},
  {name:'delegate_cancel',tags:['write'],description:'Cancel the current allowlisted private user\'s task when they request cancellation.',
    parameters:{type:'object',properties:{id:{type:'integer',minimum:1}},required:['id']}},
];
export class DelegateWorld implements World {
  readonly id='delegate';
  private host?:WorldHost;
  private jobs?:Jobs;
  private grant:RequestGrant|null=null;
  private release?:()=>void;
  private timer?:ReturnType<typeof setInterval>;
  private work?:Promise<void>;
  private notifying?:Promise<void>;
  private running?:{id:number;abort:AbortController;reason:'cancelled'|'interrupted'};
  private stopping=false;
  constructor(private readonly ctx:WorldContext<DelegateConfigSection>,private readonly runner=new CodexRunner()){}
  envPromptVars(){return {};}
  /** 全局白名单 QQ 加上本插件的白名单；每次现读，设置页改完立即生效。 */
  private allowed(){return allowedUsers(this.ctx.cfg,this.ctx.globals?.().trustedQQ);}
  async start(host:WorldHost){
    this.host=host;this.stopping=false;
    this.jobs=new Jobs(join(this.ctx.dataDir,'delegate','jobs.sqlite'));this.jobs.recover();
    this.release=registerDeliveryHint(this.ctx.botDir,this.id,events=>{this.grant=requestGrant(events,this.allowed());return null;});
    this.timer=setInterval(()=>this.kick(),1000);this.timer.unref();this.kick();
  }
  async stop(){
    this.stopping=true;clearInterval(this.timer);this.release?.();this.release=undefined;this.grant=null;
    if(this.running){this.running.reason='interrupted';this.running.abort.abort();}
    await this.work;await this.notifying;
    for(const job of this.jobs?.pending()??[])this.jobs!.finish(job.id,'interrupted','Bot stopped before this task completed. It was not automatically rerun.');
    this.jobs?.close();this.jobs=undefined;this.host=undefined;
  }
  onTurnEnded(){this.grant=null;}
  private authorize(context:ToolCallContext):RequestGrant {
    context.signal?.throwIfAborted();
    if(!this.host||!this.jobs||this.stopping)throw new Error('Delegation is not running');
    if(context.role!=='main'||!this.grant||!this.allowed().has(this.grant.user)||Date.now()-this.grant.at>5*60000)
      throw new Error('Only the current allowlisted QQ private user request may use delegation');
    return this.grant;
  }
  tools():ToolDef[]{return DELEGATE_TOOL_DECLS.map(decl=>({...decl,handler:async(args,context)=>{
    const grant=this.authorize(context);
    if(decl.name==='delegate'){
      if(!this.ctx.cfg.active)throw new Error('New delegation tasks are disabled');
      if(args.agent!=='codex'||typeof args.task!=='string'||!args.task.trim()||args.task.length>12000)throw new Error('Provide agent=codex and a task of 1–12000 characters');
      const existing=this.jobs!.request(grant.cursor);
      if(existing)return `这条用户消息已对应任务 #${existing.id}，状态 ${existing.status}，没有重复创建。`;
      if(this.jobs!.pending().filter(j=>j.status==='queued').length>=this.ctx.cfg.maxQueued)throw new Error('Delegation queue is full');
      codexExecutable(this.ctx.cfg.executableFile);
      writableDirectories(this.ctx.cfg.writableDirs);
      if(this.ctx.cfg.workspaceDir&&!isAbsolute(this.ctx.cfg.workspaceDir))throw new Error('Workspace root must be an absolute path');
      const job=this.jobs!.add(grant.user,grant.cursor,args.task.trim());
      setImmediate(()=>this.kick());
      return `已受理，任务编号 #${job.id}。将在后台由 Codex 执行，完成后结果会回到当前对话；现在可以继续聊天。`;
    }
    const id=Number(args.id),job=Number.isSafeInteger(id)?this.jobs!.get(id):undefined;
    if(!job||job.user!==grant.user)throw new Error('Task not found for this requester');
    if(decl.name==='delegate_cancel')await this.cancel(job.id);
    return JSON.stringify(this.jobs!.get(job.id));
  }}));}
  private kick(){
    if(!this.host||!this.jobs||this.stopping)return;
    if(!this.notifying)this.notifying=this.notify().catch(error=>this.host?.log.error('delegate result delivery failed',{error:String(error)})).finally(()=>{this.notifying=undefined;});
    if(this.work||!this.ctx.cfg.active)return;
    const job=this.jobs.pending().find(j=>j.status==='queued');if(!job)return;
    this.work=this.execute(job).finally(()=>{this.work=undefined;if(!this.stopping)setImmediate(()=>this.kick());});
  }
  private async execute(job:Job){
    const abort=new AbortController();this.running={id:job.id,abort,reason:'cancelled'};
    try{
      if(!this.allowed().has(job.user)){this.jobs!.finish(job.id,'cancelled','Requester was removed from the allowlist before execution.');return;}
      const root=this.ctx.cfg.workspaceDir||join(this.ctx.dataDir,'delegate','tasks');
      const workspace=taskWorkspace(root,job.id);this.jobs!.running(job.id,workspace);
      const result=await this.runner.run({executable:this.ctx.cfg.executableFile,workspace,task:job.task,model:this.ctx.cfg.model,
        writableDirs:this.ctx.cfg.writableDirs,allowNetwork:this.ctx.cfg.allowNetwork,allowWebSearch:this.ctx.cfg.allowWebSearch,
        timeoutSeconds:this.ctx.cfg.timeoutSeconds,signal:abort.signal});
      this.jobs!.finish(job.id,abort.signal.aborted?this.running.reason:result.ok?'succeeded':'failed',result.text);
    }catch(error){this.jobs!.finish(job.id,abort.signal.aborted?this.running.reason:'failed',String(error).slice(0,2000));}
    finally{this.running=undefined;}
  }
  private async notify(){
    for(const job of this.jobs!.unnotified()){
      if(this.stopping||!this.host)return;
      // The event log closes the crash window between event persistence and the SQLite acknowledgement.
      const sent=this.host.store.range({source:this.id}).some(e=>e.type==='delegate.completed'&&e.meta?.jobId===job.id);
      if(!sent)await this.host.pushEvent({type:'delegate.completed',source:this.id,origin:'external',ts:new Date().toISOString(),senderKey:'delegate',
        text:JSON.stringify({jobId:job.id,requester:job.user,to:`private:${job.user}`,status:job.status,task:job.task,workspace:job.workspace,result:job.result}),
        meta:{jobId:job.id,requester:job.user,requestCursor:job.requestCursor}}, {trigger:'debounce'});
      this.jobs!.notified(job.id);
    }
  }
  async cancel(id:number){
    const job=this.jobs?.get(id);if(!job)throw new Error('Task not found');
    if(job.status==='queued'){this.jobs!.finish(id,'cancelled','Task cancelled before execution.');this.kick();}
    else if(this.running?.id===id){this.running.reason='cancelled';this.running.abort.abort();await this.work;this.kick();}
  }
  webUi(language:Language='zh'){
    const t=strings(language),override=join(this.ctx.botDir,'prompts','DELEGATE.md');
    return {label:t.title,config:[delegateConfigGroup(language)],panels:[{id:'jobs',title:t.jobs}],
      promptDocs:[{key:'worlds.delegate.environment',title:t.title,description:t.description,
        path:existsSync(override)?override:fileURLToPath(new URL('./ENV_PROMPT.md',import.meta.url)),deploymentPath:override,role:'envPrompt' as const}],
      invoke:async(panel:string,method:string,args:unknown[])=>{
        if(panel!=='jobs')throw new Error('Unknown panel');
        if(method==='state')return {jobs:this.jobs?.list()??[]};
        if(method==='cancel'){const id=Number(args[0]);if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid task id');await this.cancel(id);return {ok:true};}
        throw new Error('Unknown method');
      },
    };
  }
}
