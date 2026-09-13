import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fetchIcon, loadIcon, searchIcons, validateSvg} from '../scripts/material-icons.mjs';

const svg=name=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h${name.length}v1H1z"/></svg>`;
const ok=name=>async()=>({ok:true,status:200,text:async()=>svg(name)});

test('complete pinned catalog is searchable by English and Chinese semantics',async()=>{
  const groups=await searchIcons('groups');
  assert.equal(groups[0].name,'groups');
  const environmental=await searchIcons('环保');
  assert.ok(environmental.some(icon=>icon.name==='recycling'));
  const {catalog}=JSON.parse(await readFile(new URL('../assets/icon-library.json',import.meta.url),'utf8'));
  assert.equal(catalog.revision,'40a7a292a79d9394157e1ea24f83d52d5e17c556');
  assert.equal(catalog.icons.length,2170);
  assert.ok(catalog.icons.every(icon=>icon.path===`${icon.category}/${icon.name}/materialicons/24px.svg`));
});

test('CLI keeps the first positional search argument',()=>{
  const script=new URL('../scripts/material-icons.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[script.pathname,'search','groups','--limit','1'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/^groups\tsocial/m);
});

test('CLI help succeeds and valued options reject missing values',()=>{
  const script=new URL('../scripts/material-icons.mjs',import.meta.url).pathname;
  const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  const help=run(['--help']);
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/Usage:/);
  for(const args of [['search','groups','--limit'],['fetch','groups','--cache-dir']]){
    const result=run(args);
    assert.equal(result.status,1);
    assert.match(result.stderr,/requires/);
  }
});

test('fetch caches an icon and offline mode reuses verified cache',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    const first=await fetchIcon('auto_awesome',{cacheDir:cache,fetchImpl:ok('auto_awesome')});
    assert.equal(first.cached,false);
    const second=await fetchIcon('auto_awesome',{cacheDir:cache,offline:true,fetchImpl:()=>{throw new Error('network must not run');}});
    assert.equal(second.cached,true);
    assert.equal(second.sha256,first.sha256);
  } finally {await rm(cache,{recursive:true,force:true});}
});

test('verified cache rejects a valid SVG whose hash differs from its manifest',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    await fetchIcon('auto_awesome',{cacheDir:cache,fetchImpl:ok('auto_awesome')});
    await writeFile(path.join(cache,'auto_awesome.svg'),svg('changed-auto_awesome'));
    await assert.rejects(fetchIcon('auto_awesome',{cacheDir:cache,offline:true}),/SHA-256 mismatch/);
  } finally {await rm(cache,{recursive:true,force:true});}
});

test('network fetch times out even when an injected fetch ignores abort',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    await assert.rejects(fetchIcon('auto_awesome',{cacheDir:cache,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/timed out after 10 ms/);
  } finally {await rm(cache,{recursive:true,force:true});}
});

test('missing catalog name and offline cache miss give actionable errors',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    await assert.rejects(fetchIcon('definitely_missing_icon',{cacheDir:cache}),/Unknown classic Material Icon.*search/);
    await assert.rejects(fetchIcon('forest',{cacheDir:cache,offline:true}),/not cached.*Connect once/s);
  } finally {await rm(cache,{recursive:true,force:true});}
});

test('malicious or structurally wrong SVG payloads are rejected',async()=>{
  assert.throws(()=>validateSvg('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>'),/Rejected SVG/);
  assert.throws(()=>validateSvg('<svg viewBox="0 0 24 24"><path onclick="x()" d="M0 0"/></svg>'),/Rejected SVG/);
  assert.throws(()=>validateSvg('<svg viewBox="0 0 24 24"><image href="https://evil.test/x"/></svg>'),/Rejected SVG/);
  assert.throws(()=>validateSvg('<svg viewBox="0 0 48 48"><path d="M0 0"/></svg>'),/24px/);
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    await assert.rejects(fetchIcon('psychology',{cacheDir:cache,fetchImpl:async()=>({ok:true,status:200,text:async()=>'<svg viewBox="0 0 24 24"><script/></svg>'})}),/Rejected SVG/);
  } finally {await rm(cache,{recursive:true,force:true});}
});

test('concurrent downloads retain every manifest entry',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    await Promise.all(['auto_awesome','forest','psychology'].map(name=>fetchIcon(name,{cacheDir:cache,fetchImpl:ok(name)})));
    const manifest=JSON.parse(await readFile(path.join(cache,'sources.json'),'utf8'));
    assert.deepEqual(manifest.files.map(item=>item.name).sort(),['auto_awesome','forest','psychology']);
    assert.ok(manifest.files.every(item=>item.revision==='40a7a292a79d9394157e1ea24f83d52d5e17c556'&&/^[a-f0-9]{64}$/.test(item.sha256)));
  } finally {await rm(cache,{recursive:true,force:true});}
});


test('bundled icons load without files and materialize offline with their original provenance',async()=>{
  const library=JSON.parse(await readFile(new URL('../assets/icon-library.json',import.meta.url),'utf8'));
  for(const [name,record] of Object.entries(library.bundled)){
    const loaded=await loadIcon(name);
    assert.equal(loaded.svg,record.svg);
    assert.equal(loaded.sha256,record.sha256);
    assert.equal(loaded.bundled,true);
  }
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    const result=await fetchIcon('groups',{cacheDir:cache,offline:true,fetchImpl:()=>{throw new Error('network must not run');}});
    assert.equal(result.bundled,true);
    assert.equal(await readFile(result.path,'utf8'),library.bundled.groups.svg);
    const manifest=JSON.parse(await readFile(path.join(cache,'sources.json'),'utf8'));
    assert.equal(manifest.files[0].source,library.bundled.groups.source);
    assert.equal(manifest.files[0].sha256,library.bundled.groups.sha256);
  } finally {await rm(cache,{recursive:true,force:true});}
});

test('renderer icon loader rejects an unverified cache file',async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),'mc-icons-'));
  try {
    await writeFile(path.join(cache,'forest.svg'),svg('forest'));
    await assert.rejects(loadIcon('forest',{cacheDir:cache}),/Missing SHA-256 provenance/);
  } finally {await rm(cache,{recursive:true,force:true});}
});
