import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('a design change is detected and sync preserves hand-authored compositions',async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const temp=await mkdtemp(path.join(os.tmpdir(),'mc-tokens-'));
  try {
    await mkdir(path.join(temp,'scripts'));await mkdir(path.join(temp,'assets'));
    for(const f of ['scripts/sync-design-tokens.mjs','assets/material.css','DESIGN.md']) await copyFile(path.join(root,f),path.join(temp,f));
    const command=(...args)=>spawnSync(process.execPath,[path.join(temp,'scripts/sync-design-tokens.mjs'),...args],{encoding:'utf8',env:{...process.env,NODE_PATH:[path.join(root,'node_modules'),process.env.NODE_PATH].filter(Boolean).join(path.delimiter)}});
    assert.equal(command('--check').status,0);
    const before=await readFile(path.join(temp,'assets/material.css'),'utf8');
    const design=await readFile(path.join(temp,'DESIGN.md'),'utf8');
    await writeFile(path.join(temp,'DESIGN.md'),design.replace('primary: "#3F51B5"','primary: "#123456"'));
    assert.equal(command('--check').status,1,'stale CSS must fail');
    assert.equal(command().status,0);
    assert.equal(command('--check').status,0);
    const after=await readFile(path.join(temp,'assets/material.css'),'utf8');
    assert.ok(after.includes('--color-primary: #123456;'));
    assert.equal(after.split('/* END DESIGN TOKENS */')[1],before.split('/* END DESIGN TOKENS */')[1]);
  } finally {await rm(temp,{recursive:true,force:true});}
});
