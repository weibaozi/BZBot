import type { ProactiveConfigSection } from '../config.ts';
export function configError(cfg: ProactiveConfigSection): string | null {
  if (!/^[1-9]\d{4,15}$/.test(cfg.targetQQ)) return 'target';
  const [min, max] = cfg.intervalMinutes;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min || max > 10080) return 'interval';
  if (cfg.quietEnabled && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.quietStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.quietEnd))) return 'quiet';
  return null;
}
export function localTime(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
export function quietNow(cfg: ProactiveConfigSection, now: number, timezone: string): boolean {
  if (!cfg.quietEnabled) return false;
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const start = minutes(cfg.quietStart), end = minutes(cfg.quietEnd), current = localTime(now, timezone).minutes;
  return start === end || (start < end ? current >= start && current < end : current >= start || current < end);
}
export function nextTime(cfg: ProactiveConfigSection, now: number): number {
  const [min, max] = cfg.intervalMinutes;
  return now + (min + Math.random() * (max - min)) * 60000;
}
