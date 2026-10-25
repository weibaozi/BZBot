import { expect,it } from 'vitest';
import { join } from 'node:path';
import { existsSync,readFileSync } from 'node:fs';
import { LANGUAGES } from 'cortico/core/language.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';
import { makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
import { requestGrant } from '../server/authorization.ts';
import { Jobs } from '../server/jobs.ts';
import { CodexRunner,childEnvironment,taskWorkspace } from '../server/runner.ts';
import { localModel } from './model.ts';
import { strings } from '../strings.ts';
import { delegateConfigGroup } from '../config.ts';
const event:EventEnvelope={cursor:1,type:'qq.message',source:'qq',origin:'external',ts:new Date().toISOString(),text:'write something',meta:{user_id:10001,conv:{kind:'private',id:10001}}};
it('authorizes only fresh delivered private envelopes and rejects mixed users, groups, spoofing and results',()=>{
 const allowed=new Set(['10001']);expect(requestGrant([event],allowed)?.user).toBe('10001');
 for(const events of [[],[{...event,origin:'internal' as const}],[{...event,source:'delegate',type:'delegate.completed'}],[{...event,ts:'2000-01-01T00:00:00Z'}],
 [{...event,meta:{user_id:10002,conv:{kind:'private',id:10001}}}],[{...event,meta:{user_id:10001,conv:{kind:'group',id:10001}}}],
 [event,{...event,source:'console'}]])expect(requestGrant(events,allowed)).toBeNull();
});
it('persists jobs in SQLite and marks unfinished work interrupted instead of rerunning it',()=>{
 const tmp=makeTmpDir(),path=join(tmp.dir,'jobs.sqlite');let db=new Jobs(path);
 try{const job=db.add('10001',1,'task');expect(()=>db.add('10001',1,'repeat')).toThrow();db.running(job.id,'workspace');db.close();db=new Jobs(path);db.recover();
 expect(db.get(job.id)?.status).toBe('interrupted');expect(db.pending()).toHaveLength(0);expect(db.unnotified()).toHaveLength(1);db.notified(job.id);expect(db.unnotified()).toHaveLength(0);
 }finally{db.close();tmp.cleanup();}
});
it('keeps bot secrets out of the child environment and localizes declared controls',()=>{
 process.env.CORTICO_DELEGATE_TEST_SECRET='fixture';try{expect(childEnvironment()).not.toHaveProperty('CORTICO_DELEGATE_TEST_SECRET');}finally{delete process.env.CORTICO_DELEGATE_TEST_SECRET;}
 for(const lang of LANGUAGES){for(const value of Object.values(strings(lang)))expect(value).toBeTruthy();expect(Object.keys(delegateConfigGroup(lang).schema.properties)).toHaveLength(7);}
});
it('runs the actual Codex CLI and writes an artifact through its sandboxed command tool',async()=>{
 const tmp=makeTmpDir(),model=await localModel(tmp.dir);model.artifact();
 try{const workspace=taskWorkspace(join(tmp.dir,'tasks'),1);const result=await new CodexRunner(model.connection).run({executable:'',workspace,task:'Create result.txt',model:'',timeoutSeconds:20,signal:new AbortController().signal});
 expect(result.ok,result.text).toBe(true);expect(existsSync(join(workspace,'result.txt')),JSON.stringify(model.toolOutputs)).toBe(true);expect(readFileSync(join(workspace,'result.txt'),'utf8')).toContain('fixture artifact');
 }finally{await model.close();tmp.cleanup();}
},30000);
it('cancels and times out real Codex processes waiting on a model response',async()=>{
 const tmp=makeTmpDir(),model=await localModel(tmp.dir);model.hold();
 try{const runner=new CodexRunner(model.connection),workspace=taskWorkspace(join(tmp.dir,'tasks'),1),abort=new AbortController();
 const waiting=runner.run({executable:'',workspace,task:'Wait',model:'',timeoutSeconds:20,signal:abort.signal});
 await expect.poll(()=>model.requests,{timeout:8000}).toBeGreaterThan(0);abort.abort();expect((await waiting).ok).toBe(false);
 const result=await runner.run({executable:'',workspace,task:'Wait',model:'',timeoutSeconds:1,signal:new AbortController().signal});expect(result).toMatchObject({ok:false,text:'Codex task timed out.'});
 }finally{await model.close();tmp.cleanup();}
},30000);
it('the Codex sandbox refuses a write outside the task workspace',async()=>{
 const tmp=makeTmpDir(),model=await localModel(tmp.dir);
 model.artifact(process.platform==='win32'?"Set-Content -LiteralPath ../outside.txt -Value 'must not escape'":"printf 'must not escape' > ../outside.txt");
 try{const workspace=taskWorkspace(join(tmp.dir,'tasks'),1);
 await new CodexRunner(model.connection).run({executable:'',workspace,task:'Test the configured sandbox boundary',model:'',timeoutSeconds:20,signal:new AbortController().signal});
 expect(model.toolOutputs.length).toBeGreaterThan(0);expect(existsSync(join(workspace,'..','outside.txt'))).toBe(false);
 }finally{await model.close();tmp.cleanup();}
},30000);
