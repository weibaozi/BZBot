import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

async function exists(path: string) {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Run with the bot stopped. Dry-run by default; retries preserve the original config backup. */
export async function migrateQqextras(profileDir: string, apply = false) {
  const root = await realpath(resolve(profileDir));
  const configFile = join(root, 'config.json');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const oldData = join(root, 'qqextras', 'memes');
  const data = join(root, 'memes');
  const oldPrompt = join(root, 'prompts', 'QQEXTRAS.md');
  const prompt = join(root, 'prompts', 'MEMES.md');
  const changes = { config: Boolean(config.worlds?.qqextras), data: await exists(oldData), prompt: await exists(oldPrompt) && !await exists(prompt) };
  if (changes.config && config.worlds.memes !== undefined) throw new Error('Both worlds.qqextras and worlds.memes exist; resolve the conflict first');
  if (changes.data && await exists(data)) throw new Error('Both meme data directories exist; resolve the conflict first');
  for (const path of [oldData, data, configFile, oldPrompt, prompt]) {
    if (await exists(path) && !(await realpath(path)).startsWith(root + sep)) throw new Error('Migration path escapes the profile');
  }
  if (!apply) return { applied: false, changes };
  if (changes.config) {
    const backup = join(root, 'config.before-memes.json');
    if (!await exists(backup)) await copyFile(configFile, backup, constants.COPYFILE_EXCL);
    config.worlds.memes = config.worlds.qqextras;
    delete config.worlds.qqextras;
  }
  if (changes.data) await rename(oldData, data);
  if (changes.prompt) {
    const text = (await readFile(oldPrompt, 'utf8'))
      .replaceAll('qqextras_search_memes', 'search_meme').replaceAll('qqextras_get_meme', 'get_meme');
    await mkdir(join(root, 'prompts'), { recursive: true });
    await writeFile(prompt, text, { flag: 'wx' });
  }
  if (changes.config) {
    const staging = join(root, 'config.memes-staging.json');
    await writeFile(staging, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    await rename(staging, configFile);
  }
  return { applied: true, changes };
}
