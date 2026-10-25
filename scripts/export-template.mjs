// Turns a running deployment into deploy-template/: the same Worlds and settings, with nothing personal.
// Usage:  node scripts/export-template.mjs <deployment dir> [<deployment root>]
//   e.g.  node scripts/export-template.mjs G:/study/AI/myBot-data/yuki
// The deployment root (holding providers/) defaults to the deployment's parent folder.
//
// Cleared: whitelists, QQ numbers / groups / connection and token, the proactive chat target, agenda entries.
// Not copied: memory/ (persona prompt and everything she remembers), data/, the meme library, browser profile,
// .env files and sign-in folders. Kept: config.json otherwise, deployment.json, policy layers, World prompt overrides,
// and each model provider's config.json (it names its key's environment variable; the key itself stays in .env).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [deployArg, rootArg] = process.argv.slice(2);
if (!deployArg) { console.error('usage: node scripts/export-template.mjs <deployment dir> [<deployment root>]'); process.exit(1); }
const deployment = resolve(deployArg);
const root = resolve(rootArg ?? dirname(deployment));
const out = fileURLToPath(new URL('../deploy-template/', import.meta.url));
const home = join(out, 'home');

/** Placeholder the setup script replaces with the new deployment's folder. */
const DEPLOYMENT_DIR = '{{DEPLOYMENT_DIR}}';

const original = JSON.parse(readFileSync(join(deployment, 'config.json'), 'utf8'));
const config = structuredClone(original);
const worlds = config.worlds ?? {};
const clear = (section, key, value) => { if (section && key in section) section[key] = value; };
clear(config.globals, 'trustedQQ', '');
clear(worlds.delegate, 'allowedQQ', '');
clear(worlds.visual, 'savers', '');
if (worlds.visual) delete worlds.visual.dir;
clear(worlds.proactive, 'targetQQ', '');
clear(worlds.agenda, 'entries', []);
if (worlds.qq) {
  worlds.qq.groups = [];
  worlds.qq.privates = [];
  // Connection address and token fall back to the QQ World's defaults; the token is a secret.
  delete worlds.qq.wsUrl;
  delete worlds.qq.token;
}
if (worlds.browser && 'ownBrowserHome' in worlds.browser) worlds.browser.ownBrowserHome = `${DEPLOYMENT_DIR}/browser-home`;

// Refuse to write anything that still looks personal or secret.
// Every QQ number the deployment knows: whitelists, the proactive target, and the QQ roster.
const personal = new Set();
const ow = original.worlds ?? {};
for (const list of [original.globals?.trustedQQ, ow.delegate?.allowedQQ, ow.visual?.savers, ow.proactive?.targetQQ]) {
  for (const id of String(list ?? '').split(/[\s,，;；]+/)) if (/^\d{5,12}$/.test(id)) personal.add(id);
}
for (const entry of [...(ow.qq?.privates ?? []), ...(ow.qq?.groups ?? [])]) if (entry?.id) personal.add(String(entry.id));
function check(name, text) {
  for (const id of personal) if (text.includes(id)) throw new Error(`${name} still contains ${id}; add it to the cleared fields`);
  for (const m of text.matchAll(/"(token|apiKey|key|password|secretValue)"\s*:\s*"([^"]+)"/gi)) {
    throw new Error(`${name} has a non-empty "${m[1]}"; secrets must stay out of the repo`);
  }
}

rmSync(home, { recursive: true, force: true });
const bot = join(home, 'bot');
mkdirSync(bot, { recursive: true });
const configText = JSON.stringify(config, null, 2) + '\n';
check('config.json', configText);
writeFileSync(join(bot, 'config.json'), configText);
copyFileSync(join(deployment, 'deployment.json'), join(bot, 'deployment.json'));

/** Copies a file if present, after the same personal-data check. */
function keep(from, to) {
  if (!existsSync(from)) return;
  const text = readFileSync(from, 'utf8');
  check(to, text);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, text);
}
keep(join(deployment, 'policy', 'layers.json'), join(bot, 'policy', 'layers.json'));
// World prompt overrides are settings; persona prompts live in memory/ and are not copied.
if (existsSync(join(deployment, 'worlds'))) {
  for (const world of readdirSync(join(deployment, 'worlds'))) {
    keep(join(deployment, 'worlds', world, 'ENV_PROMPT.md'), join(bot, 'worlds', world, 'ENV_PROMPT.md'));
  }
}
if (existsSync(join(root, 'providers'))) {
  for (const provider of readdirSync(join(root, 'providers'))) {
    keep(join(root, 'providers', provider, 'config.json'), join(home, 'providers', provider, 'config.json'));
  }
}

const listed = [];
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else listed.push(p.slice(out.length).replace(/\\/g, '/')); } };
walk(home);
console.log(`deploy-template/ written from ${deployment}:\n  ${listed.join('\n  ')}`);
