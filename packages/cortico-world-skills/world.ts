import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigGroup, ToolDef, World } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldContext, WorldSection } from 'cortico/world.ts';
import { available, readSkills, type Skill } from './library.ts';

export interface SkillsConfigSection extends WorldSection {
  enabled: boolean;
  /** Absolute folder of skills; empty uses the repository's `skills/`. */
  dir: string;
}

export const SKILLS_DEFAULTS: SkillsConfigSection = { enabled: false, dir: '' };
/** The repository's shared skills, next to `packages/`. */
const REPO_SKILLS = fileURLToPath(new URL('../../skills', import.meta.url));

export const READ_SKILL_DECL: Omit<ToolDef, 'handler'> = {
  name: 'read_skill',
  description: 'Read one of your skills: how to do a kind of task, step by step. Read it before doing that task, then follow it.',
  tags: ['read'],
  parameters: { type: 'object', properties: { skill: { type: 'string', description: 'The skill id shown in your skill list.' } }, required: ['skill'] },
};

/**
 * Shared how-to guides. The list names only skills whose required Worlds are mounted, so the persona never
 * reads about a way of working it has no tools for. Skills are read each time, so edits apply without a restart.
 */
export class SkillsWorld implements World {
  readonly id = 'skills';
  constructor(private readonly ctx: WorldContext<SkillsConfigSection>) {}

  private root(): string {
    const dir = this.ctx.cfg.dir.trim();
    return dir && isAbsolute(dir) ? dir : resolve(REPO_SKILLS);
  }
  private usable(): Skill[] { return available(readSkills(this.root()), this.ctx.mountedWorlds?.()); }

  envPromptVars() {
    return { 'skills.list': this.usable().map(skill => `- ${skill.id}：${skill.description || skill.name}`).join('\n') };
  }
  async start() {}
  async stop() {}

  tools(): ToolDef[] {
    return [{ ...READ_SKILL_DECL, handler: async (args) => {
      const id = typeof args.skill === 'string' ? args.skill.trim() : '';
      const skills = this.usable();
      const skill = skills.find(item => item.id === id || item.name === id);
      if (!skill) return { text: `[no such skill: ${id || '(empty)'}] Available: ${skills.map(item => item.id).join(', ') || 'none'}`, failed: true };
      const files = skill.files.length ? `\n\nFiles in this skill: ${skill.files.join(', ')}` : '';
      return `# ${skill.name}\n${skill.description}\n\n${skill.body}${files}`;
    } }];
  }

  webUi(language: Language = 'zh') {
    const zh = language.startsWith('zh');
    const override = join(this.ctx.botDir, 'prompts', 'worlds', 'skills', 'ENV_PROMPT.md');
    const config: ConfigGroup = { id: 'world:skills', owner: 'world:skills', schema: { type: 'object', title: zh ? '技能' : 'Skills', properties: {
      'worlds.skills.dir': { type: 'string', title: zh ? '技能目录' : 'Skills folder', 'x-path': { kind: 'directory' }, 'x-hot': true,
        description: zh ? '每个技能一个文件夹，内含 SKILL.md。留空使用仓库的 skills/。' : 'One folder per skill holding SKILL.md. Empty uses the repository skills/.' },
    } } };
    return {
      config: [config],
      promptDocs: [{ key: 'worlds.skills.environment', title: zh ? '技能 · 环境提示词' : 'Skills · environment prompt',
        description: zh ? '告诉她会哪些技能、怎么用。' : 'Tells the persona which skills it has and how to use them.',
        path: existsSync(override) ? override : fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), deploymentPath: override, role: 'envPrompt' as const,
        vars: [{ name: 'skills.list', description: zh ? '可用技能，每行「id：一句话说明」。' : 'Available skills, one "id: summary" per line.' }] }],
    };
  }
}
