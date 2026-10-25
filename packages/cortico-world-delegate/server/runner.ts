import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';

export function codexExecutable(configured: string): string {
  if(configured) { if(!isAbsolute(configured) || !existsSync(configured)) throw new Error('Codex executable must be an existing absolute path'); return configured; }
  const dirs=(process.env.PATH ?? '').split(delimiter);
  for(const dir of dirs) {
    const native=join(dir,process.platform==='win32'?'codex.exe':'codex');
    if(existsSync(native)) return native;
    if(process.platform==='win32') {
      const arch=process.arch==='arm64'?'arm64':'x64', triple=process.arch==='arm64'?'aarch64':'x86_64';
      const npm=join(dir,'node_modules','@openai','codex','node_modules','@openai',`codex-win32-${arch}`,'vendor',`${triple}-pc-windows-msvc`,'bin','codex.exe');
      if(existsSync(npm)) return npm;
    }
  }
  throw new Error('Local Codex executable not found; install Codex CLI or configure its executable path');
}
export function taskWorkspace(root: string, id: number): string {
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid task id');
  mkdirSync(root,{recursive:true});const base=realpathSync(root), dir=join(base,String(id),'workspace');mkdirSync(dir,{recursive:true});
  const actual=realpathSync(dir), rel=relative(base,actual);
  if(!rel || rel==='..' || rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Task workspace escapes configured root');
  return actual;
}
export function writableDirectories(value: string): string[] {
  const paths=value.split(/[;；\r\n]+/).map(path=>path.trim()).filter(Boolean);
  const unique=new Map<string,string>();
  for(const path of paths) {
    if(!isAbsolute(path)||!existsSync(path)||!statSync(path).isDirectory())throw new Error('Writable directories must be existing absolute directory paths');
    const actual=realpathSync(path);
    unique.set(process.platform==='win32'?actual.toLowerCase():actual,actual);
  }
  return [...unique.values()];
}
export function childEnvironment(home?: string): NodeJS.ProcessEnv {
  const allowed=new Set(['path','systemroot','windir','comspec','pathext','temp','tmp','userprofile','home','appdata','localappdata','programfiles','programfiles(x86)','programdata','codex_home']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toLowerCase())));
  if(home)env.CODEX_HOME=home;
  return env;
}
export interface ModelConnection { baseUrl: string; homeDir: string; model: string }
export interface RunOptions { writableDirs?: string; allowNetwork?: boolean; allowWebSearch?: boolean; executable: string; workspace: string; task: string; model: string; timeoutSeconds: number; signal: AbortSignal }
export interface RunResult { ok: boolean; text: string }

/** Real CLI subprocess; an optional local model endpoint is used by isolated integration tests. */
export class CodexRunner {
  constructor(private readonly connection?: ModelConnection) {}
  async run(options: RunOptions): Promise<RunResult> {
    options.signal.throwIfAborted();
    const writableDirs=writableDirectories(options.writableDirs??'');
    const args=['exec','--ignore-user-config','--ephemeral','--json','--skip-git-repo-check','--sandbox','workspace-write',
      '--disable','plugins','--disable','apps','--disable','remote_plugin',
      '-c','approval_policy="never"','-c','sandbox_workspace_write.writable_roots=[]',
      '-c',`sandbox_workspace_write.network_access=${options.allowNetwork===true}`,'-c','sandbox_workspace_write.exclude_tmpdir_env_var=true',
      '-c','sandbox_workspace_write.exclude_slash_tmp=true','-c',`web_search=${JSON.stringify(options.allowWebSearch===true?'live':'disabled')}`,
      '-C',options.workspace];
    for(const dir of writableDirs)args.push('--add-dir',dir);
    // Standalone Windows exec needs an explicit backend when user config is not loaded.
    if(process.platform==='win32')args.push('-c','windows.sandbox="unelevated"');
    if(options.model)args.push('-m',options.model);
    if(this.connection) args.push('-c','model_provider="fixture"','-c',`model=${JSON.stringify(this.connection.model)}`,
      '-c','model_providers.fixture.name="Fixture"','-c','model_providers.fixture.wire_api="responses"',
      '-c',`model_providers.fixture.base_url=${JSON.stringify(this.connection.baseUrl)}`);
    args.push('-');
    const child=spawn(codexExecutable(options.executable),args,{cwd:options.workspace,windowsHide:true,shell:false,detached:process.platform!=='win32',
      env:childEnvironment(this.connection?.homeDir),stdio:['pipe','pipe','pipe']});
    let text='',failure='',completed=false, bytes=0, timedOut=false;
    let killPromise: Promise<void> | undefined;
    const kill=()=>killPromise??=(async()=>{
      if(!child.pid)return;
      if(process.platform==='win32') {
        await new Promise<void>(resolveKill=>{
          const killer=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          killer.once('error',()=>{child.kill();resolveKill();});killer.once('close',()=>resolveKill());
        });
      } else { try { process.kill(-child.pid,'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    })();
    const abort=()=>{void kill();};options.signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;void kill();},options.timeoutSeconds*1000);
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){failure='Codex output exceeded the task limit';void kill();}});
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      if(bytes>8*1024*1024)return;
      try {
        const event=JSON.parse(line);
        if(event.type==='item.completed'&&event.item?.type==='agent_message'){
          const message=String(event.item.text??'');text=message.length>16000?message.slice(0,16000)+'\n[Result truncated at 16000 characters]':message;
        }
        if(event.type==='turn.completed')completed=true;
        if(event.type==='turn.failed')failure=String(event.error?.message??'Codex turn failed').slice(0,2000);
      }catch { /* Non-JSON diagnostics are not forwarded into the conversation. */ }
    });
    // Drain diagnostics without copying command output or credentials into bot logs.
    child.stderr.resume();child.stdin.on('error',()=>{});
    const result=new Promise<RunResult>(resolveResult=>{
      child.once('error',error=>{failure=error.message;});
      child.once('close',async code=>{
        clearTimeout(timer);options.signal.removeEventListener('abort',abort);lines.close();await killPromise;
        resolveResult({ok:code===0&&completed&&!failure&&!timedOut&&!options.signal.aborted,
          text:options.signal.aborted?'Task cancelled.':timedOut?'Codex task timed out.':failure || (code===0&&completed ? text || 'Codex completed without a final message.' : `Codex exited without completing (code ${code}). Check local Codex login and sandbox setup.`)});
      });
    });
    child.stdin.end('Allowed writable directories: '+JSON.stringify([options.workspace,...writableDirs])+'\nYou are executing a delegated user task in an isolated task workspace. Write only within the allowed directories. Do not modify the bot deployment or install extensions into it. Do not send messages or publish changes. Report what was actually completed and list relative artifact paths. If blocked by permissions or missing information, state the blocker.\n\nTask:\n'+options.task);
    return result;
  }
}
