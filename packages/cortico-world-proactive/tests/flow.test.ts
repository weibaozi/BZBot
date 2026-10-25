import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { MockOneBot } from '../../../vendor/cortico/tests/helpers/mock-onebot.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir, textReply, toolReply, sleep } from '../../../vendor/cortico/tests/core/helpers.ts';
import { NO_MODELS } from 'cortico/providers/model-hub.ts';
import { PROACTIVE_DEFAULTS } from '../config.ts';
import { ProactiveWorld } from '../world.ts';
import { readState, writeState } from '../server/state.ts';

async function fixture() {
  const tmp=makeTmpDir(), mock=new MockOneBot({port:0,groupId:424242});
  const port=await mock.start(), cfg=makeCfg(), llm=new FakeLLM();
  cfg.worlds.qq={...cfg.worlds.qq,enabled:true,wsUrl:`ws://127.0.0.1:${port}`,groups:[{id:424242,enabled:true}],privates:[{id:10001,enabled:true},{id:10002,enabled:true}]};
  cfg.worlds.qq.segment.private.interval=[0,0];
  cfg.worlds.console.enabled=false;cfg.web.port=0;cfg.tick.dayIntervalMinutes=[999,999];cfg.tick.nightIntervalMinutes=null;
  cfg.batching.quietGapMs=20;cfg.batching.maxBatchAgeMs=100;
  const memoryDir=join(tmp.dir,'memory');mkdirSync(memoryDir,{recursive:true});writeFileSync(join(memoryDir,'CONSTITUTION.md'),'Fixture persona');
  const bot=assembleBot(makeLoaded({config:cfg,rootDir:tmp.dir,memoryDir,dataDir:join(tmp.dir,'data')}),{llm});
  const options={...structuredClone(PROACTIVE_DEFAULTS),enabled:true,targetQQ:'10001'};
  const create=()=>new ProactiveWorld({id:'proactive',cfg:options,timezone:'UTC',botName:'fixture',botDir:tmp.dir,packageDir:tmp.dir,dataDir:join(tmp.dir,'data'),repoRoot:tmp.dir,models:NO_MODELS,
    secret:()=>{throw new Error('Unexpected secret');},storeSecret:()=>{throw new Error('Unexpected secret');},persist:()=>{throw new Error('Unexpected persist');},restart:async()=>{}});
  let instance=create();
  await bot.start();await bot.qqWorld!.waitReady(5000);await bot.core.mountWorld(instance);
  const waitIdle=async()=>{ await expect.poll(()=>bot.core.loop.getStatus().phase.state,{timeout:5000}).toBe('idle');await sleep(30); };
  await waitIdle();
  const incoming=async(text:string,id=10001)=>{
    const before=llm.calls.length;mock.emitPrivateMessage({user_id:id,nickname:'fixture',text});
    await expect.poll(()=>llm.calls.length,{timeout:5000}).toBeGreaterThan(before);await waitIdle();
  };
  const trigger=async(send=true)=>{
    const before=llm.calls.length;
    if(send)llm.script(toolReply([{name:'qq_send',args:{to:'private:10001',text:'第一句。第二句。'}}]),textReply(''));
    expect(instance.pulse(true)).toBe(true);
    await expect.poll(()=>llm.calls.length,{timeout:5000}).toBeGreaterThan(before);await waitIdle();
  };
  const reload=async(before?:()=>void)=>{await bot.core.unmountWorld('proactive');before?.();instance=create();await bot.core.mountWorld(instance);await waitIdle();return instance;};
  const done=async()=>{await bot.stop();await mock.close();tmp.cleanup();};
  return {tmp,mock,bot,llm,options,get instance(){return instance;},incoming,trigger,reload,waitIdle,done};
}

