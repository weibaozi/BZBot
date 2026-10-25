// Creates a deployment from deploy-template/home/: the bot folder plus model provider configs.
// Usage:  node scripts/new-deployment.mjs <deployment root> <name> [port]
// Never overwrites: an existing deployment or provider folder is left as it is.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [rootArg, name, portArg] = process.argv.slice(2);
if (!rootArg || !name) { console.error('usage: node scripts/new-deployment.mjs <deployment root> <name> [port]'); process.exit(1); }
const root = resolve(rootArg);
const template = fileURLToPath(new URL('../deploy-template/home/', import.meta.url));
const deployment = join(root, name);

if (existsSync(join(deployment, 'deployment.json'))) {
  console.log(`${deployment} already exists; left as is`);
} else {
  mkdirSync(deployment, { recursive: true });
  cpSync(join(template, 'bot'), deployment, { recursive: true });
  const file = join(deployment, 'config.json');
  const config = JSON.parse(readFileSync(file, 'utf8').replaceAll('{{DEPLOYMENT_DIR}}', deployment.replace(/\\/g, '/')));
  if (portArg) config.web = { ...(config.web ?? {}), port: Number(portArg) };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log(`created ${deployment}${portArg ? ` (port ${portArg})` : ''}`);
}

const providers = join(template, 'providers');
for (const provider of existsSync(providers) ? readdirSync(providers) : []) {
  const target = join(root, 'providers', provider);
  if (existsSync(target)) { console.log(`provider ${provider} already exists; left as is`); continue; }
  cpSync(join(providers, provider), target, { recursive: true });
  console.log(`added provider ${provider} (sign in or set its key in the WebUI)`);
}
