#!/usr/bin/env node
// Synchronize stable DESIGN.md primitives; compositions and shadow recipes stay CSS-native.
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const markerStart='/* BEGIN DESIGN TOKENS — generated from DESIGN.md */';
const markerEnd='/* END DESIGN TOKENS */';
const designUrl=new URL('../DESIGN.md',import.meta.url);
const cssUrl=new URL('../assets/material.css',import.meta.url);
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--check')) {
  console.error('Usage: node scripts/sync-design-tokens.mjs [--check]');
  process.exit(2);
}
try {
  const {parse}=require('yaml');
  const markdown=await readFile(designUrl,'utf8');
  const match=markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!match) throw new Error('DESIGN.md requires YAML frontmatter.');
  const design=parse(match[1],{uniqueKeys:true});
  if(!design?.name) throw new Error('DESIGN.md is missing name.');
  const lines=[];
  const keyName=name=>{
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Invalid CSS token name: ${name}`);
    return name;
  };
  const emit=(name,value)=>{
    if(!['string','number'].includes(typeof value) || /[{};\n\r<>]/.test(String(value))) throw new Error(`Invalid primitive ${name}`);
    lines.push(`  --${name}: ${value};`);
  };
  for(const [name,value] of Object.entries(design.colors??{})) emit(`color-${keyName(name)}`,value);
  for(const [name,value] of Object.entries(design.spacing??{})) emit(`space-${keyName(name)}`,typeof value==='number'?`${value}px`:value);
  for(const [name,value] of Object.entries(design.rounded??{})) emit(`radius-${keyName(name)}`,value);
  const properties={fontFamily:'font-family',fontSize:'font-size',fontWeight:'font-weight',lineHeight:'line-height',letterSpacing:'letter-spacing'};
  for(const [name,role] of Object.entries(design.typography??{})) {
    for(const [property,cssProperty] of Object.entries(properties)) {
      if(role[property]!==undefined) emit(`type-${keyName(name)}-${cssProperty}`,role[property]);
    }
  }
  const block=`${markerStart}\n:root {\n${lines.join('\n')}\n}\n${markerEnd}`;
  const css=await readFile(cssUrl,'utf8');
  const start=css.indexOf(markerStart),end=css.indexOf(markerEnd);
  if((start<0)!==(end<0) || (start>=0 && end<start)) throw new Error('CSS token markers are incomplete.');
  const next=start<0?`${block}\n\n${css}`:css.slice(0,start)+block+css.slice(end+markerEnd.length);
  if(args.includes('--check')) {
    if(css!==next) throw new Error('DESIGN.md and material.css differ. Run node scripts/sync-design-tokens.mjs.');
    console.log('DESIGN.md tokens and material.css are synchronized.');
  } else {
    await writeFile(cssUrl,next);
    console.log(`Synchronized ${lines.length} CSS properties in ${fileURLToPath(cssUrl)}.`);
  }
} catch(error) {
  console.error(error.code==='MODULE_NOT_FOUND'?'Install skill development dependencies with npm install before syncing DESIGN.md.':error.message);
  process.exitCode=1;
}
