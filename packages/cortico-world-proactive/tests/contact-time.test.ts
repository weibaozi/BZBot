import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonlEventStore } from 'cortico/core/event-store.ts';
import { makeTmpDir } from '../../../vendor/cortico/tests/core/helpers.ts';
import { ContactTime } from '../server/contact-time.ts';

it('uses group triggers, ignores cached rows and replays, and keeps the pre-batch gap across channels', () => {
  const tmp=makeTmpDir();
  try {
    const store=new JsonlEventStore({dataDir:tmp.dir,run:'fixture'});
    const path=join(tmp.dir,'contacts.json');
    const tracker=new ContactTime(path,'America/Phoenix',()=>['10001','10003'],store);
    const message=(user:number,ts:string)=>store.append({source:'qq',origin:'external',type:'qq.message',ts,text:'fixture',meta:{user_id:user}});
    const first=message(10001,'2026-10-20T23:00:00Z');
    expect(tracker.hint([first])).toBeNull();
    const cached=message(10003,'2026-10-21T23:00:00Z');
    const other=message(10002,'2026-10-22T23:00:00Z');
    const trigger=message(10001,'2026-10-23T23:00:00Z');
    const next=message(10001,'2026-10-23T23:00:01Z');
    const context=store.append({source:'qq',origin:'external',type:'qq.group_context',ts:next.ts,text:'fixture',meta:{contextMessageCursors:[cached.cursor,other.cursor,trigger.cursor,next.cursor],triggerMessageCursors:[trigger.cursor,next.cursor,other.cursor]}});
    const hint=tracker.hint([context])!;
    expect(hint).toContain('3 天 0 小时');
    expect(hint).not.toContain('QQ 10003');expect(hint).not.toContain('QQ 10002');
    expect(hint).toContain('2026-10-23 16:00:00（UTC-07:00）');
    expect(hint).not.toContain('本次发言');
    expect(JSON.parse(readFileSync(path,'utf8'))['10001']).toMatchObject({at:next.ts,cursor:next.cursor});
    expect(JSON.parse(readFileSync(path,'utf8'))['10002']).toBeUndefined();
    expect(tracker.hint([context,first])).toBeNull();
    const reopened=new ContactTime(path,'America/Phoenix',()=>['10001'],store);
    expect(reopened.hint([message(10001,'2026-10-24T23:00:01Z')])).toContain('1 天 0 小时');
  }finally{tmp.cleanup();}
});

it('updates silent group activity, applies a hot threshold, and suppresses first contact and short gaps', () => {
  const tmp=makeTmpDir();
  try {
    const store=new JsonlEventStore({dataDir:tmp.dir,run:'fixture'});
    let hours=1;
    const tracker=new ContactTime(join(tmp.dir,'contacts.json'),'America/Phoenix',()=>['10001'],store,()=>hours);
    const message=(ts:string,user=10001)=>store.append({source:'qq',origin:'external',type:'qq.message',ts,text:'fixture',meta:{user_id:user,conv:{kind:'group',id:424242}}});
    expect(tracker.hint([message('2026-10-20T00:00:00Z')])).toBeNull();
    expect(tracker.hint([message('2026-10-20T01:00:00Z')])).toBeNull();
    message('2026-10-20T01:30:00Z');tracker.sync(); // No reply triggered.
    message('2026-10-20T02:00:00Z',10002);tracker.sync();
    expect(tracker.hint([message('2026-10-20T02:30:00Z')])).toBeNull();
    expect(tracker.hint([message('2026-10-20T03:30:01Z')])).toContain('0 天 1 小时 0 分钟');
    hours=2;
    expect(tracker.hint([message('2026-10-20T05:00:00Z')])).toBeNull();
    hours=0.5;
    expect(tracker.hint([message('2026-10-20T05:31:00Z')])).toContain('31 分钟');
  }finally{tmp.cleanup();}
});
