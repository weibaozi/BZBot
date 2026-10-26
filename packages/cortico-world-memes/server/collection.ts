import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorldHost } from 'cortico/core/types.ts';
import { MemeLibrary } from './library.ts';

interface Item { id: string; mime: string; at: string; source: string; cursor: number; status: 'pending' | 'approved' | 'rejected'; entryId?: string }
interface State { cursor: number; day: string; count: number; items: Item[] }
export class MemeCollection {
  private state!: State;
  private serial: Promise<unknown> = Promise.resolve();
  private host?: WorldHost;
  constructor(private dir: string, private library: MemeLibrary, private timezone: string,
    private config: () => { collectEnabled: boolean; collectDailyLimit: number }) {}
  private lock<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.serial.then(run); this.serial = pending.catch(() => {}); return pending;
  }
  private day() { return new Intl.DateTimeFormat('en-CA', {timeZone:this.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  private async save() {
    await mkdir(this.dir,{recursive:true});
    await writeFile(join(this.dir,'state.tmp'), JSON.stringify(this.state));
    await rename(join(this.dir,'state.tmp'),join(this.dir,'state.json'));
  }
  async start(host: WorldHost) {
    this.host = host;
    try { this.state = JSON.parse(await readFile(join(this.dir,'state.json'),'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; this.state={cursor:host.store.latestCursor(),day:this.day(),count:0,items:[]}; }
    await this.save();
  }
  async stop() { await this.serial; this.host=undefined; }
  scan() { return this.lock(async()=>{
    if (!this.host) return;
    const day=this.day();const changedDay=this.state.day!==day; if(changedDay){this.state.day=day;this.state.count=0;}
    const latest=this.host.store.latestCursor(), cfg=this.config();
    if(latest===this.state.cursor&&!changedDay)return;
    const known=new Set(this.state.items.map(i=>i.id));
    for(const event of this.host.store.range({fromCursor:this.state.cursor+1,toCursor:latest})) {
      if(!cfg.collectEnabled || this.state.count>=cfg.collectDailyLimit || event.origin!=='external' || event.type.endsWith('.self')) continue;
      for(const blob of event.blobs ?? []) {
        if(this.state.count>=cfg.collectDailyLimit) break;
        if(!blob.mime.startsWith('image/')) continue;
        const image=this.host.blob(blob.handle); if(!image || image.bytes.length>25*1024*1024) continue;
        const bytes=Buffer.from(image.bytes);
        const mime=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':/^GIF8[79]a$/.test(bytes.subarray(0,6).toString())?'image/gif':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':'';
        if(!mime) continue;
        const id=createHash('sha256').update(bytes).digest('hex');
        if(known.has(id)||await this.library.hasDigest(id)) continue;
        await mkdir(join(this.dir,'images'),{recursive:true});
        await writeFile(join(this.dir,'images',id),bytes);
        this.state.items.push({id,mime,at:event.ts,source:event.source,cursor:event.cursor,status:'pending'});
        known.add(id);this.state.count++;
      }
    }
    this.state.cursor=latest; await this.save();
  }); }
  async list() { await this.serial; if(!this.state) throw new Error('Collection is not running');
    return {items:this.state.items.filter(i=>i.status==='pending'),today:this.state.day===this.day()?this.state.count:0,limit:this.config().collectDailyLimit}; }
  private item(id:string) { const item=this.state.items.find(i=>i.id===id);if(!item)throw new Error('Unknown collected image');return item; }
  async image(id:string) { await this.serial;const item=this.item(id);return {bytes:await readFile(join(this.dir,'images',item.id)),mime:item.mime}; }
  reject(id:string) { return this.lock(async()=>{const item=this.item(id);if(item.status!=='pending')throw new Error('Image already reviewed');item.status='rejected';await this.save();return {rejected:true};}); }
  markSaved(id: string, entryId: string) { return this.lock(async () => {
    const item = this.state.items.find(i => i.id === id);
    if (item) { item.status = 'approved'; item.entryId = entryId; await this.save(); }
  }); }
  approve(id:string,packId:string,category:string) { return this.lock(async()=>{
    const item=this.item(id);if(item.status==='rejected')throw new Error('Image already rejected');
    if(item.entryId)return item.entryId;
    const bytes=await readFile(join(this.dir,'images',item.id));
    item.entryId=await this.library.addCollected(bytes,item.mime,packId,category);item.status='approved';await this.save();return item.entryId;
  }); }
}
