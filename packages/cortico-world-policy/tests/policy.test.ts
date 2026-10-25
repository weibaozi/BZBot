import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolicyStore } from '../server/layers.ts';
import { PolicyWorld } from '../world.ts';
import { POLICY_DEFAULTS } from '../config.ts';
import { NO_MODELS } from 'cortico/providers/model-hub.ts';
import { assembleSystem } from 'cortico/core/prefix.ts';
import { CortiSoulmate } from '../../../vendor/cortico/bots/corti-soulmate/persona/index.ts';
import { makeCfg, makeLoaded, FakeLLM } from '../../../vendor/cortico/tests/core/helpers.ts';
import { assembleBot } from '../../../vendor/cortico/bots/corti-soulmate/assemble.ts';
import { nullLogger } from 'cortico/core/util.ts';

const layer = (id: string, text: string, enabled = true) => ({ id, title: id, text, enabled });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-test-'));
  const world = new PolicyWorld({ id: 'policy', cfg: { ...POLICY_DEFAULTS, enabled: true }, timezone: 'UTC', botName: 'fixture',
    botDir: dir, packageDir: dir, dataDir: join(dir, 'data'), repoRoot: dir, models: NO_MODELS,
    secret: () => '', storeSecret: () => { throw new Error('No secrets'); }, persist: () => { throw new Error('No config writes'); }, restart: async () => {} });
  return { dir, world, store: world.store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('operator rules', () => {
  it('keeps a live isolated session frozen and lets the real dream inherit its rules', async () => {
    const f = fixture(), cfg = makeCfg(), llm = new FakeLLM();
    for (const section of Object.values(cfg.worlds)) section.enabled = false;
    cfg.web.port = 0; cfg.tick.dayIntervalMinutes = [999, 999]; cfg.tick.nightIntervalMinutes = null;
    const bot = assembleBot(makeLoaded({ config: cfg, rootDir: f.dir, memoryDir: join(f.dir, 'memory'), dataDir: join(f.dir, 'data') }), { llm });
    try {
      const saved = f.store.save(f.store.read().revision, [layer('static', 'ORIGINAL POLICY')]);
      await bot.start(); bot.core.bus.setPaused(true);
      await bot.core.mountWorld(f.world);
      const snapshot = [...bot.core.session.records];
      expect(JSON.stringify(snapshot[0])).toContain('ORIGINAL POLICY');
      f.store.save(saved.revision, [layer('new', 'NEXT POLICY')]);
      expect(bot.core.session.records).toEqual(snapshot);
      await bot.dream.schedule(snapshot);
      expect(llm.calls.length).toBeGreaterThan(0);
      expect(JSON.stringify(llm.calls.at(-1)!.messages[0])).toContain('ORIGINAL POLICY');
      expect(JSON.stringify(llm.calls.at(-1)!.messages[0])).not.toContain('NEXT POLICY');
      await bot.core.loop.reloadSystemPrefix();
      expect(JSON.stringify(bot.core.session.records[0])).toContain('NEXT POLICY');
      expect(JSON.stringify(bot.core.session.records[0])).not.toContain('ORIGINAL POLICY');
      await bot.core.unmountWorld('policy');
      expect(JSON.stringify(bot.core.session.records[0])).not.toContain('NEXT POLICY');
    } finally { await bot.stop(); f.cleanup(); }
  }, 15000);
  it('persists ordered, enabled layers literally and rejects stale editors', () => {
    const f = fixture();
    try {
      const initial = f.store.read();
      expect(initial.preview).toBe('');
      const saved = f.store.save(initial.revision, [layer('b', '{{literal}}\nB'), layer('off', 'hidden', false), layer('a', 'A')]);
      expect(new PolicyStore(f.store.file).read()).toEqual(saved);
      expect(saved.preview).toBe('{{literal}}\nB\n\nA\n\n');
      expect(() => f.store.save(initial.revision, [])).toThrow('another editor');
      const ordered = f.store.save(saved.revision, [saved.layers[2], saved.layers[0]]);
      expect(ordered.preview).toBe('A\n\n{{literal}}\nB\n\n');
      expect(f.store.save(ordered.revision, []).preview).toBe('');
    } finally { f.cleanup(); }
  });
  it('does not overwrite invalid documents or accept duplicate layers', () => {
    const f = fixture();
    try {
      const initial = f.store.read();
      expect(() => f.store.save(initial.revision, [layer('same', 'a'), layer('same', 'b')])).toThrow('duplicate');
      expect(() => f.store.save(initial.revision, [layer('large', 'x'.repeat(200001))])).toThrow('200,000');
      expect(f.store.read()).toEqual(initial);
      mkdirSync(join(f.dir, 'policy')); writeFileSync(f.store.file, '{broken');
      expect(() => f.world.leadingSystemSegments()).toThrow();
      expect(() => f.store.save(initial.revision, [])).toThrow();
      expect(readFileSync(f.store.file, 'utf8')).toBe('{broken');
    } finally { f.cleanup(); }
  });
  it('places rules between orientation and constitution and only changes newly assembled prefixes', async () => {
    const f = fixture();
    try {
      const persona = new CortiSoulmate({ cfg: makeCfg(), memoryDir: join(f.dir, 'memory') });
      const deps = { persona, worlds: [f.world], now: new Date(), timezone: 'UTC' };
      const base = await assembleSystem({ ...deps, worlds: [] });
      let state = f.store.save(f.store.read().revision, [layer('one', 'FIRST'), layer('two', 'SECOND')]);
      const frozen = await assembleSystem(deps);
      expect(frozen.indexOf('ORIENTATION')).toBeLessThan(frozen.indexOf('FIRST'));
      expect(frozen.indexOf('FIRST')).toBeLessThan(frozen.indexOf('SECOND'));
      expect(frozen.indexOf('SECOND')).toBeLessThan(frozen.indexOf('━━━ 宪法'));
      expect(frozen.replace('FIRST\n\nSECOND\n\n', '')).toBe(base);
      state = f.store.save(state.revision, [layer('changed', 'REVISED')]);
      expect(frozen).toContain('FIRST\n\nSECOND\n\n');
      const rebuilt = await assembleSystem(deps);
      expect(rebuilt.indexOf('ORIENTATION')).toBeLessThan(rebuilt.indexOf('REVISED'));
      expect(rebuilt.indexOf('REVISED')).toBeLessThan(rebuilt.indexOf('━━━ 宪法'));
      expect(rebuilt.replace('REVISED\n\n', '')).toBe(base);
      expect(await assembleSystem({ ...deps, worlds: [] })).toBe(base);
      expect(f.world.tools()).toEqual([]);
      expect(f.world.leadingSystemSegments().every(segment => !segment.sourceKey)).toBe(true);
    } finally { f.cleanup(); }
  });
  it('keeps the operator file outside main and dream file-tool write access', async () => {
    const f = fixture();
    try {
      f.store.save(f.store.read().revision, [layer('locked', 'KEEP')]);
      const original = readFileSync(f.store.file, 'utf8');
      const persona = new CortiSoulmate({ cfg: makeCfg(), memoryDir: join(f.dir, 'memory') });
      for (const session of persona.declareSessions()) {
        const tools = typeof session.tools === 'function' ? session.tools() : session.tools;
        const write = tools.find(tool => tool.name === 'write_file')!;
        for (const path of ['../policy/layers.json', f.store.file]) {
          const result = await write.handler({ path, content: 'REPLACE' }, { role: session.id, log: nullLogger() });
          expect(JSON.stringify(result)).toMatch(/error|fail|outside|absolute|invalid|\.\./i);
          expect(readFileSync(f.store.file, 'utf8')).toBe(original);
        }
      }
    } finally { f.cleanup(); }
  });
  it('isolates deployments and exposes edits only through the management panel', async () => {
    const f = fixture(), other = fixture();
    try {
      const ui = f.world.webUi();
      await ui.invoke('layers', 'save', [f.store.read().revision, [layer('private', 'DEPLOYMENT A')]]);
      expect(other.world.leadingSystemSegments()).toEqual([]);
      await expect(ui.invoke('layers', 'write_file', [])).rejects.toThrow('Unknown method');
      await expect(ui.invoke('wrong', 'save', [])).rejects.toThrow('Unknown panel');
      expect(f.world.tools()).toEqual([]);
    } finally { f.cleanup(); other.cleanup(); }
  });
});
