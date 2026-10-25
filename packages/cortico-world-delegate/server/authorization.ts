import type { EventEnvelope } from 'cortico/core/types.ts';
export interface RequestGrant { user: string; cursor: number; text: string; at: number }
/** Identity comes only from delivered platform envelopes, never tool arguments or quoted text. */
export function requestGrant(events:readonly EventEnvelope[],allowed:ReadonlySet<string>,now=Date.now()):RequestGrant|null {
  const external=events.filter(e=>e.origin==='external');
  const messages=external.filter(e=>e.source==='qq'&&e.type==='qq.message');
  if(!messages.length || external.some(e=>e.source!=='qq'))return null;
  let grant:RequestGrant|null=null;
  for(const event of messages){
    const conv=event.meta?.conv as {kind?:string;id?:number}|undefined;
    const user=String(event.meta?.user_id??'');const at=Date.parse(event.ts);
    if(conv?.kind!=='private'||String(conv.id)!==user||!allowed.has(user)||!Number.isFinite(at)||now-at>5*60000||at>now+60000)return null;
    if(grant && grant.user!==user)return null;
    grant={user,cursor:event.cursor,text:event.text,at};
  }
  return grant;
}
