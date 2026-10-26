import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportTemplate, sanitizeConfig } from '../export-template.mjs';

test('public defaults keep behavior but remove model connections, identities and machine paths', () => {
  const input = { activeProvider:'example/chat', providers:{example:{}}, globals:{trustedQQ:'12345678'},
    batching:{quietGapMs:800}, modelTimeouts:{totalSec:120}, worlds:{
      qq:{groups:[{id:12345678}],privates:[{id:23456789}],wsUrl:'ws://example.invalid',token:'placeholder',groupReply:{probability:10}},
      memes:{memes:{embeddingModel:'example/embed',captionModel:'example/chat',proactiveSearchPercent:50,pythonFile:'C:/example/python.exe'}},
      browser:{ownBrowserHome:'C:/example/profile',ownBrowserExe:'C:/example/chrome.exe'},
      delegate:{allowedQQ:'12345678',workspaceDir:'C:/example/tasks',writableDirs:'C:/example',allowNetwork:true},
    }};
  const result = sanitizeConfig(input);
  assert.equal(result.activeProvider,'');assert.equal(result.providers,undefined);
  assert.equal(result.globals.trustedQQ,'');assert.deepEqual(result.worlds.qq.groups,[]);
  assert.equal(result.worlds.qq.token,undefined);assert.equal(result.worlds.qq.groupReply.probability,10);
  assert.equal(result.worlds.browser.ownBrowserHome,'browser-home');assert.equal(result.worlds.browser.ownBrowserExe,'');
  assert.equal(result.worlds.memes.memes.embeddingModel,'');assert.equal(result.worlds.memes.memes.captionModel,'');
  assert.equal(result.worlds.memes.memes.pythonFile,'python');assert.equal(result.batching.quietGapMs,800);
  assert.equal(result.modelTimeouts.totalSec,120);assert.equal(result.worlds.delegate.allowNetwork,true);
  assert.equal(input.activeProvider,'example/chat');
});

test('export validates before replacing a template and never copies credentials or data', async () => {
  const root=mkdtempSync(resolve('scratch/export-test-'));
  try {
    const deployment=join(root,'source'),out=join(root,'template');mkdirSync(deployment);
    writeFileSync(join(deployment,'config.json'),JSON.stringify({globals:{trustedQQ:'12345678'},worlds:{}}));
    writeFileSync(join(deployment,'deployment.json'),'{}');
    writeFileSync(join(deployment,'.env'),'PRIVATE_SENTINEL');mkdirSync(join(deployment,'data'));
    await exportTemplate(deployment,out);
    assert.equal(existsSync(join(out,'home/bot/.env')),false);assert.equal(existsSync(join(out,'home/bot/data')),false);
    mkdirSync(join(deployment,'policy'));writeFileSync(join(deployment,'policy/layers.json'),'12345678');
    const before=readFileSync(join(out,'home/bot/config.json'),'utf8');
    await assert.rejects(exportTemplate(deployment,out),/private QQ/);
    assert.equal(readFileSync(join(out,'home/bot/config.json'),'utf8'),before);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('deployment creation is portable, rejects invalid paths and preserves existing deployments', () => {
  const root=mkdtempSync(resolve('scratch/deployment-test-'));
  const run=(name,port='0')=>spawnSync(process.execPath,['scripts/new-deployment.mjs',root,name,port],{encoding:'utf8'});
  try {
    assert.equal(run('../escape').status,1);assert.equal(run('test','99999').status,1);
    assert.equal(run('test').status,0);
    const path=join(root,'test/config.json');const config=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(config.worlds.browser.ownBrowserHome,'browser-home');assert.equal(config.activeProvider,'');
    assert.equal(existsSync(join(root,'providers')),false);
    writeFileSync(path,'{"preserve":true}');assert.equal(run('test').status,0);
    assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{preserve:true});
  } finally {rmSync(root,{recursive:true,force:true});}
});
