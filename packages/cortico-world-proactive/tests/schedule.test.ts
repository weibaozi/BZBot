import { expect, it } from 'vitest';
import { LANGUAGES } from 'cortico/core/language.ts';
import { PROACTIVE_DEFAULTS, proactiveConfigGroup } from '../config.ts';
import { configError, localTime, nextTime, quietNow } from '../server/schedule.ts';
import { strings } from '../strings.ts';
const config = () => ({ ...structuredClone(PROACTIVE_DEFAULTS), targetQQ: '10001', quietEnabled: true });
it('handles overnight quiet hours and the exact boundaries in the deployment timezone', () => {
  const cfg = config();
  for (const [date, expected] of [['2026-01-01T14:59:00Z', false], ['2026-01-01T15:00:00Z', true], ['2026-01-01T23:59:00Z', true], ['2026-01-02T00:00:00Z', false]] as const) {
    expect(quietNow(cfg, Date.parse(date), 'Asia/Shanghai')).toBe(expected);
  }
  cfg.quietStart='09:00';cfg.quietEnd='12:00';
  expect(quietNow(cfg,Date.parse('2026-01-01T10:00:00Z'),'UTC')).toBe(true);
  cfg.quietEnd='09:00';
  expect(quietNow(cfg,Date.parse('2026-01-01T18:00:00Z'),'UTC')).toBe(true);
  cfg.quietEnabled=false;
  expect(quietNow(cfg,Date.parse('2026-01-01T18:00:00Z'),'UTC')).toBe(false);
});
it('uses local calendar days and DST offsets', () => {
  expect(localTime(Date.parse('2026-01-02T01:00:00Z'),'America/Phoenix').day).toBe('2026-01-01');
  expect(localTime(Date.parse('2026-03-08T10:00:00Z'),'America/Los_Angeles').minutes).toBe(180);
});
it('rejects malformed targets, reversed intervals and invalid quiet times', () => {
  const cfg=config(); expect(configError(cfg)).toBeNull();
  cfg.targetQQ='group:10001';expect(configError(cfg)).toBe('target');cfg.targetQQ='10001';
  cfg.intervalMinutes=[90,30];expect(configError(cfg)).toBe('interval');cfg.intervalMinutes=[30,90];
  cfg.quietStart='25:00';expect(configError(cfg)).toBe('quiet');
});
it('samples a bounded interval with no extra model invocation', () => {
  const cfg=config();
  for(let i=0;i<100;i++){ const next=nextTime(cfg,1000);expect(next).toBeGreaterThanOrEqual(1000+30*60000);expect(next).toBeLessThanOrEqual(1000+90*60000); }
});
it('declares hot settings and complete labels for all framework languages', () => {
  for(const language of LANGUAGES) {
    const labels=strings(language);for(const value of Object.values(labels))expect(value).toBeTruthy();
    for(const field of Object.values(proactiveConfigGroup(language).schema.properties))expect(field['x-hot']).toBe(true);
  }
});
