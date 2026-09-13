#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir, open, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const LIBRARY_PATH=path.join(ROOT,'assets/icon-library.json');
const DEFAULT_CACHE=path.join(ROOT,'.cache/icons');
const SOURCES_FILE='sources.json';

let catalogPromise;
async function catalog(){
  catalogPromise??=readFile(LIBRARY_PATH,'utf8').then(JSON.parse).then(library=>({
    ...library,index:library.catalog,byName:new Map(library.catalog.icons.map(icon=>[icon.name,icon]))
  }));
  return catalogPromise;
}

export async function iconAttribution(){
  const {licenseText,provenance}=await catalog();
  return {license:licenseText,sourceManifest:provenance};
}

async function bundledIcon(name){
  const {bundled,byName}=await catalog();
  const record=bundled[name];
  if(!record) return null;
  validateSvg(record.svg);
  const sha256=createHash('sha256').update(record.svg).digest('hex');
  if(sha256!==record.sha256) throw new Error(`Bundled icon "${name}" failed SHA-256 verification.`);
  return {name,svg:record.svg,sha256,cached:true,bundled:true,entry:byName.get(name),record};
}

// Rendering never downloads: use the compact bundle, then a verified local cache.
export async function loadIcon(name,{cacheDir=DEFAULT_CACHE}={}){
  safeName(name);
  return await bundledIcon(name)??await fetchIcon(name,{cacheDir,offline:true});
}

export async function searchIcons(query,{limit=20}={}){
  const q=String(query??'').trim().toLowerCase();
  if(!q) throw new Error('Search query is required. Example: material-icons.mjs search recycling');
  const {index,aliases}=await catalog();
  const aliasNames=Object.entries(aliases).filter(([key])=>key.includes(q)||q.includes(key)).flatMap(([,names])=>names);
  const terms=[q,q.replace(/[\s-]+/g,'_'),...aliasNames];
  return index.icons.map(icon=>{
    const name=icon.name.toLowerCase();
    let score=0;
    for(const term of terms){
      if(name===term) score=Math.max(score,100);
      else if(name.startsWith(term)) score=Math.max(score,70);
      else if(name.includes(term)) score=Math.max(score,40);
    }
    if(icon.category.toLowerCase()===q) score=Math.max(score,30);
    return {icon,score};
  }).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.icon.name.localeCompare(b.icon.name)).slice(0,limit).map(x=>x.icon);
}

