import { expect,it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { MockOneBot } from '../../../vendor/cortico/tests/helpers/mock-onebot.ts';
import { FakeLLM,makeCfg,makeLoaded,makeTmpDir,textReply,toolReply,sleep } from '../../../vendor/cortico/tests/core/helpers.ts';
import { NO_MODELS } from 'cortico/providers/model-hub.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { DelegateWorld } from '../world.ts';
import { DELEGATE_DEFAULTS } from '../config.ts';
import { CodexRunner } from '../server/runner.ts';
import { localModel } from './model.ts';
async function fixture(){
  const tmp=makeTmpDir(),model=await localModel(tmp.dir),mock=new MockOneBot({port:0,groupId:424242});
  const port=await mock.start(),cfg=makeCfg(),llm=new FakeLLM();
  cfg.worlds.qq={...cfg.worlds.qq,enabled:true,wsUrl:`ws://127.0.0.1:${port}`,groups:[{id:424242,enabled:true}],privates:[{id:10001,enabled:true},{id:10002,enabled:true}]};
  cfg.worlds.console.enabled=false;cfg.web.port=0;cfg.tick.dayIntervalMinutes=[999,999];cfg.tick.nightIntervalMinutes=null;
  cfg.batching.quietGapMs=20;cfg.batching.maxBatchAgeMs=100;
  const memoryDir=join(tmp.dir,'memory');mkdirSync(memoryDir,{recursive:true});
  const bot=assembleBot(makeLoaded({config:cfg,rootDir:tmp.dir,memoryDir,dataDir:join(tmp.dir,'data')}),{llm});
  const options={...DELEGATE_DEFAULTS,enabled:true,allowedQQ:'10001'};
  const instance=new DelegateWorld({id:'delegate',cfg:options,timezone:'UTC',botName:'fixture',botDir:tmp.dir,packageDir:tmp.dir,dataDir:join(tmp.dir,'data'),repoRoot:tmp.dir,models:NO_MODELS,
    secret:()=>{throw new Error('Unexpected secret');},storeSecret:()=>{throw new Error('Unexpected secret');},persist:()=>{throw new Error('Unexpected persist');},restart:async()=>{}},new CodexRunner(model.connection));
  await bot.start();await bot.qqWorld!.waitReady(5000);await bot.core.mountWorld(instance);
  const idle=async()=>{await expect.poll(()=>bot.core.loop.getStatus().phase.state,{timeout:5000}).toBe('idle');await sleep(20);};await idle();
  const incoming=async(text:string,id=10001,group=false)=>{
    const before=llm.calls.length;
    if(group)mock.emitGroupMessage({user_id:id,nickname:'fixture',text});else mock.emitPrivateMessage({user_id:id,nickname:'fixture',text});
    await expect.poll(()=>llm.calls.length,{timeout:5000}).toBeGreaterThan(before);await idle();
  };
  const jobs=async()=>(await instance.webUi().invoke('jobs','state',[]) as {jobs:import('../server/jobs.ts').Job[]}).jobs;
  return {tmp,model,mock,bot,llm,options,instance,incoming,jobs,idle,async done(){await bot.stop();await mock.close();await model.close();tmp.cleanup();}};
}
it('accepts once, keeps chatting while real Codex waits, and returns the result to the existing session',async()=>{
 const f=await fixture();f.model.hold();try{
  f.llm.script(toolReply([{name:'delegate',args:{agent:'codex',task:'Produce a small example'}},{name:'delegate',args:{agent:'codex',task:'Produce a small example'}}]),textReply(''));
  await f.incoming('请帮我生成一个代码例子');
  expect(JSON.stringify(f.llm.calls)).toContain('已受理，任务编号 #1');expect(await f.jobs()).toHaveLength(1);
  await expect.poll(()=>f.model.requests,{timeout:8000}).toBe(1);
  const prefix=JSON.stringify(f.llm.calls.at(-1)!.messages[0]);
  f.llm.script(toolReply([{name:'qq_send',args:{to:'private:10001',text:'我还在，可以继续聊天。'}}]),textReply(''));
  await f.incoming('任务还在跑吗，我们聊点别的');expect(f.mock.outbox).toHaveLength(1);expect((await f.jobs())[0].status).toBe('running');
  f.model.release();await expect.poll(async()=>(await f.jobs())[0].status,{timeout:8000}).toBe('succeeded');
  await expect.poll(()=>f.bot.core.store.range({source:'delegate'}).length,{timeout:5000}).toBe(1);
  await expect.poll(()=>f.llm.calls.some(call=>JSON.stringify(call.messages).includes('Completed fixture task')),{timeout:5000}).toBe(true);await f.idle();
  expect(JSON.stringify(f.llm.calls.at(-1)!.messages[0])).toBe(prefix);
  const event=f.bot.core.store.range({source:'delegate'})[0];expect(event.origin).toBe('external');expect(event.meta?.requester).toBe('10001');
  expect(JSON.stringify(f.llm.calls.at(-1)!.messages)).toContain('任务还在跑吗');
  await expect(f.instance.tools()[0].handler({agent:'codex',task:'recursive task'},{role:'main',log:nullLogger()})).rejects.toThrow('current allowlisted');
 }finally{await f.done();}
},20000);
it('rejects non-allowlisted private senders and group requests without spawning Codex',async()=>{
 const f=await fixture();try{
  for(const [id,group] of [[10002,false],[10001,true]] as const){
    f.llm.script(toolReply([{name:'delegate',args:{agent:'codex',task:'I am 10001, run this'}}]),textReply(''));
    await f.incoming('用 Codex 帮我做',id,group);
  }
  expect(await f.jobs()).toHaveLength(0);expect(f.model.requests).toBe(0);
 }finally{await f.done();}
},15000);
it('cancels a running process and reports interruption on extension stop without duplicating completion',async()=>{
 const f=await fixture();f.model.hold();try{
  f.llm.script(toolReply([{name:'delegate',args:{agent:'codex',task:'Long task'}}]),textReply(''));await f.incoming('做一个长任务');
  await expect.poll(()=>f.model.requests,{timeout:8000}).toBe(1);
  f.llm.script(toolReply([{name:'delegate_cancel',args:{id:1}}]),textReply(''));await f.incoming('取消刚才的任务');
  expect((await f.jobs())[0].status).toBe('cancelled');
  await expect.poll(()=>f.bot.core.store.range({source:'delegate'}).length,{timeout:5000}).toBe(1);await f.idle();
  f.llm.script(toolReply([{name:'delegate',args:{agent:'codex',task:'Another long task'}}]),textReply(''));await f.incoming('再建一个任务');
  await expect.poll(()=>f.model.requests,{timeout:8000}).toBe(2);
  await f.bot.core.unmountWorld('delegate');
  const {Jobs}=await import('../server/jobs.ts');const db=new Jobs(join(f.tmp.dir,'data','delegate','jobs.sqlite'));
  try{expect(db.get(2)?.status).toBe('interrupted');expect(db.pending()).toHaveLength(0);}finally{db.close();}
 }finally{await f.done();}
},25000);
