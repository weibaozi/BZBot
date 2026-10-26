import type { EventEnvelope, WorldHost } from 'cortico/core/types.ts';

function conversation(event: EventEnvelope): string {
  const conv = event.meta?.conv as { kind?: string; id?: number | string } | undefined;
  return conv?.kind && conv.id !== undefined ? `${conv.kind}:${conv.id}` : '';
}

/** Authorization comes from delivered events, never model-supplied sender IDs. */
export class SaveAccess {
  private grant?: { user: string; conv: string; at: number };
  constructor(private trusted: () => readonly string[]) {}
  clear() { this.grant = undefined; }
  deliver(events: readonly EventEnvelope[], host: WorldHost) {
    this.clear();
    const messages: EventEnvelope[] = [];
    for (const event of events) {
      if (event.origin !== 'external') continue;
      if (event.source !== 'qq') return;
      if (event.type === 'qq.message') messages.push(event);
      else if (event.type === 'qq.group_context') {
        const cursors = event.meta?.triggerMessageCursors;
        if (!Array.isArray(cursors) || !cursors.length) return;
        for (const cursor of cursors) {
          if (!Number.isInteger(cursor)) return;
          const row = host.store.range({ fromCursor: cursor, toCursor: cursor })[0];
          if (!row || row.source !== 'qq' || row.origin !== 'external' || row.type !== 'qq.message') return;
          messages.push(row);
        }
      }
    }
    const now = Date.now();
    if (!messages.length || messages.some(e => !this.trusted().includes(String(e.meta?.user_id)) || !conversation(e)
      || !Number.isFinite(Date.parse(e.ts)) || now - Date.parse(e.ts) > 300000 || Date.parse(e.ts) > now + 60000)) return;
    if (new Set(messages.map(e => `${e.meta?.user_id}/${conversation(e)}`)).size !== 1) return;
    this.grant = { user: String(messages[0].meta?.user_id), conv: conversation(messages[0]), at: now };
  }
  image(handle: unknown, role: string, host: WorldHost) {
    const grant = this.grant;
    if (role !== 'main' || !grant || Date.now() - grant.at > 300000 || !this.trusted().includes(grant.user))
      throw new Error('save_meme requires a current request from a globally trusted QQ user');
    if (typeof handle !== 'string' || !handle.startsWith('log:')) throw new Error('Use the exact log: image handle from the conversation');
    const source = host.store.range({ source: 'qq' }).find(e => e.origin === 'external' && !e.type.endsWith('.self')
      && conversation(e) === grant.conv && e.blobs?.some(b => b.handle === handle && b.mime.startsWith('image/')));
    const image = source && host.blob(handle);
    if (!image) throw new Error('Image must be a received image in the current conversation');
    const bytes = Buffer.from(image.bytes);
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Image exceeds 25 MiB');
    const mime = bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ? 'image/png'
      : bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')) ? 'image/jpeg'
      : /^GIF8[79]a$/.test(bytes.subarray(0,6).toString()) ? 'image/gif'
      : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : '';
    if (!mime) throw new Error('Unsupported image format');
    return { bytes, mime };
  }
}
