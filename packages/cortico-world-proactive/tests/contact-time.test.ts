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
    expect(tracker.hint([first])).toContain('2026-10-20T16:00:00.000-07:00');
    const cached=message(10003,'2026-10-21T23:00:00Z');
    const other=message(10002,'2026-10-22T23:00:00Z');
    const trigger=message(10001,'2026-10-23T23:00:00Z');
    const next=message(10001,'2026-10-23T23:00:01Z');
    const context=store.append({source:'qq',origin:'external',type:'qq.group_context',ts:next.ts,text:'fixture',meta:{contextMessageCursors:[cached.cursor,other.cursor,trigger.cursor,next.cursor],triggerMessageCursors:[trigger.cursor,next.cursor,other.cursor]}});
    const hint=tracker.hint([context])!;
    expect(hint).toContain('3 天 0 小时');
    expect(hint).not.toContain('QQ 10003');expect(hint).not.toContain('QQ 10002');
    expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({'10001':{at:next.ts,cursor:next.cursor}});
    expect(tracker.hint([context,first])).toBeNull();
    const reopened=new ContactTime(path,'America/Phoenix',()=>['10001'],store);
    expect(reopened.hint([message(10001,'2026-10-24T23:00:01Z')])).toContain('1 天 0 小时');
  }finally{tmp.cleanup();}
});
