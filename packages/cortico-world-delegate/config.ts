import type { ConfigGroup, ConfigProperty } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
import { permissionStrings } from './permission-strings.ts';
import { strings } from './strings.ts';
export interface DelegateConfigSection {
  enabled: boolean; active: boolean; allowedQQ: string; executableFile: string;
  writableDirs: string; allowNetwork: boolean; allowWebSearch: boolean;
  workspaceDir: string; model: string; timeoutSeconds: number; maxQueued: number;
}
export const DELEGATE_DEFAULTS: DelegateConfigSection = {
  writableDirs:'', allowNetwork:false, allowWebSearch:false, enabled:false, active:true, allowedQQ:'', executableFile:'', workspaceDir:'', model:'', timeoutSeconds:1200, maxQueued:3,
};
/** 能委派的 QQ：设置页「全局变量」的白名单 QQ，加上本插件自己的白名单。 */
export function allowedUsers(cfg: DelegateConfigSection, trusted: readonly string[] = []): Set<string> {
  return new Set([...trusted, ...cfg.allowedQQ.split(/[\s,，;；]+/)].filter(id=>/^[1-9]\d{4,15}$/.test(id)));
}
export function delegateConfigGroup(language:Language):ConfigGroup {
  const t=strings(language), permissions=permissionStrings[language];
  const fields:Record<string,ConfigProperty>={
    writableDirs:{type:'string',title:permissions[0],description:permissions[3]},
    allowNetwork:{type:'boolean',title:permissions[1]},allowWebSearch:{type:'boolean',title:permissions[2]},
    active:{type:'boolean',title:t.active},allowedQQ:{type:'string',title:t.whitelist},
    executableFile:{type:'string',title:t.executable,'x-path':{kind:'file'}},
    workspaceDir:{type:'string',title:t.workspace,'x-path':{kind:'directory'}},model:{type:'string',title:t.model},
    timeoutSeconds:{type:'integer',title:t.timeout,minimum:10,maximum:7200},maxQueued:{type:'integer',title:t.queue,minimum:1,maximum:20},
  };
  return {id:'world:delegate',owner:'world:delegate',schema:{type:'object',title:t.title,description:t.description,
    properties:Object.fromEntries(Object.entries(fields).map(([key,value])=>[`worlds.delegate.${key}`,{...value,'x-hot':true}]))}};
}
