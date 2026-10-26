import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { World, WorldHost, RunPhase } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext } from 'cortico/world.ts';
import { proactiveConfigGroup, type ProactiveConfigSection } from './config.ts';
import { configError, localTime, nextTime, quietNow } from './server/schedule.ts';
import { readState, writeState, type ProactiveState } from './server/state.ts';
import { strings } from './strings.ts';
import { registerDeliveryHint } from 'cortico/worlds/delivery-hints.ts';
import { ContactTime } from './server/contact-time.ts';

export class ProactiveWorld implements World {
  readonly id = 'proactive';
  private host?: WorldHost;
  private releaseContactTime?: () => void;
  private contactTime?: ContactTime;
  private state!: ProactiveState;
  private timer?: ReturnType<typeof setInterval>;
  private queued = false;
  private revision = 0;
  private intervalKey = '';
  private phase: RunPhase['state'] = 'idle';
  private readonly path: string;
  constructor(private readonly ctx: WorldContext<ProactiveConfigSection>) { this.path = join(ctx.dataDir, 'proactive', 'state.json'); }
  envPromptVars() { return {}; }
  tools() { return []; }
  private save() { writeState(this.path, this.state); }
  private fresh(now: number): ProactiveState {
    return { version: 1, target: this.ctx.cfg.targetQQ, cursor: this.host!.store.latestCursor(), lastIncomingAt: null,
      lastActivityAt: now, nextAt: nextTime(this.ctx.cfg, now), unanswered: 0, day: localTime(now, this.ctx.timezone).day,
      sentToday: 0, attempt: null, lastOutcome: 'none' };
  }
  async start(host: WorldHost) {
    this.host = host;
    const now = Date.now();
    this.state = readState(this.path) ?? this.fresh(now);
    this.intervalKey = JSON.stringify(this.ctx.cfg.intervalMinutes);
    this.sync(now);
    // Reconcile confirmed sends before clearing an interrupted attempt. Never replay overdue reminders.
    this.state.attempt = null;
    if (this.state.nextAt <= now) this.state.nextAt = nextTime(this.ctx.cfg, now);
    this.save();
    const contactTime = this.contactTime = new ContactTime(join(this.ctx.dataDir, 'proactive', 'contacts.json'), this.ctx.timezone,
      () => this.ctx.globals?.().trustedQQ ?? [], host.store, () => this.ctx.cfg.contactGapHours ?? 1);
    this.releaseContactTime = registerDeliveryHint(this.ctx.botDir, 'proactive.contact-time', contactTime.hint);
    this.timer = setInterval(() => {
      try { this.pulse(); } catch (error) { host.log.error('proactive scheduler failed', { error: String(error) }); }
    }, 1000);
    this.timer.unref();
  }
  async stop() {
    this.releaseContactTime?.(); this.releaseContactTime = undefined;
    clearInterval(this.timer); this.timer = undefined; this.revision++; this.queued = false;
    if (this.host) { this.sync(Date.now()); this.save(); }
    this.host = undefined;
  }
  onRunPhase(phase: RunPhase) { this.phase = phase.state; }
  onTurnEnded() {
    if (!this.host) return;
    this.sync(Date.now());
    if (this.state.attempt) {
      this.state.lastOutcome = this.state.attempt.counted ? 'sent' : 'silent';
      this.state.attempt = null;
      this.state.nextAt = nextTime(this.ctx.cfg, Date.now());
      this.save();
    }
  }
  private sync(now: number) {
    if (!this.host) return;
    this.contactTime?.sync();
    const before = JSON.stringify(this.state);
    if (this.state.target !== this.ctx.cfg.targetQQ) {
      this.state = this.fresh(now); this.revision++; this.queued = false;
    }
    const intervalKey = JSON.stringify(this.ctx.cfg.intervalMinutes);
    if (intervalKey !== this.intervalKey) {
      this.intervalKey = intervalKey; this.state.nextAt = nextTime(this.ctx.cfg, now); this.revision++; this.queued = false;
    }
    // Scan by cursor, not timestamps: QQ timestamps can be rounded or delayed.
    const latest = this.host.store.latestCursor();
    for (const event of this.host.store.range({ fromCursor: this.state.cursor + 1, toCursor: latest, source: 'qq' })) {
      const conv = event.meta?.conv as { kind?: string; id?: number } | undefined;
      if (conv?.kind !== 'private' || String(conv.id) !== this.state.target) continue;
      const at = Date.parse(event.ts);
      if (event.type === 'qq.message') {
        this.state.lastIncomingAt = at; this.state.lastActivityAt = at; this.state.unanswered = 0;
        this.state.attempt = null; this.state.nextAt = nextTime(this.ctx.cfg, Math.max(now, at));
        this.revision++; this.queued = false;
      } else if (event.type === 'qq.self') {
        if (this.state.attempt && !this.state.attempt.counted) {
          const day = localTime(at, this.ctx.timezone).day;
          if (day !== this.state.day) { this.state.day = day; this.state.sentToday = 0; }
          this.state.attempt.counted = true; this.state.unanswered++; this.state.sentToday++;
          this.state.lastOutcome = 'sent';
        }
        this.state.lastActivityAt = at;
        this.state.nextAt = nextTime(this.ctx.cfg, Math.max(now, at));
      }
    }
    this.state.cursor = latest;
    const day = localTime(now, this.ctx.timezone).day;
    if (day !== this.state.day) { this.state.day = day; this.state.sentToday = 0; }
    if (before !== JSON.stringify(this.state)) this.save();
  }
  private reason(now: number): 'disabled' | 'invalid' | 'quietNow' | 'limit' | null {
    if (!this.host || !this.ctx.cfg.active) return 'disabled';
    if (configError(this.ctx.cfg)) return 'invalid';
    if (quietNow(this.ctx.cfg, now, this.ctx.timezone)) return 'quietNow';
    if (this.state.unanswered >= this.ctx.cfg.maxUnanswered || this.state.sentToday >= this.ctx.cfg.dailyLimit) return 'limit';
    return null;
  }
  /** The timer and operator action use the same eligibility checks and deferred rendering. */
  pulse(immediate = false): boolean {
    if (!this.host) return false;
    const now = Date.now(); this.sync(now);
    if (this.reason(now) || this.queued || this.state.attempt || this.phase !== 'idle' || (!immediate && now < this.state.nextAt)) return false;
    this.queued = true;
    const revision = this.revision;
    this.host.pushDeferred({ type: 'proactive.due', origin: 'internal', senderKey: 'proactive', render: () => {
      this.sync(Date.now());
      if (revision !== this.revision) return null;
      this.queued = false;
      if (this.reason(Date.now()) || this.state.attempt) return null;
      const at = Date.now();
      this.state.attempt = { at, counted: false }; this.state.nextAt = nextTime(this.ctx.cfg, at); this.save();
      return `[proactive.due] 这是一条内部提醒，不是用户消息。目标 QQ 私聊 private:${this.state.target}。` +
        `当前时间 ${new Date(at).toISOString()}，部署时区 ${this.ctx.timezone}。距离最近记录的交互约 ${Math.max(0, Math.round((at - this.state.lastActivityAt) / 60000))} 分钟。` +
        `连续主动发送后未回复 ${this.state.unanswered} 次，今日主动发送 ${this.state.sentToday} 次。` +
        `请结合现有上下文考虑自然地联系对方；不合适可以保持沉默。此提醒有效至 ${new Date(at + 5 * 60000).toISOString()}，若对方已发新消息则改为正常回复。` +
        '若配图，先 search_meme 再用 qq_send 一次提交文字和候选 image；没有图也可以只发文字。';
    } }, { trigger: 'flush' });
    return true;
  }
  status() {
    if (this.host) this.sync(Date.now());
    return { status: this.reason(Date.now()) ?? (this.queued || this.state?.attempt ? 'pending' : 'idle'),
      timezone: this.ctx.timezone, target: this.ctx.cfg.targetQQ, nextAt: this.state?.nextAt ?? null,
      unanswered: this.state?.unanswered ?? 0, sentToday: this.state?.sentToday ?? 0, lastOutcome: this.state?.lastOutcome ?? 'none' };
  }
  webUi(language: Language = 'zh') {
    const t = strings(language), override = join(this.ctx.botDir, 'prompts', 'PROACTIVE.md');
    return { label: t.title, config: [proactiveConfigGroup(language)], panels: [{ id: 'status', title: t.status }],
      promptDocs: [{ key: 'worlds.proactive.environment', title: t.title, description: t.description,
        path: existsSync(override) ? override : fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), deploymentPath: override, role: 'envPrompt' as const }],
      invoke: async (panel: string, method: string) => {
        if (panel !== 'status') throw new Error('Unknown panel');
        if (method === 'state') return this.status();
        if (method === 'trigger') { if (!this.pulse(true)) throw new Error(t[this.status().status as 'idle'] ?? t.pending); return this.status(); }
        if (method === 'postpone') {
          if (!this.host) throw new Error(t.disabled);
          this.sync(Date.now()); this.revision++; this.queued = false;
          this.state.nextAt = nextTime(this.ctx.cfg, Date.now()); this.save(); return this.status();
        }
        throw new Error('Unknown method');
      },
    };
  }
}
