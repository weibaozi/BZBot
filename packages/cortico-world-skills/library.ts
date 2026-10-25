import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One skill: a folder holding `SKILL.md`, its front matter naming it, saying what it does and which Worlds it needs. */
export interface Skill {
  /** Folder name; what `read_skill` takes. */
  id: string;
  name: string;
  description: string;
  /** World ids that must be mounted for the skill to make sense. */
  requires: string[];
  /** `SKILL.md` without its front matter. */
  body: string;
  /** Other files in the folder, for the skill to point at. */
  files: string[];
}

/** `key: value` lines between `---` fences; a value in `[a, b]` or `a, b` form becomes a list. */
function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

const list = (value: string | undefined) => (value ?? '').replace(/^\[|\]$/g, '').split(',').map(item => item.trim()).filter(Boolean);

/** Every skill under `root`, sorted by folder name. Folders without `SKILL.md` are not skills; a missing root has none. */
export function readSkills(root: string): Skill[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(root, entry.name, 'SKILL.md')))
    .map(entry => {
      const dir = join(root, entry.name);
      const { fields, body } = frontMatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
      return {
        id: entry.name,
        name: fields.name || entry.name,
        description: fields.description ?? '',
        requires: list(fields.requires),
        body: body.trim(),
        files: readdirSync(dir).filter(file => file !== 'SKILL.md' && !file.startsWith('.')),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The skills whose required Worlds are all mounted; with no mount list every skill counts. */
export function available(skills: readonly Skill[], mounted: readonly string[] | undefined): Skill[] {
  if (!mounted) return [...skills];
  return skills.filter(skill => skill.requires.every(id => mounted.includes(id)));
}
