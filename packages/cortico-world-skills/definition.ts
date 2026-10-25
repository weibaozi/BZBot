import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { READ_SKILL_DECL, SKILLS_DEFAULTS, SkillsWorld, type SkillsConfigSection } from './world.ts';

export const SKILLS: WorldDefinition<SkillsConfigSection> = {
  id: 'skills', label: '技能', defaults: () => structuredClone(SKILLS_DEFAULTS), create: ctx => new SkillsWorld(ctx),
  describe: {
    tools: describeTools([READ_SKILL_DECL], { read_skill: { zh: '读一个技能：做某类事的步骤。', en: 'Reads one skill: the steps for a kind of task.' } }),
    events: [],
  },
};