export function validateSvg(svg){
  if(typeof svg!=='string'||Buffer.byteLength(svg)>256*1024) throw new Error('Rejected SVG: payload is empty, non-text, or larger than 256 KiB.');
  if(!/^\s*<svg\b[^>]*>[\s\S]*<\/svg>\s*$/i.test(svg)) throw new Error('Rejected SVG: expected one complete <svg> document.');
  const forbidden=/<\s*(script|foreignObject|iframe|object|embed|link|style)\b|\son[a-z]+\s*=|\b(?:href|xlink:href)\s*=|url\s*\(\s*["']?(?!#)/i;
  if(forbidden.test(svg)) throw new Error('Rejected SVG: scripts, event handlers, links, embedded objects, styles, and external references are forbidden.');
  if(!/\bviewBox\s*=\s*["']0\s+0\s+24\s+24["']/i.test(svg)) throw new Error('Rejected SVG: classic 24px icon must use viewBox="0 0 24 24".');
  return true;
}

function safeName(name){
  if(!/^[a-z0-9][a-z0-9_]*$/.test(name)) throw new Error(`Invalid icon name "${name}". Use a catalog name containing lowercase letters, digits, and underscores.`);
}

async function safeCacheDir(input){
  const resolved=path.resolve(input??DEFAULT_CACHE);
  const forbidden=new Set([path.parse(resolved).root,path.resolve(os.homedir()),ROOT,path.dirname(ROOT)]);
  if(forbidden.has(resolved)) throw new Error(`Unsafe cache directory: ${resolved}. Choose a dedicated icon directory, for example ./.cache/icons.`);
  try {if(!(await stat(resolved)).isDirectory()) throw new Error(`Cache path is not a directory: ${resolved}`);} catch(error){if(error.code!=='ENOENT') throw error;}
  await mkdir(resolved,{recursive:true});
  return resolved;
}

async function withManifestLock(cacheDir,fn){
  const lock=path.join(cacheDir,'.material-icons.lock');
  const deadline=Date.now()+8000;
  while(true){
    try {await mkdir(lock);break;} catch(error){
      if(error.code!=='EEXIST') throw error;
      if(Date.now()>deadline) throw new Error(`Timed out waiting for icon cache lock: ${lock}`);
      await new Promise(resolve=>setTimeout(resolve,20+Math.random()*30));
    }
  }
  try{return await fn();}finally{await rm(lock,{recursive:true,force:true});}
}

async function readSources(cacheDir,index){
  const file=path.join(cacheDir,SOURCES_FILE);
  try {
    const value=JSON.parse(await readFile(file,'utf8'));
    if(!value||typeof value!=='object'||!Array.isArray(value.files)) throw new Error('files must be an array');
    return value;
  } catch(error){
    if(error.code==='ENOENT') return {repository:index.repository,license:'Apache-2.0',revision:index.revision,files:[]};
    throw new Error(`Invalid icon source manifest ${file}: ${error.message}`);
  }
}

async function updateManifest(cacheDir,index,record){
  await withManifestLock(cacheDir,async()=>{
    const manifest=await readSources(cacheDir,index);
    const files=manifest.files.filter(item=>!(item.name===record.name&&item.variant===record.variant));
    files.push(record); files.sort((a,b)=>a.name.localeCompare(b.name)||String(a.variant).localeCompare(String(b.variant)));
    const next={...manifest,repository:manifest.repository??index.repository,license:manifest.license??'Apache-2.0',materialIconsRevision:index.revision,files};
    const temp=path.join(cacheDir,`.${SOURCES_FILE}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    await writeFile(temp,`${JSON.stringify(next,null,2)}\n`,{flag:'wx'});
    await rename(temp,path.join(cacheDir,SOURCES_FILE));
  });
}

export async function fetchIcon(name,{cacheDir=DEFAULT_CACHE,offline=false,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  safeName(name);
  const dir=await safeCacheDir(cacheDir);
  const {index,byName}=await catalog();
  const entry=byName.get(name);
  if(!entry) throw new Error(`Unknown classic Material Icon "${name}". Run "material-icons.mjs search ${name}" to find a valid name.`);
  if(entry.path!==`${entry.category}/${entry.name}/materialicons/24px.svg`) throw new Error(`Catalog schema mismatch for "${name}"; refresh icon-library.json from the pinned revision.`);
  const output=path.join(dir,`${name}.svg`);
  try {
    const cached=await readFile(output,'utf8'); validateSvg(cached);
    const sha256=createHash('sha256').update(cached).digest('hex');
    const manifest=await readSources(dir,index);
    const records=manifest.files.filter(item=>item.name===name&&typeof item.sha256==='string');
    const record=records.find(item=>item.variant==='filled-24px')??records[0];
    if(!record) throw new Error('Missing SHA-256 provenance record; remove this cache entry and fetch it again.');
    if(record.sha256!==sha256) throw new Error(`SHA-256 mismatch: manifest has ${record.sha256}, file has ${sha256}`);
    return {name,path:output,svg:cached,sha256,cached:true,entry};
  } catch(error){if(error.code!=='ENOENT') throw new Error(`Invalid cached icon ${output}: ${error.message}`);}
  const bundled=await bundledIcon(name);
  if(bundled){
    const {svg,...record}=bundled.record;
    await writeFile(output,svg,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST') throw error;});
    await updateManifest(dir,index,record);
    return {...bundled,path:output};
  }
  if(offline) throw new Error(`Icon "${name}" is not cached and offline mode is enabled. Connect once and run "material-icons.mjs fetch ${name} --cache-dir ${dir}".`);
  if(typeof fetchImpl!=='function') throw new Error('No fetch implementation is available; use Node 18+ or provide fetchImpl.');
  const source=`${index.rawBase}/${entry.path}`;
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new Error('timeoutMs must be a positive number.');
  const controller=new AbortController();
  let timer;
  let response;
  try {
    response=await Promise.race([
      Promise.resolve().then(()=>fetchImpl(source,{signal:controller.signal})),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error(`timed out after ${timeoutMs} ms`));},timeoutMs);})
    ]);
  } catch(error){throw new Error(`Failed to download "${name}" from Google (${error.message}). Check the network or retry with --offline after caching.`);}
  finally {clearTimeout(timer);}
  if(!response.ok) throw new Error(`Failed to download "${name}" from Google: HTTP ${response.status}. Source: ${source}`);
  const svg=await response.text(); validateSvg(svg);
  const sha256=createHash('sha256').update(svg).digest('hex');
  const temp=path.join(dir,`.${name}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  try {const handle=await open(temp,'wx'); await handle.writeFile(svg); await handle.close(); await rename(temp,output);} finally {await rm(temp,{force:true});}
  await updateManifest(dir,index,{name,variant:'filled-24px',category:entry.category,source,revision:index.revision,sha256});
  return {name,path:output,svg,sha256,cached:false,entry};
}

function usage(){return `Usage:\n  material-icons.mjs search <query> [--limit N]\n  material-icons.mjs fetch <name...> [--cache-dir DIR] [--offline]\n`;}

async function cli(args){
  const [command,...rest]=args;
  if(command==='--help'||command==='-h'||command==='help'){console.log(usage());return;}
  if(command==='search'){
    const limitAt=rest.indexOf('--limit');
    if(limitAt>=0&&(limitAt===rest.length-1||rest[limitAt+1].startsWith('--'))) throw new Error('--limit requires a positive integer value.');
    const limit=limitAt>=0?Number(rest[limitAt+1]):20;
    if(!Number.isInteger(limit)||limit<=0) throw new Error('--limit requires a positive integer value.');
    const unknown=rest.filter((arg,i)=>arg.startsWith('--')&&i!==limitAt);
    if(unknown.length) throw new Error(`Unknown search option: ${unknown[0]}`);
    const query=rest.filter((_,i)=>limitAt<0||(i!==limitAt&&i!==limitAt+1)).join(' ');
    for(const icon of await searchIcons(query,{limit})) console.log(`${icon.name}\t${icon.category}`);
    return;
  }
  if(command==='fetch'){
    const cacheAt=rest.indexOf('--cache-dir');
    if(cacheAt>=0&&(cacheAt===rest.length-1||rest[cacheAt+1].startsWith('--'))) throw new Error('--cache-dir requires a directory path.');
    const cacheDir=cacheAt>=0?rest[cacheAt+1]:DEFAULT_CACHE;
    const offline=rest.includes('--offline');
    const unknown=rest.filter((arg,i)=>arg.startsWith('--')&&arg!=='--offline'&&i!==cacheAt);
    if(unknown.length) throw new Error(`Unknown fetch option: ${unknown[0]}`);
    const names=rest.filter((arg,i)=>arg!=='--offline'&&(cacheAt<0||(i!==cacheAt&&i!==cacheAt+1)));
    if(!names.length) throw new Error(`At least one icon name is required.\n${usage()}`);
    for(const name of names){const result=await fetchIcon(name,{cacheDir,offline});console.log(`${result.cached?'cache':'fetched'}\t${name}\t${result.path}\t${result.sha256}`);}
    return;
  }
  throw new Error(usage());
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){cli(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});}
