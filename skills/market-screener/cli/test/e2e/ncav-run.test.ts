import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {collectCnEvidence} from '../../src/cn/collection.js';
import {sha256} from '../../src/cn/evidence.js';
import {runEvidenceSnapshot,readEvidenceRun,openEvidenceRun,diagnoseEvidenceRun,replayEvidenceRun,compareEvidenceRuns} from '../../src/cn/run-archive.js';

it('collects an independent NCAV winner from structured responses and preserves it through all-strategy archive and replay',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ncav-structured-'));
 const asOf='2026-09-10T00:00:00Z',ticker='600660';
 try {
  const rows=Array.from({length:5},(_,i)=>({SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:`${2021+i}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:-10,SCOPE_NOTE:'Synthetic ordinary manufacturing issuer'}));
  const bytes=JSON.stringify({data:rows});await fs.writeFile(path.join(dir,'history.json'),bytes);
  const review={schemaVersion:1,entity:ticker,basis:'test',asOf,reviewedAt:asOf,expiresAt:'2027-01-01',reviewer:'synthetic source contract',assertions:[{key:'method',value:'nonfinancial',coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'Synthetic manufacturing scope; not real company evidence',evidence:[{sourceId:'history',locator:'/data/4/SCOPE_NOTE',raw:rows[4].SCOPE_NOTE}]}]};
  const reviewBytes=JSON.stringify(review);await fs.writeFile(path.join(dir,'review.json'),reviewBytes);
  const input=path.join(dir,'input.json');await fs.writeFile(input,JSON.stringify({schemaVersion:1,sources:[
   {id:'history',path:'history.json',url:'https://example.test/synthetic-history',mapping:'indicators',mediaType:'application/json',fetchedAt:asOf,sha256:sha256(bytes)},
   {id:'review',path:'review.json',url:'https://example.test/synthetic-method',mapping:'reviewed-scope-v1',mediaType:'application/json',fetchedAt:asOf,sha256:sha256(reviewBytes)},
  ],companies:[{ticker,companyId:ticker,companyName:'Synthetic',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks:{},facts:[]}]}));
  const calls:string[]=[];
  const collected=await collectCnEvidence(input,path.join(dir,'collected'),{asOf,strategy:'ncav',pdfFallback:false,budget:{attempts:1,requestMs:1000,companyRequests:8,companyMs:20000,globalRequests:8,globalMs:20000,pdfReports:0}},{now:()=>Date.parse(asOf),fetch:async(url)=>{
   calls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return Response.json({data:[rows[4]]});
   if(u.pathname.endsWith('zcfzbAjaxNew')) return Response.json({data:[{...rows[4],TOTAL_CURRENT_ASSETS:100000000,TOTAL_LIABILITIES:20000000,MINORITY_EQUITY:10000000,OTHER_EQUITY_TOOL:5000000}]});
   if(u.hostname==='proxy.finance.qq.com') {
    const symbol=u.searchParams.get('param')!.split(',')[0];
    return Response.json({code:0,data:{[symbol]:{day:[['2026-09-09','40','40','41','39','100']]}}});
   }
   if(u.searchParams.get('reportName')==='RPT_F10_EH_EQUITY') return Response.json({success:true,result:{data:[{SECURITY_CODE:ticker,SECUCODE:`${ticker}.SH`,END_DATE:'2026-05-01',NOTICE_DATE:'2026-04-28',TOTAL_SHARES:1000000,TOTAL_A_SHARES:1000000,B_FREE_SHARE:null,LIMITED_B_SHARES:null,H_FREE_SHARE:null,LIMITED_H_SHARES:null,OTHER_FREE_SHARES:null,PREFERRED_SHARES:null,CHANGE_REASON:'synthetic share structure'}]}});
   throw new Error(`Unexpected request: ${url}`);
  }});
  expect(calls).toHaveLength(5);
  expect(calls.some(url=>/push2(?:his)?\.eastmoney/.test(url))).toBe(false);
  expect(calls.some(url=>/lrbAjaxNew|xjllbAjaxNew|cninfo|\.PDF/.test(url))).toBe(false);
  expect(new URL(calls.find(url=>url.includes('zcfzbAjaxNew'))!).searchParams.get('dates')).toBe('2025-12-31');
  const policyFile=new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname;
  const run=path.join(dir,'ncav'),all=path.join(dir,'all');
  await runEvidenceSnapshot(collected.inputFile,run,{policyFile,strategy:'ncav'});
  await runEvidenceSnapshot(collected.inputFile,all,{policyFile,strategy:'all'});
  const saved=await readEvidenceRun(run),combined=await readEvidenceRun(all);
  expect(saved.results[0]).toMatchObject({quality:'fail',strategies:{ncav:{state:'pass',signal:{value:1.625}}}});
  expect(saved.results[0].collection?.stoppedAfterFailure).toBeUndefined();
  expect(saved.summary.strategies?.ncav?.qualified).toEqual([`CN:${ticker}`]);
  expect(combined.summary.displayed).toEqual([`CN:${ticker}`]);
  expect(combined.results[0].strategies?.quality_research?.state).toBe('fail');
  const diagnostics=await diagnoseEvidenceRun(await openEvidenceRun(run));
  expect(diagnostics.diagnosis).toMatchObject({byMethod:{nonfinancial:{strategies:{ncav:{pass:1}}}}});
  expect(await replayEvidenceRun(run)).toMatchObject({matches:true,count:1});
  expect(await replayEvidenceRun(all)).toMatchObject({matches:true,count:1});
  expect((await compareEvidenceRuns(run,all)).changed).toMatchObject({strategy:true,policy:false,sources:false});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},30000);