it('reuses history and keeps the prefix stable, counts split sends once, and resets only on the target reply', async()=>{
  const f=await fixture();try{
    await f.incoming('我在做一件重要的事');const prefix=JSON.stringify(f.llm.calls.at(-1)!.messages[0]);
    await f.trigger();
    const messages=f.llm.calls.at(-1)!.messages;
    expect(JSON.stringify(messages)).toContain('我在做一件重要的事');expect(JSON.stringify(messages)).toContain('[proactive.due]');
    expect(JSON.stringify(messages[0])).toBe(prefix);
    expect(f.mock.outbox).toHaveLength(2);
    expect(f.instance.status()).toMatchObject({unanswered:1,sentToday:1});
    await f.incoming('另一个人的消息',10002);expect(f.instance.status().unanswered).toBe(1);
    await f.trigger();expect(f.instance.status()).toMatchObject({unanswered:2,sentToday:2,status:'limit'});
    expect(f.instance.pulse(true)).toBe(false);
    await f.incoming('我回来啦');expect(f.instance.status()).toMatchObject({unanswered:0,sentToday:2});
  }finally{await f.done();}
},20000);

it('does not count model silence or failed sends, and hot quiet hours, pause and daily caps prevent reminders',async()=>{
  const f=await fixture();try{
    await f.trigger(false);expect(f.instance.status()).toMatchObject({unanswered:0,sentToday:0});
    f.mock.setActionHandler('send_private_msg',()=>({retcode:1200,message:'offline'}));
    await f.trigger();expect(f.instance.status()).toMatchObject({unanswered:0,sentToday:0});
    f.options.quietEnabled=true;f.options.quietStart='00:00';f.options.quietEnd='00:00';
    expect(f.instance.pulse(true)).toBe(false);expect(f.instance.status().status).toBe('quietNow');
    f.options.quietEnabled=false;f.options.active=false;expect(f.instance.pulse(true)).toBe(false);
    f.options.active=true;f.mock.setActionHandler('send_private_msg',()=>({data:{message_id:7000}}));
    f.options.dailyLimit=1;await f.trigger();expect(f.instance.pulse(true)).toBe(false);
    await f.incoming('回来了');expect(f.instance.status()).toMatchObject({status:'limit',unanswered:0,sentToday:1});
  }finally{await f.done();}
},20000);

it('rechecks a queued reminder after a real user message arrives while delivery is paused',async()=>{
  const f=await fixture();try{
    f.bot.core.bus.setPaused(true);expect(f.instance.pulse(true)).toBe(true);
    const id=f.mock.emitPrivateMessage({user_id:10001,nickname:'fixture',text:'打断旧提醒'});
    await expect.poll(()=>f.bot.core.store.range({}).some(e=>e.meta?.message_id===id),{timeout:5000}).toBe(true);
    f.bot.core.bus.setPaused(false);
    await expect.poll(()=>f.llm.calls.some(c=>JSON.stringify(c.messages).includes('打断旧提醒')),{timeout:5000}).toBe(true);
    await f.waitIdle();
    expect(f.bot.core.store.range({}).filter(e=>e.type==='proactive.due')).toHaveLength(0);
    expect(f.instance.status().status).toBe('idle');
  }finally{await f.done();}
},15000);

it('persists counts, defers overdue tasks on restart, and resets the daily count using the local date',async()=>{
  const f=await fixture();try{
    await f.trigger();await f.reload();expect(f.instance.status()).toMatchObject({unanswered:1,sentToday:1});
    await f.reload(()=>{
      const path=join(f.tmp.dir,'data','proactive','state.json'), state=readState(path)!;
      state.nextAt=Date.now()-60000;state.day='2000-01-01';writeState(path,state);
    });expect(f.instance.status()).toMatchObject({unanswered:1,sentToday:0});
    expect(f.instance.status().nextAt).toBeGreaterThan(Date.now());expect(f.instance.pulse()).toBe(false);
    const old=f.instance.status().nextAt;f.options.intervalMinutes=[1,1];
    expect(f.instance.status().nextAt).toBeLessThan(old!);
  }finally{await f.done();}
},15000);

it('the real timer delivers one due reminder and stopping the extension ends scheduling',async()=>{
  const f=await fixture();try{
    await f.reload(()=>{
      const path=join(f.tmp.dir,'data','proactive','state.json'),state=readState(path)!;
      state.nextAt=Date.now()+300;writeState(path,state);
    });
    await expect.poll(()=>f.bot.core.store.range({}).filter(e=>e.type==='proactive.due').length,{timeout:5000}).toBe(1);
    await f.waitIdle();expect(f.instance.status().unanswered).toBe(0);
    await f.bot.core.unmountWorld('proactive');expect(f.instance.pulse(true)).toBe(false);
  }finally{await f.done();}
},15000);
