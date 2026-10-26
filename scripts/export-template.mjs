// Export public defaults only. No model connections, credentials, identities or runtime data.
// node scripts/export-template.mjs <deployment> [--web-url http://127.0.0.1:7777] [--out <directory>]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function sanitizeConfig(original) {
  const config = structuredClone(original);
  delete config.providers; delete config.sources; delete config.modelSources;
  config.activeProvider = '';
  const visit = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (/^(model|.*Model|.*Provider|apiKey|token|password|secretValue|accessToken|refreshToken)$/i.test(key) && typeof value === 'string') obj[key] = '';
      else visit(value);
    }
  };
  visit(config);
  const worlds = config.worlds ??= {};
  config.globals = {...config.globals, trustedQQ: ''};
  for (const [world,key,value] of [['delegate','allowedQQ',''],['visual','savers',''],['proactive','targetQQ',''],['agenda','entries',[]]]) {
    if (worlds[world]) worlds[world][key] = value;
  }
  if (worlds.qq) { worlds.qq.groups=[]; worlds.qq.privates=[]; delete worlds.qq.wsUrl; delete worlds.qq.token; }
  if (worlds.visual) delete worlds.visual.dir;
  if (worlds.memes?.memes) { delete worlds.memes.memes.embeddingProvider; worlds.memes.memes.pythonFile='python'; }
  if (worlds.delegate) { worlds.delegate.workspaceDir=''; worlds.delegate.writableDirs=''; worlds.delegate.executableFile=''; }
  if (worlds.browser) { worlds.browser.ownBrowserHome='browser-home'; worlds.browser.ownBrowserExe=''; }
  // Public template binds locally; operators configure LAN access and passwords themselves.
  if (config.web) { config.web.host='127.0.0.1'; config.web.allowedHosts=[]; }
  return config;
}

export async function exportTemplate(deployment, out, webUrl) {
  deployment=resolve(deployment); out=resolve(out);
  const original=JSON.parse(readFileSync(join(deployment,'config.json'),'utf8'));
  const effective=structuredClone(original);
  if(webUrl) {
    const url=new URL('/api/config',webUrl);
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Settings export requires a loopback URL');
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw Error(`Settings export failed: HTTP ${response.status}`);
    const data=await response.json();
    if(!Array.isArray(data.groups))throw Error('Invalid settings response');
    for(const group of data.groups) for(const [path,value] of Object.entries(group.values??{})) {
      const parts=path.split('.'); if(parts.some(p=>['__proto__','prototype','constructor'].includes(p)))throw Error('Invalid setting path');
      let target=effective;for(const part of parts.slice(0,-1))target=target[part]??={};target[parts.at(-1)]=value;
    }
  }
  const personal=new Set(); const ow=original.worlds??{};
  for(const list of [original.globals?.trustedQQ,ow.delegate?.allowedQQ,ow.visual?.savers,ow.proactive?.targetQQ])
    for(const id of String(list??'').split(/[\s,，;；]+/))if(/^\d{5,12}$/.test(id))personal.add(id);
  for(const entry of [...(ow.qq?.groups??[]),...(ow.qq?.privates??[])])if(entry?.id)personal.add(String(entry.id));
  function check(name,text) {
    for(const id of personal)if(text.includes(id))throw Error(`${name} contains a private QQ identifier; export stopped`);
    if(/"(?:token|apiKey|password|secretValue|accessToken|refreshToken)"\s*:\s*"[^"\s]+"/i.test(text))throw Error(`${name} contains credentials`);
    if(/[A-Za-z]:[\\/]/.test(text))throw Error(`${name} contains a machine-specific absolute path`);
  }
  const files=new Map([['bot/config.json',JSON.stringify(sanitizeConfig(effective),null,2)+'\n'],['bot/deployment.json',readFileSync(join(deployment,'deployment.json'),'utf8')]]);
  const keep=(path,name)=>{if(existsSync(path))files.set(name,readFileSync(path,'utf8'));};
  keep(join(deployment,'policy','layers.json'),'bot/policy/layers.json');
  for(const world of existsSync(join(deployment,'worlds'))?readdirSync(join(deployment,'worlds')):[])
    keep(join(deployment,'worlds',world,'ENV_PROMPT.md'),`bot/worlds/${world}/ENV_PROMPT.md`);
  for(const [name,text] of files)check(name,text);
  // All validation completes before replacing the public template; only this known child is removed.
  const home=resolve(out,'home');if(dirname(home)!==out)throw Error('Invalid export destination');
  rmSync(home,{recursive:true,force:true});
  for(const [name,text] of files){const path=join(home,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
  return [...files.keys()];
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2); const deployment=args.shift();
  if(!deployment)throw Error('usage: export-template.mjs <deployment> [--web-url URL] [--out directory]');
  const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const files=await exportTemplate(deployment,option('--out')??fileURLToPath(new URL('../deploy-template/',import.meta.url)),option('--web-url'));
  console.log(`Exported ${files.length} public template files (no model configurations).`);
}
