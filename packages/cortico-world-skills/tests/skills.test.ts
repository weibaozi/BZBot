import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldContext } from 'cortico/world.ts';
import { readSkills } from '../library.ts';
import { SkillsWorld, type SkillsConfigSection } from '../world.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function library() {
  const root = mkdtempSync(join(tmpdir(), 'skills-')); dirs.push(root);
  const write = (id: string, text: string, extra: Record<string, string> = {}) => {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, 'SKILL.md'), text);
    for (const [file, body] of Object.entries(extra)) writeFileSync(join(root, id, file), body);
  };
  write('bilibili-video', '---\nname: 看B站视频\ndescription: 边播边截图\nrequires: mcp\n---\n## 步骤\n先打开视频页。\n', { 'notes.md': 'x' });
  write('tieba', '---\nname: 刷贴吧\ndescription: 读热帖\nrequires: [mcp, websearch]\n---\n读帖子。\n');
  write('chat-style', '---\ndescription: 说话的方式\n---\n少用感叹号。\n');
  mkdirSync(join(root, 'not-a-skill'));
  return root;
}

function world(root: string, mounted: string[] | null) {
  const ctx = { cfg: { enabled: true, dir: root }, botDir: root, ...(mounted ? { mountedWorlds: () => mounted } : {}) } as unknown as WorldContext<SkillsConfigSection>;
  return new SkillsWorld(ctx);
}
const read = (mod: SkillsWorld, skill: string) => mod.tools()[0].handler({ skill }, { role: 'main', log: undefined as never });

it('reads front matter, lists requirements and extra files, and skips folders without SKILL.md', () => {
  const skills = readSkills(library());
  expect(skills.map(skill => [skill.id, skill.name, skill.requires, skill.files])).toEqual([
    ['bilibili-video', '看B站视频', ['mcp'], ['notes.md']],
    ['chat-style', 'chat-style', [], []],
    ['tieba', '刷贴吧', ['mcp', 'websearch'], []],
  ]);
  expect(readSkills(join(tmpdir(), 'no-such-skills-folder'))).toEqual([]);
});

it('lists only skills whose Worlds are mounted, and refuses to read the others', async () => {
  const root = library();
  const bare = world(root, ['skills', 'console']);
  expect(bare.envPromptVars()['skills.list']).toBe('- chat-style：说话的方式');
  expect(await read(bare, 'bilibili-video')).toMatchObject({ failed: true, text: '[no such skill: bilibili-video] Available: chat-style' });

  const browsing = world(root, ['skills', 'mcp']);
  expect(browsing.envPromptVars()['skills.list']).toBe('- bilibili-video：边播边截图\n- chat-style：说话的方式');
  expect(await read(browsing, 'bilibili-video')).toBe('# 看B站视频\n边播边截图\n\n## 步骤\n先打开视频页。\n\nFiles in this skill: notes.md');
  expect(await read(browsing, '看B站视频')).toContain('先打开视频页');
});

it('picks up edits without a restart, and lists every skill when the host gives no mount list', async () => {
  const root = library();
  const mod = world(root, null);
  expect(mod.envPromptVars()['skills.list'].split('\n')).toHaveLength(3);
  writeFileSync(join(root, 'chat-style', 'SKILL.md'), '---\ndescription: 说话更短\n---\n一句话说完。\n');
  expect(mod.envPromptVars()['skills.list']).toContain('- chat-style：说话更短');
  expect(await read(mod, 'chat-style')).toContain('一句话说完');
});

it('the bundled Bilibili skill names only tools the browser World declares', () => {
  const skill = readSkills(fileURLToPath(new URL('../../../skills', import.meta.url))).find(item => item.id === 'bilibili-video')!;
  expect(skill.requires).toEqual(['browser']);
  // The installed cortico-world-browser package lists its tools in describe.json.
  const describe = fileURLToPath(new URL('../../../vendor/cortico/extensions/node_modules/cortico-world-browser/describe.json', import.meta.url));
  const declared = new Set((JSON.parse(readFileSync(describe, 'utf8')).tools as Array<{ name: string }>).map(tool => tool.name));
  for (const tool of new Set(skill.body.match(/browser_[a-z_]+/g))) expect(declared.has(tool), tool).toBe(true);
});
