import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { MockOneBot } from '../../../vendor/cortico/tests/helpers/mock-onebot.ts';
import { FakeLLM, makeCfg, makeLoaded, makeTmpDir, toolReply, textReply } from '../../../vendor/cortico/tests/core/helpers.ts';
import { nullLogger } from 'cortico/core/util.ts';
import { world, PNG, FakeModelHub } from './helpers.ts';

it('learns from real delivered QQ requests, bypasses review, deduplicates, and refuses untrusted requests', async () => {
  const tmp = makeTmpDir(), onebot = new MockOneBot({port:0,groupId:424242,selfId:5000});
  const server = createServer((req,res) => {res.setHeader('Content-Type','image/png');res.end(PNG);});
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const port = await onebot.start(), cfg = makeCfg();
  cfg.worlds.qq = {...cfg.worlds.qq,enabled:true,wsUrl:`ws://127.0.0.1:${port}`,groups:[{id:424242,enabled:true}],privates:[]};
  cfg.worlds.qq.groupReply = {probability:100,recentMessages:5,forceMention:true,sleepEnabled:false};
  cfg.worlds.console.enabled=false;cfg.web.port=0;cfg.tick.dayIntervalMinutes=[999,999];cfg.tick.nightIntervalMinutes=null;
  cfg.batching.quietGapMs=30;cfg.batching.maxBatchAgeMs=100;
  for (const p of Object.values(cfg.providers)) p.multimodal=true;
  const memoryDir=join(tmp.dir,'memory');mkdirSync(memoryDir);writeFileSync(join(memoryDir,'CONSTITUTION.md'),'Fixture');
  const llm=new FakeLLM();
  const bot=assembleBot(makeLoaded({config:cfg,rootDir:tmp.dir,memoryDir,dataDir:join(tmp.dir,'data')}),{llm});
  let fail=false;
  const models=new FakeModelHub(async()=>{if(fail)throw new Error('Caption unavailable');return {caption:'开心',tags:['开心'],visible_text:'',needs_review:true};});
  const trusted=['10001'];const {instance,cfg:settings}=world(tmp.dir,models,trusted);
  settings.memes.proactiveSearchPercent=0;
  try {
    await bot.start();await bot.qqWorld!.waitReady(5000);await bot.core.mountWorld(instance);
    onebot.emitGroupMessage({user_id:10001,segments:[{type:'image',data:{url:`http://127.0.0.1:${address.port}/image`}}]});
    await expect.poll(()=>bot.core.store.range({source:'qq'}).some(e=>e.blobs?.length)).toBe(true);
    await expect.poll(()=>llm.calls.length).toBeGreaterThan(0);
    await new Promise(resolve=>setTimeout(resolve,200));
    await instance.collection.scan();expect((await instance.collection.list()).items).toHaveLength(1);
    const handle=bot.core.store.range({source:'qq'}).flatMap(e=>e.blobs??[])[0].handle;
    const request=async(user:number)=>{
      let called=false,finished=false;
      llm.fallback=()=>{if(!called){called=true;return toolReply([{name:'save_meme',args:{image:handle}}]);}finished=true;return textReply('');};
      onebot.emitGroupMessage({user_id:user,text:'学这个表情包'});
      await expect.poll(()=>finished,{timeout:6000}).toBe(true);
      await new Promise(resolve=>setTimeout(resolve,100));
    };
    await request(20002);expect(await instance.library.entries()).toHaveLength(0);
    expect(JSON.stringify(llm.calls.at(-1)).replaceAll('\\', '')).toContain('globally trusted');
    // A cached trusted message in group history does not authorize an untrusted trigger.
    settings.memes.collectDailyLimit=0;
    await request(10001);
    expect((await instance.library.entries())[0]).toMatchObject({caption:'开心',searchable:true,reviewed:true});
    expect((await instance.search.state()).valid).toBe(1);
    expect((await instance.collection.list()).items).toHaveLength(0);
    expect(JSON.stringify(llm.calls.at(-1)).replaceAll('\\', '')).toContain('"ready":true');
    await request(10001);expect(await instance.library.entries()).toHaveLength(1);expect(models.chatCalls).toHaveLength(1);
    const tool=instance.tools().find(t=>t.name==='save_meme')!;
    await expect(tool.handler({image:handle},{role:'main',log:nullLogger()})).rejects.toThrow('globally trusted');
    // Remove generated description to exercise a recoverable caption failure on retry.
    const entry=(await instance.library.entries())[0];
    await instance.library.applySemantic(entry.id, (await import('../server/library.ts')).hash(JSON.stringify((await instance.library.packs())[0].images[0])), {caption:'',searchable:false});
    fail=true;await request(10001);
    expect(JSON.stringify(llm.calls.at(-1)).replaceAll('\\', '')).toContain('"saved":true');
    expect(JSON.stringify(llm.calls.at(-1)).replaceAll('\\', '')).toContain('"ready":false');
    expect(await instance.library.entries()).toHaveLength(1);
  } finally {await bot.stop();await onebot.close();await new Promise<void>(resolve=>server.close(()=>resolve()));tmp.cleanup();}
},20000);
