import { LANGUAGES } from 'cortico/core/language.ts';
import { expect, it } from 'vitest';
import { MEMES_DEFAULTS, memesConfigGroup } from '../config.ts';
import { proactiveHint, PROACTIVE_HINT } from '../server/proactive.ts';
import type { EventEnvelope } from 'cortico/core/types.ts';
const message: EventEnvelope = { cursor: 1, type: 'qq.message', ts: '2026-01-01T00:00:00Z', source: 'qq', origin: 'external', text: 'hello' };
it('uses the configured threshold without requiring a model or changing input events', () => {
  const cfg = structuredClone(MEMES_DEFAULTS.memes);
  expect(cfg.proactiveSearchPercent).toBe(50);
  expect(proactiveHint(cfg, [message], 0.499)).toBe(PROACTIVE_HINT);
  expect(proactiveHint(cfg, [message], 0.5)).toBeNull();
  cfg.proactiveSearchPercent = 0;
  expect(proactiveHint(cfg, [message], 0)).toBeNull();
  cfg.proactiveSearchPercent = 100;
  expect(proactiveHint(cfg, [message, message], 0.999)).toBe(PROACTIVE_HINT);
  expect(message.text).toBe('hello');
});
it('does not prompt on tool receipts, timers, disabled features or disabled image selection', () => {
  const cfg = { ...MEMES_DEFAULTS.memes, proactiveSearchPercent: 100 };
  for (const type of ['qq.self', 'memes.hint', 'tick', 'notice']) expect(proactiveHint(cfg, [{ ...message, type }], 0)).toBeNull();
  expect(proactiveHint({ ...cfg, enabled: false }, [message], 0)).toBeNull();
  expect(proactiveHint({ ...cfg, maxMemes: 0 }, [message], 0)).toBeNull();
  expect(proactiveHint(cfg, [], 0)).toBeNull();
  expect(memesConfigGroup('zh').schema.properties!['worlds.memes.memes.proactiveSearchPercent']).toMatchObject({ minimum: 0, maximum: 100, 'x-hot': true });
});

it('declares the reminder setting in all supported languages', () => {
  const fields = LANGUAGES.map(language => memesConfigGroup(language).schema.properties!['worlds.memes.memes.proactiveSearchPercent']);
  expect(new Set(fields.map(field => field.title)).size).toBe(LANGUAGES.length);
  for (const field of fields) expect(field.description).toBeTruthy();
});

it.each([false, true])('samples admitted QQ group batches using the meme probability (forced mention: %s)', forcedMention => {
 const group: EventEnvelope = { ...message, type: 'qq.group_context', meta: { forcedMention, conv: { kind: 'group', id: 424242 } } };
 const cfg = { ...MEMES_DEFAULTS.memes, proactiveSearchPercent: 25 };
 expect(proactiveHint(cfg, [group], 0.249)).toBe(PROACTIVE_HINT);
 expect(proactiveHint(cfg, [group], 0.25)).toBeNull();
 expect(proactiveHint({ ...cfg, proactiveSearchPercent: 0 }, [group], 0)).toBeNull();
 expect(proactiveHint({ ...cfg, proactiveSearchPercent: 100 }, [group, group, message], 0.999)).toBe(PROACTIVE_HINT);
 expect(proactiveHint({ ...cfg, enabled: false }, [group], 0)).toBeNull();
 expect(proactiveHint({ ...cfg, maxMemes: 0 }, [group], 0)).toBeNull();
});
it('ignores archived group messages, trigger tickets, and another source claiming a QQ snapshot', () => {
 const cfg = { ...MEMES_DEFAULTS.memes, proactiveSearchPercent: 100 };
 expect(proactiveHint(cfg, [{ ...message, contextDelivery: 'archive-only' }], 0)).toBeNull();
 expect(proactiveHint(cfg, [{ ...message, type: 'qq.group_trigger' }], 0)).toBeNull();
 expect(proactiveHint(cfg, [{ ...message, type: 'qq.group_context', source: 'other' }], 0)).toBeNull();
});
