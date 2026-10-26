// Creates a deployment from deploy-template/home/: the bot folder plus model provider configs.
// Usage:  node scripts/new-deployment.mjs <deployment root> <name> [port]
// Never overwrites: an existing deployment or provider folder is left as it is.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [rootArg, name, portArg] = process.argv.slice(2);
if (!rootArg || !name) { console.error('usage: node scripts/new-deployment.mjs <deployment root> <name> [port]'); process.exit(1); }
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw Error('Use a simple deployment name (letters, digits, _ or -)');
if (portArg !== undefined && (!/^\d+$/.test(portArg) || Number(portArg)>65535)) throw Error('Port must be 0–65535');
const root = resolve(rootArg);
const template = fileURLToPath(new URL('../deploy-template/home/', import.meta.url));
const deployment = join(root, name);

if (existsSync(join(deployment, 'deployment.json'))) {
  console.log(`${deployment} already exists; left as is`);
} else {
  if (existsSync(deployment) && readdirSync(deployment).length) throw Error('Refusing to overwrite a non-empty deployment directory');
  mkdirSync(deployment, { recursive: true });
  cpSync(join(template, 'bot'), deployment, { recursive: true });
  const file = join(deployment, 'config.json');
  const config = JSON.parse(readFileSync(file, 'utf8').replaceAll('{{DEPLOYMENT_DIR}}', deployment.replace(/\\/g, '/')));
  const browser=config.worlds?.browser;
  if(browser?.ownBrowser && !browser.ownBrowserExe) {
    const candidates=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(base=>join(base,'Google','Chrome','Application','chrome.exe'));
    browser.ownBrowserExe=candidates.find(existsSync)??'';
    if(!browser.ownBrowserExe) { browser.enabled=false; console.log('Chrome not found: browser extension disabled; select its executable and enable it in WebUI.'); }
  }
  if (portArg) config.web = { ...(config.web ?? {}), port: Number(portArg) };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log(`created ${deployment}${portArg ? ` (port ${portArg})` : ''}`);
}

// Model configurations are intentionally not shipped. Add them in the model center.
