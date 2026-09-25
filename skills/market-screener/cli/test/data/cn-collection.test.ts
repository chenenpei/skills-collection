import {expect,it} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {collectCnEvidence,defaultCnCollectionBudget,defaultCnCollectionBudgetFor} from '../../src/cn/collection.js';
import {loadEvidenceInput,sha256} from '../../src/cn/evidence.js';
import {runEvidenceSnapshot,replayEvidenceRun} from '../../src/cn/run-archive.js';
import {evaluateCompany} from '../../src/cn/screening.js';
import {loadCnPolicy} from '../../src/policy/loader.js';
const annualPdf=await fs.readFile(new URL('../fixtures/synthetic-scope.pdf',import.meta.url));

it('records the bounded default budget without requiring a user budget file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-default-budget-'));
 try {
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',concurrency:1},{fetch:completeResponse});
  expect((await loadEvidenceInput(result.inputFile)).input.collection).toMatchObject({budget:defaultCnCollectionBudget,concurrency:1});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('scales the default global cap from the frozen identity count while retaining an explicit ceiling',()=>{
 expect(defaultCnCollectionBudgetFor(40)).toMatchObject({globalRequests:400,globalMs:900_000,pdfReports:1});
 expect(defaultCnCollectionBudgetFor(40,1).globalMs).toBe(3_600_000);
 expect(defaultCnCollectionBudgetFor(40,8).globalMs).toBe(450_000);
 expect(defaultCnCollectionBudgetFor(6_001)).toMatchObject({globalRequests:60_000,globalMs:43_200_000});
});

it('uses the latest provider-declared financial family before treating NCAV as inapplicable',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-ncav-family-'));
 try {
  const file=path.join(dir,'input.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic bank',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const urls:string[]=[];
  await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',strategy:'ncav',concurrency:1,budget:{attempts:1,requestMs:1000,companyRequests:8,companyMs:10000,globalRequests:8,globalMs:10000}},{fetch:async(url,init)=>{
    urls.push(url);
    if(url.includes('RPT_F10_FINANCE_MAINFINADATA')) return new Response(JSON.stringify({data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'银行'}]}));
    return completeResponse(url,init);
  }});
  const indicators=urls.find(url=>url.includes('RPT_F10_FINANCE_MAINFINADATA'))!;
  expect(indicators).toContain("2025-12-31");
  expect(urls.some(url=>url.includes('zcfzbAjaxNew')||url.includes('lrbAjaxNew')||url.includes('xjllbAjaxNew'))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('stores collected facts once in a v2 sidecar, then resumes without embedding or discarding them',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-v2-collection-'));
 try {
  const original=path.join(dir,'identity.json'),legacySource=path.join(dir,'legacy.json'),legacyBytes='{"diagnostic":"legacy"}';
  await fs.writeFile(legacySource,legacyBytes);
  const priorFact={id:'prior:parent-profit',field:'parentProfit',entity:'600660',year:2025,period:{start:'2025-01-01',end:'2025-12-31'},publishedAt:'2026-03-01',basis:'test',unit:'CNY',state:'missing',evidence:[],reason:'prior_collection'};
  await fs.writeFile(original,JSON.stringify({schemaVersion:1,sources:[{id:'legacy',path:'legacy.json',url:'https://example.test/legacy',mediaType:'application/json',fetchedAt:'2026-09-01',sha256:sha256(legacyBytes)}],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[priorFact]}]}));
  const budget={attempts:1,requestMs:1000,companyRequests:12,companyMs:20000,globalRequests:12,globalMs:20000};
  const first=await collectCnEvidence(original,path.join(dir,'first'),{asOf:'2026-09-10',budget,concurrency:1},{fetch:completeResponse});
  const firstRaw=JSON.parse(await fs.readFile(first.inputFile,'utf8'));
  expect(firstRaw.schemaVersion).toBe(2);
  expect(firstRaw.companies).toHaveLength(1);
  expect(firstRaw.companies[0].facts).toEqual([]);
  expect(firstRaw.companyRecords).toMatchObject({path:'companies.jsonl'});
  const firstRecords=(await fs.readFile(path.join(path.dirname(first.inputFile),'companies.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(firstRecords).toHaveLength(1);
  expect(firstRecords[0]).toMatchObject({market:'CN',ticker:'600660'});
  expect(firstRecords[0].facts).toEqual([priorFact]);
  expect(firstRaw.sources.find((source:{id:string})=>source.id==='legacy')?.path).toBe(legacySource);
  expect(firstRaw.sources.filter((source:{id:string})=>source.id!=='legacy').every((source:{path:string})=>!path.isAbsolute(source.path))).toBe(true);

  let networkCalls=0;
  const second=await collectCnEvidence(first.inputFile,path.join(dir,'second'),{asOf:'2026-09-10',budget,concurrency:1},{fetch:async()=>{networkCalls++;throw new Error('same-cutoff resume should use archived sources');}});
  expect(networkCalls).toBe(0);
  const secondRaw=JSON.parse(await fs.readFile(second.inputFile,'utf8'));
  expect(secondRaw.companies[0].facts).toEqual([]);
  const secondRecords=(await fs.readFile(path.join(path.dirname(second.inputFile),'companies.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(secondRecords[0].facts.some((fact:{id:string})=>fact.id==='prior:parent-profit')).toBe(true);
  expect(secondRecords[0].facts.some((fact:{field:string})=>fact.field==='parentProfit')).toBe(true);
  expect(secondRaw.sources.find((source:{id:string})=>source.id==='legacy')?.path).toBe(legacySource);
  // Sources captured by the first collection become fixed legacy originals
  // when a resumed collection writes its own archive.
  expect(secondRaw.sources.every((source:{path:string})=>path.isAbsolute(source.path))).toBe(true);
  expect((await loadEvidenceInput(second.inputFile)).input.companies[0].facts.some(fact=>fact.id==='prior:parent-profit')).toBe(true);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('does not query former-code reports when the unresolved method cannot be settled by a report',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-former-code-'));
 try {
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'920010',companyId:'920010',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const urls:string[]=[];
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:15000}},{fetch:async(url,init)=>{
   urls.push(url);
   if(url.endsWith('szse_stock.json')) return new Response(JSON.stringify({stockList:[{code:'920010',orgId:'issuer-1'},{code:'831010',orgId:'issuer-1'},{code:'831011',orgId:'issuer-2'}]}));
   if(url.includes('/hisAnnouncement/query')) return new Response(JSON.stringify({totalAnnouncement:2,hasMore:false,announcements:[{secCode:'831011',secName:'Synthetic',orgId:'issuer-2',announcementTitle:'2024年年度报告',announcementTime:Date.parse('2025-04-01'),adjunctUrl:'finalpage/2025-04-01/wrong.PDF'},{secCode:'831010',secName:'Synthetic',orgId:'issuer-1',announcementTitle:'2024年年度报告（更正后）',announcementTime:Date.parse('2025-05-01'),adjunctUrl:'finalpage/2025-05-01/former.PDF'}]}));
   if(url.endsWith('.PDF')) return new Response(Buffer.from(annualPdf.toString('latin1').replaceAll('600660','831010').replaceAll('2025','2024'),'latin1'));
   return completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(result.inputFile);
  expect(input.sources.some(s=>s.mapping==='cninfo-annual-pdf')).toBe(false);
  expect(urls.some(url=>url.includes('cninfo') || url.endsWith('.PDF'))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('does not open an annual-report index when API-only facts leave a non-report-resolvable method unknown',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-annual-collection-'));
 try {
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const requests:Array<{url:string;body?:BodyInit|null}>=[];
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:15000}},{fetch:async(url,init)=>{
   requests.push({url,body:init?.body});
   if(url.endsWith('szse_stock.json')) return new Response(JSON.stringify({stockList:[{code:'600660',orgId:'test-issuer'}]}));
   if(url.includes('/hisAnnouncement/query')) {
    const entry={secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/600660.PDF'};
    return new Response(JSON.stringify({totalAnnouncement:4,hasMore:false,announcements:[{...entry,announcementTitle:'2025年年度报告摘要'}, {...entry,secCode:'600276'}, {...entry,announcementTime:Date.parse('2026-09-11')},entry]}));
   }
   if(url.endsWith('.PDF')) return new Response(annualPdf);
   return completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(result.inputFile);
  expect(input.sources.some(s=>s.mapping==='cninfo-annual-pdf')).toBe(false);
  expect(requests.some(request=>request.url.includes('cninfo') || request.url.endsWith('.PDF'))).toBe(false);
  expect(input.collection?.requests).toBeLessThanOrEqual(12);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('keeps failed source diagnostics and bounds retries without waiting for an agent',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-source-error-'));
 try {
  const file=path.join(dir,'identity.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  let calls=0;const fetch=async()=>{calls++;return calls===1?new Response(JSON.stringify({data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10}]})):new Response('upstream unavailable',{status:503});};
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:2,requestMs:1000,companyRequests:20,companyMs:10000,globalRequests:100,globalMs:20000},concurrency:1},{fetch});
  expect(calls).toBe(7);expect(result.status).toBe('complete');
  const {input}=await loadEvidenceInput(result.inputFile);
  expect(input.companies).toHaveLength(1);expect(input.companies[0].collection?.state).toBe('source_error');
  expect(input.collection?.events).toHaveLength(7);
  expect(input.sources.slice(1).every(s=>s.mapping===undefined)).toBe(true);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('rejects a future collection cutoff before making requests or creating output',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-future-'));
 try {
  let calls=0;
  await expect(collectCnEvidence(path.join(dir,'unused.json'),path.join(dir,'output'),{asOf:'2026-09-11',budget:{attempts:1,requestMs:1000,companyRequests:4,companyMs:5000,globalRequests:4,globalMs:5000}},{now:()=>Date.parse('2026-09-10'),fetch:async()=>{calls++;return new Response('{}');}})).rejects.toThrow(/future cutoff/);
  expect(calls).toBe(0);await expect(fs.stat(path.join(dir,'output'))).rejects.toMatchObject({code:'ENOENT'});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('freezes an implicit live cutoff after collection, while explicit cutoffs and future source timestamps remain strict',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-live-cutoff-'));
 try {
  const start='2026-09-10T03:00:00.000Z',file=path.join(dir,'identity.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:start,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const budget={attempts:1,requestMs:1000,companyRequests:12,companyMs:20000,globalRequests:12,globalMs:20000};
  for(const mode of ['live','explicit','future-source'] as const) {
   let clock=Date.parse(start);
   const result=await collectCnEvidence(file,path.join(dir,mode),{...(mode==='explicit'?{asOf:start}:{}),budget},{now:()=>clock,fetch:async(url,init)=>{
    clock+=1000;
    if(new URL(url).pathname.endsWith('/stock/get')) return new Response(JSON.stringify({data:{f57:'600660',f84:1000000,f86:(clock+(mode==='future-source'?60000:0))/1000}}));
    return completeResponse(url,init);
   }});
   const {input}=await loadEvidenceInput(result.inputFile),company=input.companies[0];
   expect(input.collection?.asOf).toBe(mode==='explicit'?start:new Date(clock).toISOString());
   expect(company.asOf).toBe(input.collection?.asOf);
   expect(input.collection?.cutoffMode).toBe(mode==='explicit'?'explicit':'live');
   expect(company.facts.some(f=>f.field==='ordinaryShares'&&f.state==='observed')).toBe(false);
   expect(company.collection?.state).toBe('complete');
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it.each(['2026-09-10T06:59:51.000Z','2026-09-10T06:59:52.000Z'])('never reinterprets a pre-close live bar as a completed close, including downloads across the close (%s)',async(start)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-live-close-'));
 try {
  const file=path.join(dir,'identity.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:start,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  let clock=Date.parse(start);
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:20000,globalRequests:12,globalMs:20000}},{now:()=>clock,fetch:async(url,init)=>{
   clock+=1000;
   const u=new URL(url);
   if(u.pathname.endsWith('/kline/get'))return new Response(JSON.stringify({data:{code:u.searchParams.get('secid')!.split('.')[1],market:1,klines:['2026-09-09,50,55,56,49,100','2026-09-10,50,999,999,49,100']}}));
   return completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(collected.inputFile),company=input.companies[0];
  expect(company.facts.some(f=>f.field==='price')).toBe(false);
  expect(company.quoteDate).toBeUndefined();
  expect(company.lastCompletedTradingDay).toBeUndefined();
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('leaves the last trading day unverified if the session response predates a close crossed during live collection',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-session-expiry-'));
 try {
 const start='2026-09-10T06:59:45.000Z',file=await writeQuoteReadyInput(dir,['600660'],start);
  let clock=Date.parse(start);
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:20000,globalRequests:12,globalMs:20000}},{now:()=>clock,fetch:async(url,init)=>{clock+=1000;const u=new URL(url),response=u.hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);if(u.searchParams.get('param')?.startsWith('sh000001,')) clock+=20_000;return response;}});
  const {input}=await loadEvidenceInput(collected.inputFile);
  expect(input.companies[0].quoteDate).toBe('2026-09-09');
  expect(input.companies[0].lastCompletedTradingDay).toBeUndefined();
  // Retain the dated response for diagnostics; its age prevents importing a
  // current-session fact after the close.
  expect(input.collection?.events.some(event=>new URL(event.url).searchParams.get('param')?.startsWith('sh000001,')&&event.sourceId.includes('tencent-session'))).toBe(true);
  await fs.writeFile(collected.inputFile,JSON.stringify(input));
  expect((await loadEvidenceInput(collected.inputFile)).input.companies[0].lastCompletedTradingDay).toBeUndefined();
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
it('isolates legacy daily and session archives without a request start while retaining independently timed shares',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-legacy-quote-boundary-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],asOf);
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:20000,globalRequests:12,globalMs:20000}},{now:()=>Date.parse(asOf),fetch:async(url,init)=>new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init)});
  const saved=(await loadEvidenceInput(collected.inputFile)).input;
  for(const source of saved.sources) if(['eastmoney-daily','eastmoney-session'].includes(source.mapping)) delete source.requestStartedAt;
  await fs.writeFile(collected.inputFile,JSON.stringify(saved));
  const {input}=await loadEvidenceInput(collected.inputFile),company=input.companies[0];
  expect(company.facts.find(f=>f.field==='price')).toMatchObject({state:'observed'});
  expect(company.facts.find(f=>f.field==='scope.lastCompletedTradingDay')).toMatchObject({state:'observed'});
  expect(company.facts.find(f=>f.field==='ordinaryShares')?.state).toBe('observed');
  expect(company.quoteDate).toBe('2026-09-09');expect(company.lastCompletedTradingDay).toBe('2026-09-09');
  await fs.writeFile(collected.inputFile,JSON.stringify(input));
  expect((await loadEvidenceInput(collected.inputFile)).input.companies[0]).toEqual(company);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
it('keeps verified new quote sources and a reviewed quote scope when legacy sources are also present',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-mixed-quote-boundary-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],asOf);
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:20000,globalRequests:12,globalMs:20000}},{now:()=>Date.parse(asOf),fetch:async(url,init)=>new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init)});
  const saved=(await loadEvidenceInput(collected.inputFile)).input;
  for(const source of saved.sources.filter(s=>['eastmoney-daily','eastmoney-session'].includes(s.mapping))) saved.sources.push({...source,id:`legacy:${source.id}`,requestStartedAt:undefined});
  const indicator=saved.sources.find(s=>s.mapping==='indicators')!;
  const review={schemaVersion:1,entity:'600660',basis:'test',asOf,reviewedAt:asOf,expiresAt:'2026-12-31T00:00:00.000Z',reviewer:'test',assertions:[{key:'quote',value:'applies',criteria:'synthetic verified share-rights scope',evidence:[{sourceId:indicator.id,locator:'/data/0/SECURITY_CODE',raw:'600660'}]}]};
  const reviewPath=path.join(path.dirname(collected.inputFile),'review.json'),reviewBytes=JSON.stringify(review);
  await fs.writeFile(reviewPath,reviewBytes);saved.sources.push({id:'review',mapping:'reviewed-scope-v1',path:'review.json',url:'https://example.test/review',mediaType:'application/json',fetchedAt:asOf,sha256:sha256(reviewBytes)});
  saved.companies[0].checks.quote={state:'applies',evidence:['review:0']};
  await fs.writeFile(collected.inputFile,JSON.stringify(saved));
  const company=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
  const price=company.facts.find(f=>f.field==='price');
  expect(price?.state).toBe('observed');
  expect(price?.evidence[0]?.sourceId.startsWith('legacy:')).toBe(false);
  expect(company.lastCompletedTradingDay).toBe('2026-09-09');
  expect(company.checks.quote).toMatchObject({state:'applies',evidence:['review:0']});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
it('uses the five-year statement window unless an applicable cycle condition needs older history',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-history-window-'));
 try {
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'920010',companyId:'920010',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:20000}},{fetch:async(url:string,init?:RequestInit)=>{
   const u=new URL(url),dates=u.searchParams.get('dates');
   if(!dates) return completeResponse(url,init);
   return new Response(JSON.stringify({data:dates.split(',').slice(0,5).map(date=>({SECURITY_CODE:'920010',REPORT_TYPE:'年报',REPORT_DATE:date,NOTICE_DATE:`${Number(date.slice(0,4))+1}-04-20`,CURRENCY:'CNY',PARENT_NETPROFIT:10,TOTAL_EQUITY:50,NETCASH_OPERATE:10}))}));
  }});
  const {input}=await loadEvidenceInput(collected.inputFile);
  for(const field of ['parentProfit','equity','operatingCashFlow']) expect([...new Set(input.companies[0].facts.filter(f=>f.field===field && f.state==='observed').map(f=>f.year))].sort()).toEqual([2021,2022,2023,2024,2025]);
  expect(input.collection?.requests).toBeLessThanOrEqual(12);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
it('selects statement family from eligible annual data, excluding a future update or interim row',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-family-'));
 try {
  const file=path.join(dir,'identity.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const urls:string[]=[],row={SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10};
  const fetch=async(url:string)=>{urls.push(url);return new Response(JSON.stringify({data:urls.length===1?[{...row,REPORT_DATE:'2026-12-31',ORG_TYPE:'保险'},{...row,ORG_TYPE:'保险',UPDATE_DATE:'2026-09-11'},{...row,REPORT_TYPE:'中报',REPORT_DATE:'2026-06-30',ORG_TYPE:'证券'},row]:[{...row,PARENT_NETPROFIT:10,TOTAL_EQUITY:50,NETCASH_OPERATE:10}]}));};
  await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:4,companyMs:10000,globalRequests:4,globalMs:10000},concurrency:1},{fetch});
  expect(urls).toHaveLength(4);expect(urls.slice(1).every(url=>new URL(url).searchParams.get('companyType')==='4')).toBe(true);
  expect(new URL(urls[0]).searchParams.get('filter')).toContain("(REPORT_DATE>='2021-12-31')");
  expect(new URL(urls[0]).searchParams.get('filter')).toContain("(REPORT_DATE<='2025-12-31')");
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('resumes the same cutoff from verified sources without duplicate IDs or refetching successful requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-resume-'));
 try {
  const file=path.join(dir,'identity.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const body=JSON.stringify({data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10,PARENT_NETPROFIT:10,TOTAL_EQUITY:50,NETCASH_OPERATE:10}]});
  const budget={attempts:1,requestMs:1000,companyRequests:10,companyMs:10000,globalRequests:1,globalMs:20000};
  const first=await collectCnEvidence(file,path.join(dir,'first'),{asOf:'2026-09-10',budget,concurrency:1},{fetch:async()=>new Response(body)});
  let calls=0;
  const second=await collectCnEvidence(first.inputFile,path.join(dir,'second'),{asOf:'2026-09-10',budget:{...budget,globalRequests:10},concurrency:1},{fetch:async(url:string,init?:RequestInit)=>{calls++;return completeResponse(url,init);}});
  expect(second.status).toBe('complete');expect(calls).toBe(6);
  const saved=(await loadEvidenceInput(second.inputFile)).input;
  expect(saved.collection?.events.filter(e=>e.state==='cache_hit')).toHaveLength(1);
  expect(new Set(saved.sources.map(s=>s.id)).size).toBe(saved.sources.length);
  const third=await collectCnEvidence(second.inputFile,path.join(dir,'third'),{asOf:'2026-09-10',budget:{...budget,globalRequests:10},concurrency:1},{fetch:async()=>{throw new Error('Network must not be called for the same completed cutoff');}});
  const cached=(await loadEvidenceInput(third.inputFile)).input;
  expect(third.status).toBe('complete');expect(cached.collection?.requests).toBe(0);expect(cached.collection?.events.filter(e=>e.state==='cache_hit')).toHaveLength(7);
  const archived=cached.sources.find(source=>source.mapping==='indicators')!;
  await fs.writeFile(path.resolve(path.dirname(third.inputFile),archived.path),'rewritten after collection');
  await expect(collectCnEvidence(third.inputFile,path.join(dir,'tampered'),{asOf:'2026-09-10',budget:{...budget,globalRequests:10},concurrency:1},{fetch:async()=>{throw new Error('Tampered cache must never fetch');}})).rejects.toThrow(/Source hash mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('does not query a historical PDF contract for a method-unknown company',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-cross-cutoff-pdf-'));
 try {
  const identity=path.join(dir,'identity.json'),budget={attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:20000};
  const writeIdentity=async(file:string)=>fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const calls:string[]=[];
  await writeIdentity(identity);
  await collectCnEvidence(identity,path.join(dir,'run'),{asOf:'2026-09-10',budget,concurrency:1},{now:()=>Date.parse('2026-09-11'),fetch:async(url,init)=>{calls.push(url);return completeResponse(url,init);}});
  expect(calls.some(url=>url.includes('cninfo') || url.endsWith('.PDF'))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

function completeResponse(url:string,init?:RequestInit):Response {
 if(url.endsWith('szse_stock.json')) return new Response(JSON.stringify({stockList:['600660','600276','920010'].map(code=>({code,orgId:`issuer-${code}`}))}));
 if(url.includes('/hisAnnouncement/query')) {
  const code=new URLSearchParams(String(init?.body)).get('stock')?.split(',')[0];
  return new Response(JSON.stringify({totalAnnouncement:1,hasMore:false,announcements:[{secCode:code,secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:`finalpage/2026-03-01/${code}.PDF`}]}));
 }
 if(url.endsWith('.PDF')) return new Response(Buffer.from(annualPdf.toString('latin1').replaceAll('600660',url.match(/(\d{6})\.PDF$/)![1]),'latin1'));
 const u=new URL(url),code=u.searchParams.get('secid')?.split('.')[1]??u.searchParams.get('code')?.slice(2)??u.searchParams.get('filter')?.match(/(\d{6})\./)?.[1]??'600660';
 if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA' && !u.searchParams.get('filter')?.includes('REPORT_TYPE')) {
  return new Response(JSON.stringify({success:true,result:{pages:1,data:[2026,2025].map(year=>({SECURITY_CODE:code,ORG_TYPE:'通用',CURRENCY:'CNY',REPORT_TYPE:'中报',REPORT_DATE:`${year}-06-30`,NOTICE_DATE:'2026-08-20',UPDATE_DATE:'2026-08-20',TOTALOPERATEREVE:100,PARENTNETPROFIT:10,KCFJCXSYJLR:8,NETCASH_OPERATE_PK:12}))}}));
 }
 if(u.hostname==='proxy.finance.qq.com') {
  const symbol=u.searchParams.get('param')!.split(',')[0];
  return new Response(JSON.stringify({code:0,data:{[symbol]:{day:[['2026-09-09','1','55.14']]}}}));
 }
 if(u.pathname.endsWith('/kline/get')) return new Response(JSON.stringify({data:{code,market:1,klines:['2026-09-09,50,55,56,49,100']}}));
 if(u.pathname.endsWith('/stock/get')) return new Response(JSON.stringify({data:{f57:code,f84:1000000,f86:Date.parse('2026-09-09T15:00:00+08:00')/1000}}));
 if(u.searchParams.get('reportName')==='RPT_F10_EH_EQUITY') return new Response(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:code,SECUCODE:u.searchParams.get('filter')?.match(/"([^"]+)"/)?.[1],END_DATE:'2026-05-01',NOTICE_DATE:'2026-04-28',TOTAL_SHARES:1000000,TOTAL_A_SHARES:1000000,B_FREE_SHARE:null,LIMITED_B_SHARES:null,H_FREE_SHARE:null,LIMITED_H_SHARES:null,OTHER_FREE_SHARES:null,PREFERRED_SHARES:null,CHANGE_REASON:'转增股上市'}]}}));
 return new Response(JSON.stringify({data:[{SECURITY_CODE:code,REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10,PARENT_NETPROFIT:10,TOTAL_EQUITY:50,NETCASH_OPERATE:10}]}));
}

function quoteReadyRows(ticker:string,years:number[]=[2021,2022,2023,2024,2025]) {
 return years.map(year=>({SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:`${year}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10,KCFJCXSYJLR:10,ROEJQ:20,ROEKCJQ:18,EPSJB:1,EPSKCJB:.9}));
}

async function writeQuoteReadyInput(dir:string,tickers:string[],asOf:string,cycle:'applies'|'not_applicable'='not_applicable') {
 const sources:any[]=[];
 for(const ticker of tickers) {
  const prefix=ticker.startsWith('6')?'SH':/^[489]/.test(ticker)?'BJ':'SZ';
  const rows={data:quoteReadyRows(ticker)},indicatorId=`indicators-${ticker}`,indicatorPath=`${indicatorId}.json`,indicatorBytes=JSON.stringify(rows);
  await fs.writeFile(path.join(dir,indicatorPath),indicatorBytes);
  const indicatorUrl='https://datacenter-web.eastmoney.com/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_F10_FINANCE_MAINFINADATA',columns:'ALL',filter:`(SECUCODE="${ticker}.${prefix}")(REPORT_TYPE="年报")(REPORT_DATE>='2021-12-31')(REPORT_DATE<='2025-12-31')`,pageSize:'50',pageNumber:'1',sortTypes:'-1',sortColumns:'REPORT_DATE'});
  sources.push({id:indicatorId,mapping:'indicators',path:indicatorPath,url:indicatorUrl,mediaType:'application/json',fetchedAt:'2026-03-01',sha256:sha256(indicatorBytes)});
  const reviewId=`review-${ticker}`,reviewPath=`${reviewId}.json`,review={schemaVersion:1,entity:ticker,basis:'test',asOf,reviewedAt:asOf,expiresAt:'2027-01-01',reviewer:'synthetic quote fixture',assertions:[
   {key:'method',value:'nonfinancial',coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'verified ordinary issuer route',evidence:[{sourceId:indicatorId,locator:'/data/0/SECURITY_CODE',raw:ticker}]},
   {key:'cycle',value:cycle,coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'verified fine business cycle route',evidence:[{sourceId:indicatorId,locator:'/data/0/SECURITY_CODE',raw:ticker}]},
  ]},reviewBytes=JSON.stringify(review);
  await fs.writeFile(path.join(dir,reviewPath),reviewBytes);
  sources.push({id:reviewId,mapping:'reviewed-scope-v1',path:reviewPath,url:`https://example.test/${reviewId}`,mediaType:'application/json',fetchedAt:asOf,sha256:sha256(reviewBytes)});
 }
 const companies=tickers.map(ticker=>({ticker,companyId:ticker,companyName:'Synthetic',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'applies',value:'nonfinancial',evidence:[`review-${ticker}:0`]},checks:{cycle:{state:cycle,evidence:[`review-${ticker}:1`]}},facts:[]}));
 const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies}));return file;
}

function quoteReadyStatementResponse(url:string,init?:RequestInit):Response {
 const u=new URL(url),ticker=u.searchParams.get('code')!.slice(2),dates=u.searchParams.get('dates')!.split(',');
 const rows=dates.map(date=>{const year=Number(date.slice(0,4)),base={SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:date,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用'};
  if(u.pathname.includes('lrbAjaxNew')) return {...base,PARENT_NETPROFIT:10,NETPROFIT:10,DEDUCT_PARENT_NETPROFIT:10,OPERATE_INCOME:100,TOTAL_PROFIT:12};
  if(u.pathname.includes('xjllbAjaxNew')) return {...base,NETCASH_OPERATE:12,CONSTRUCT_LONG_ASSET:2};
  return {...base,TOTAL_EQUITY:100,TOTAL_PARENT_EQUITY:100,MONETARYFUNDS:20,SHORT_LOAN:0,LONG_LOAN:0,LEASE_LIAB:0,NONCURRENT_LIAB_1YEAR:0,SHORT_BOND_PAYABLE:0,BOND_PAYABLE:0};
 });
 return new Response(JSON.stringify({data:rows}));
}
it('uses Tencent daily bars and verified share structure without sending legacy Eastmoney quote requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-tencent-quote-primary-'));
 try {
  const asOf='2026-09-10T03:00:00Z',file=await writeQuoteReadyInput(dir,['600660','600276'],asOf);
  const urls:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,budget:{attempts:1,requestMs:1000,companyRequests:14,companyMs:10000,globalRequests:26,globalMs:20000},concurrency:2},{now:()=>Date.parse(asOf),fetch:async(url:string,init?:RequestInit)=>{
   urls.push(url);const u=new URL(url);
   if(u.hostname==='proxy.finance.qq.com') {
    const symbol=u.searchParams.get('param')!.split(',')[0];
    const close=symbol==='sh600660'?'55.14':symbol==='sh600276'?'44.71':'3951.51';
    return new Response(JSON.stringify({code:0,data:{[symbol]:{day:[['2026-09-09','1',close],['2026-09-10','1','999']],qfqday:[['2026-09-09','1','888']]}}}));
   }
   if(u.hostname==='emweb.securities.eastmoney.com') return quoteReadyStatementResponse(url,init);
   return completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(collected.inputFile);
  expect(input.companies.map(c=>c.collection?.state)).toEqual(['complete','complete']);
  expect(input.companies.every(c=>c.facts.some(f=>f.field==='price'&&f.state==='observed'))).toBe(true);
  expect(input.companies.every(c=>c.facts.some(f=>f.field==='ordinaryShares'&&f.state==='observed'))).toBe(true);
  expect(urls.filter(url=>new URL(url).hostname==='proxy.finance.qq.com')).toHaveLength(3);
  expect(urls.some(url=>new URL(url).hostname==='push2his.eastmoney.com'||new URL(url).hostname==='push2.eastmoney.com')).toBe(false);
  expect(input.sources.some(s=>s.mapping==='tencent-daily')).toBe(true);
  expect(input.sources.some(s=>s.mapping==='share-structure')).toBe(true);
  const resumedUrls:string[]=[];
  const resumed=await collectCnEvidence(collected.inputFile,path.join(dir,'resumed'),{asOf,budget:{attempts:1,requestMs:1000,companyRequests:14,companyMs:10000,globalRequests:26,globalMs:20000},concurrency:2},{fetch:async url=>{resumedUrls.push(url);throw new Error('Verified structured sources should be reused');}});
  expect(resumedUrls).toHaveLength(2); // Seed indicators intentionally have no request-start time, so a new cutoff revalidates them.
  expect((await loadEvidenceInput(resumed.inputFile)).input.collection?.requests).toBe(2);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
it('collects Tencent quote operands and current share structure for concurrent companies',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-quote-collection-'));
 try {
  const file=await writeQuoteReadyInput(dir,['600660','600276'],'2026-09-10');
  const urls:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:24,globalMs:20000},concurrency:2},{now:()=>Date.parse('2026-09-10'),fetch:async(url:string,init?:RequestInit)=>{urls.push(url);const u=new URL(url);
   if(u.hostname==='proxy.finance.qq.com') {const symbol=u.searchParams.get('param')!.split(',')[0];return new Response(JSON.stringify({code:0,data:{[symbol]:{day:[['2026-09-09','1','55.14']]}}}));}
   return u.hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(collected.inputFile);
  expect(collected.status).toBe('complete');
  expect(urls.filter(url=>new URL(url).hostname==='proxy.finance.qq.com')).toHaveLength(3);
  expect(urls.some(url=>new URL(url).hostname==='push2his.eastmoney.com'||new URL(url).hostname==='push2.eastmoney.com')).toBe(false);
  for(const company of input.companies) {
   expect(company.quoteDate).toBe('2026-09-09');
   expect(company.facts.find(f=>f.field==='price')?.state).toBe('observed');
   expect(company.facts.find(f=>f.field==='ordinaryShares')?.state).toBe('observed');
   expect(company.facts.find(f=>f.field==='quote.shareStructure')?.state).toBe('observed');
   expect(company.checks.quote?.state).not.toBe('applies');
  }
  const output=path.join(dir,'run');await runEvidenceSnapshot(collected.inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:2});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('starts independent quote and share requests before either response is released',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-quote-overlap-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],asOf);
  let releaseQuotes!:()=>void,markOverlap!:()=>void;
  const quotesReleased=new Promise<void>(resolve=>{releaseQuotes=resolve}),overlap=new Promise<void>(resolve=>{markOverlap=resolve});
  const pending=new Set<string>();
  const collection=collectCnEvidence(file,path.join(dir,'collected'),{asOf,concurrency:1,budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:20000}},{now:()=>Date.parse(asOf),fetch:async(url:string,init?:RequestInit)=>{
   const u=new URL(url),isDaily=u.hostname==='proxy.finance.qq.com'&&u.searchParams.get('param')?.startsWith('sh600660,'),isStructure=u.searchParams.get('reportName')==='RPT_F10_EH_EQUITY';
   if(isDaily||isStructure) {
    pending.add(isDaily?'daily':'structure');
    if(pending.size===2) markOverlap();
    await quotesReleased;
   }
   return u.hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  await overlap;
  expect(pending).toEqual(new Set(['daily','structure']));
  releaseQuotes();
  const result=await collection,{input}=await loadEvidenceInput(result.inputFile);
  expect(input.companies[0].collection).toMatchObject({state:'complete',requests:8});
  expect(input.sources.some(source=>source.mapping==='tencent-daily')).toBe(true);
  expect(input.sources.some(source=>source.mapping==='share-structure')).toBe(true);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('drains aborted quote peers without overwriting the interrupted company state',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-quote-abort-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],asOf),controller=new AbortController();
  let markOverlap!:()=>void;
  const overlap=new Promise<void>(resolve=>{markOverlap=resolve}),pending=new Set<string>();
  const collection=collectCnEvidence(file,path.join(dir,'collected'),{asOf,concurrency:1,signal:controller.signal,budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:20000}},{now:()=>Date.parse(asOf),fetch:async(url:string,init?:RequestInit)=>{
   const u=new URL(url),isDaily=u.hostname==='proxy.finance.qq.com'&&u.searchParams.get('param')?.startsWith('sh600660,'),isStructure=u.searchParams.get('reportName')==='RPT_F10_EH_EQUITY';
   if(isDaily||isStructure) {
    pending.add(isDaily?'daily':'structure');
    if(pending.size===2) markOverlap();
    await new Promise<never>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
   }
   return u.hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  await overlap;
  controller.abort();
  const result=await collection,company=(await loadEvidenceInput(result.inputFile)).input.companies[0];
  expect(company.collection?.state).toBe('interrupted');
  expect(company.collection?.errors).not.toContain('collection_limit:company_requests');
  expect(company.collection?.errors).not.toContain('collection_limit:global_requests');
  expect(company.collection?.errors.some(error=>error.startsWith('tencent-daily:interrupted'))).toBe(true);
  expect(company.collection?.errors.some(error=>error.startsWith('share-structure:interrupted'))).toBe(true);
  expect((await loadEvidenceInput(result.inputFile)).input.sources.some(source=>source.mapping==='tencent-session')).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('keeps share-rights evidence when a quote fallback leaves no budget for the independent market-session check',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-share-rights-before-session-'));
 try {
  const asOf='2026-09-10',file=await writeQuoteReadyInput(dir,['600660'],asOf),urls:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,budget:{attempts:1,requestMs:1000,companyRequests:6,companyMs:10000,globalRequests:6,globalMs:20000},concurrency:1},{now:()=>Date.parse(asOf),fetch:async(url:string,init?:RequestInit)=>{
   urls.push(url);const u=new URL(url);
   if(u.hostname==='push2his.eastmoney.com') throw new Error('synthetic primary quote outage');
   if(u.hostname==='proxy.finance.qq.com') {
    const symbol=u.searchParams.get('param')!.split(',')[0];
    return new Response(JSON.stringify({code:0,data:{[symbol]:{day:[['2026-09-09','1','55.14']]}}}));
   }
   return u.hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  const company=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
  expect(company.collection?.requests).toBe(6);
  expect(company.facts.find(f=>f.field==='price')?.state).toBe('observed');
  expect(company.facts.find(f=>f.field==='ordinaryShares')?.state).toBe('observed');
  expect(company.facts.find(f=>f.field==='quote.shareStructure')?.state).toBe('observed');
  expect(urls.some(url=>new URL(url).hostname==='proxy.finance.qq.com' && url.includes('sh000001'))).toBe(false);
  const p3=evaluateCompany(company,await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname)).conditions.find(condition=>condition.id==='P3');
  expect(p3).toMatchObject({state:'unknown',reason:'quote_date_unverified',missing:expect.arrayContaining(['quote_date_unverified','market_session_unverified'])});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('does not let one company’s exhausted budget suppress a shared source another company can fetch',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-shared-budget-'));
 try {
  const file=await writeQuoteReadyInput(dir,['600660','600276'],'2026-09-10');
  let failures=0,sessions=0;
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:10,requestMs:1000,companyRequests:10,companyMs:10000,globalRequests:30,globalMs:20000},concurrency:1},{now:()=>Date.parse('2026-09-10'),fetch:async(url:string,init?:RequestInit)=>{
   if(url.includes('lrbAjaxNew') && url.includes('600660')) {failures++;return new Response('retry',{status:503});}
   if(new URL(url).searchParams.get('param')?.startsWith('sh000001,')) sessions++;
   return new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(collected.inputFile);
  expect(failures).toBe(9);expect(sessions).toBe(1);expect(input.companies[1].collection?.state).toBe('complete');
  expect(input.companies[0].collection?.state).toBe('budget_exhausted');
  expect(input.companies[0].lastCompletedTradingDay).toBe('2026-09-09');
  expect(input.companies[1].lastCompletedTradingDay).toBe('2026-09-09');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('uses a current fine business profile to request the two-year tail only for a verified cycle',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-cycle-history-profile-'));
 try {
  const asOf='2026-09-10',ticker='600660',prefix='SH',indicatorRows={data:quoteReadyRows(ticker)},indicatorBytes=JSON.stringify(indicatorRows),indicatorPath='indicators.json';
  await fs.writeFile(path.join(dir,indicatorPath),indicatorBytes);
  const indicatorUrl='https://datacenter-web.eastmoney.com/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_F10_FINANCE_MAINFINADATA',columns:'ALL',filter:`(SECUCODE="${ticker}.${prefix}")(REPORT_TYPE="年报")(REPORT_DATE>='2021-12-31')(REPORT_DATE<='2025-12-31')`,pageSize:'50',pageNumber:'1',sortTypes:'-1',sortColumns:'REPORT_DATE'});
  const profile=(mainBusiness:string)=>({success:true,result:{data:[{SECURITY_CODE:ticker,SECUCODE:`${ticker}.${prefix}`,BUSINESS_SCOPE:'研发、生产和销售电子产品',MAIN_BUSINESS:mainBusiness,INDUSTRYCSRC1:'专用设备制造业'}]}});
  const write=(name:string,mainBusiness:string)=>fs.writeFile(path.join(dir,`${name}-profile.json`),JSON.stringify(profile(mainBusiness))).then(async()=>{
   const profileBytes=await fs.readFile(path.join(dir,`${name}-profile.json`),'utf8');
   const review={schemaVersion:1,entity:ticker,basis:'test',asOf,reviewedAt:asOf,expiresAt:'2027-01-01',reviewer:'synthetic profile route',assertions:[{key:'method',value:'nonfinancial',coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'verified ordinary issuer route',evidence:[{sourceId:'indicators',locator:'/data/0/SECURITY_CODE',raw:ticker}]}]},reviewBytes=JSON.stringify(review);
   await fs.writeFile(path.join(dir,`${name}-review.json`),reviewBytes);
   const file=path.join(dir,`${name}.json`);await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[
    {id:'indicators',mapping:'indicators',path:indicatorPath,url:indicatorUrl,mediaType:'application/json',fetchedAt:'2026-03-01',sha256:sha256(indicatorBytes)},
    {id:'profile',mapping:'company-profile',path:`${name}-profile.json`,url:'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO',mediaType:'application/json',fetchedAt:asOf,sha256:sha256(profileBytes)},
   {id:'review',mapping:'reviewed-scope-v1',path:`${name}-review.json`,url:`https://example.test/${name}-review`,mediaType:'application/json',fetchedAt:asOf,sha256:sha256(reviewBytes)},
   ],companies:[{ticker,companyId:ticker,companyName:'Synthetic',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks:{},facts:[]}]}));return file;
  });
  const collect=async(file:string)=>{const urls:string[]=[];const result=await collectCnEvidence(file,path.join(dir,`${path.basename(file,'.json')}-out`),{asOf,strategy:'all',budget:{attempts:1,requestMs:1000,companyRequests:20,companyMs:20000,globalRequests:20,globalMs:20000}},{now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   urls.push(url);const u=new URL(url);
   if(u.hostname==='emweb.securities.eastmoney.com') {
    const response=quoteReadyStatementResponse(url,init);
    if(u.pathname.includes('zcfzbAjaxNew')) {
     const body=await response.json();for(const row of body.data)Object.assign(row,{TOTAL_CURRENT_ASSETS:100000000,TOTAL_LIABILITIES:20000000,MINORITY_EQUITY:0,OTHER_EQUITY_TOOL:0});
     return Response.json(body);
    }
    return response;
   }
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({data:quoteReadyRows(ticker,[2019,2020])}));
   return completeResponse(url,init);
  }});return {urls,input:(await loadEvidenceInput(result.inputFile)).input};};
  const cyclic=await collect(await write('cyclic','半导体芯片研发、生产和销售'));
  expect(cyclic.input.companies[0].facts.find(f=>f.field==='business.profile')).toBeDefined();
  expect(cyclic.input.companies[0].checks.cycle).toMatchObject({state:'applies',reason:'verified_fine_business_cycle_mapping'});
  const sevenYearIndex=cyclic.urls.findIndex(url=>new URL(url).searchParams.get('dates')?.includes("2019-12-31"));
  const quoteIndex=cyclic.urls.findIndex(url=>new URL(url).hostname==='proxy.finance.qq.com'&&new URL(url).searchParams.get('param')?.startsWith('sh600660,'));
  expect(sevenYearIndex).toBeGreaterThan(-1);
  // A current quote is a required independent operand; optional history must
  // not consume its slot in the bounded per-company request budget.
  expect(quoteIndex).toBeGreaterThan(-1);expect(quoteIndex).toBeLessThan(sevenYearIndex);
  expect(cyclic.input.companies[0].facts.filter(f=>f.field==='weightedRoe'&&f.state==='observed').map(f=>f.year)).toEqual(expect.arrayContaining([2019,2020]));
  const ordinary=await collect(await write('ordinary','电子产品研发、生产和销售'));
  expect(ordinary.input.companies[0].checks.cycle).toMatchObject({state:'not_applicable',reason:'standard_nonfinancial_window'});
  expect(ordinary.urls.some(url=>new URL(url).searchParams.get('filter')?.includes("2019-12-31"))).toBe(true);
  expect(ordinary.urls.some(url=>new URL(url).searchParams.get('dates')?.includes("2019-12-31"))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});


it('stops report supplementation after a reliable API quality failure while preserving other unknown conditions',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-failure-stop-'));
 try {
  const rows={data:Array.from({length:5},(_,i)=>({SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:`${2021+i}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',TOTAL_EQUITY:50,SCOPE_NOTE:'Synthetic issuer method evidence'}))};
  const review={schemaVersion:1,entity:'600660',basis:'test',asOf:'2026-09-01',reviewedAt:'2026-09-01',expiresAt:'2027-01-01',reviewer:'synthetic test',assertions:[{key:'method',value:'nonfinancial',coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'Synthetic method fixture',evidence:[{sourceId:'balance',locator:'/data/4/SCOPE_NOTE',raw:rows.data[4].SCOPE_NOTE}]}]};
  const sources=[];
  for(const [id,mapping,body] of [['balance','balance',rows],['review','reviewed-scope-v1',review]] as const) {
   const bytes=JSON.stringify(body);await fs.writeFile(path.join(dir,`${id}.json`),bytes);
   sources.push({id,mapping,path:`${id}.json`,url:`https://example.test/${id}`,mediaType:'application/json',fetchedAt:'2026-09-01',sha256:sha256(bytes)});
  }
  const file=path.join(dir,'input.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks:{},facts:[]}]}));
  const requests:string[]=[];
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:30,companyMs:20000,globalRequests:30,globalMs:20000}},{fetch:async(url,init)=>{
   requests.push(url);
   if(url.includes('datacenter-web')) return new Response(JSON.stringify({data:rows.data.map((row,i)=>({...row,PARENTNETPROFIT:i<2?-10:10}))}));
   return completeResponse(url,init);
  }});
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('datacenter-web');
  const company=(await loadEvidenceInput(result.inputFile)).input.companies[0];
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const evaluation=evaluateCompany(company,policy);
  expect(evaluation.quality).toBe('fail');
  expect(evaluation.conditions.find(c=>c.id==='N1')?.state).toBe('fail');
  expect(evaluation.conditions.some(c=>c.state==='unknown')).toBe(true);
  expect(company.collection).toMatchObject({state:'complete',stoppedAfterFailure:{policyVersion:policy.version,conditionIds:['N1']}});
  const run=path.join(dir,'run');await runEvidenceSnapshot(result.inputFile,run,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  expect(await replayEvidenceRun(run)).toMatchObject({matches:true,count:1});
  for(const scenario of ['evaluate-all','method-pending','missing-history','conflicting-history']) {
   const identity=JSON.parse(await fs.readFile(file,'utf8'));
   if(scenario==='method-pending') identity.companies[0].method={state:'unresolved',evidence:[]};
   if(scenario==='conflicting-history') {
    const bytes=JSON.stringify({data:rows.data.map(row=>({...row,PARENTNETPROFIT:10}))});
    await fs.writeFile(path.join(dir,'prior-profit.json'),bytes);
    identity.sources.push({id:'prior-profit',mapping:'indicators',path:'prior-profit.json',url:'https://example.test/prior-profit',mediaType:'application/json',fetchedAt:'2026-09-01',sha256:sha256(bytes)});
   }
   const scenarioFile=path.join(dir,`${scenario}.json`);await fs.writeFile(scenarioFile,JSON.stringify(identity));
   const calls:string[]=[];
   const collected=await collectCnEvidence(scenarioFile,path.join(dir,scenario),{asOf:'2026-09-10',evaluateAll:scenario==='evaluate-all',budget:{attempts:1,requestMs:1000,companyRequests:30,companyMs:20000,globalRequests:30,globalMs:20000}},{fetch:async(url,init)=>{
    calls.push(url);
    if(url.includes('datacenter-web')) return new Response(JSON.stringify({data:rows.data.map((row,i)=>({...row,PARENTNETPROFIT:i<2?-10:10})).filter((_,i)=>scenario!=='missing-history'||i>=2)}));
    return completeResponse(url,init);
   }});
   expect(calls.some(url=>url.endsWith('.PDF')),scenario).toBe(['missing-history','conflicting-history'].includes(scenario));
   const loaded=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
   expect(loaded.collection?.stoppedAfterFailure,scenario).toBeUndefined();
   if(scenario!=='evaluate-all') expect(evaluateCompany(loaded,policy).quality,scenario).toBe('unknown');
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},30000);

it('does not download historical reports to chase an unresolved current method',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-targeted-report-'));
 try {
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const pdfs:string[]=[];
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:30,companyMs:20000,globalRequests:30,globalMs:20000}},{fetch:async(url,init)=>{
   if(url.includes('/hisAnnouncement/query')) return new Response(JSON.stringify({totalAnnouncement:2,hasMore:false,announcements:[2025,2024].map(year=>({secCode:'600660',secName:'Synthetic',announcementTitle:`${year}年年度报告`,announcementTime:Date.parse(`${year+1}-03-01`),adjunctUrl:`finalpage/${year+1}-03-01/${year}-600660.PDF`}))}));
   if(url.endsWith('.PDF')) {pdfs.push(url);return new Response(Buffer.from(annualPdf.toString('latin1').replaceAll('2025',url.includes('2024-600660')?'2024':'2025'),'latin1'));}
   return completeResponse(url,init);
  }});
  expect(pdfs).toHaveLength(0);
  const c=(await loadEvidenceInput(result.inputFile)).input.companies[0];
  expect(c.method.state).toBe('unresolved');
  expect(c.collection?.errors).not.toContain('annual_report_supplement_unresolved');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('collects a structured bank profile before statements and stops on independently reliable profit failure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-profile-stop-'));
 try {
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'603323',companyId:'603323',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const requests:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:18,companyMs:20000,globalRequests:18,globalMs:20000}},{now:()=>Date.parse('2026-09-10'),fetch:async url=>{
   requests.push(url);
   if(new URL(url).searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO')return new Response(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:'603323',SECUCODE:'603323.SH',BUSINESS_SCOPE:'吸收公众存款;发放短期、中期和长期贷款',MAIN_BUSINESS:'公司金融',INDUSTRYCSRC1:'金融业-货币金融服务'}]}}));
   return new Response(JSON.stringify({result:{data:Array.from({length:5},(_,i)=>({SECURITY_CODE:'603323',ORG_TYPE:'银行',REPORT_DATE:`${2021+i}-12-31`,REPORT_TYPE:'年报',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',PARENTNETPROFIT:-10}))}}));
  }});
  const input=(await loadEvidenceInput(collected.inputFile)).input;
  expect(requests).toHaveLength(2);expect(new URL(requests[1]).searchParams.get('reportName')).toBe('RPT_F10_BASIC_ORGINFO');
  expect(input.companies[0].method).toMatchObject({state:'applies',value:'bank'});
  expect(input.companies[0].collection?.stoppedAfterFailure?.conditionIds).toContain('N1');
  const {runEvidenceSnapshot,replayEvidenceRun}=await import('../../src/cn/run-archive.js');
  const output=path.join(dir,'run');await runEvidenceSnapshot(collected.inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:1});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it.each(['quality','financial','all'] as const)('records a routed but unsupported financial lease without requesting method-specific statements, reports, or quotes (%s)',async strategy=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-financial-lease-unsupported-'));
 try {
  const asOf='2026-09-10',ticker='600660',file=path.join(dir,'input.json'),urls:string[]=[];
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker,companyId:ticker,companyName:'Synthetic lease issuer',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,strategy,budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:20_000,globalRequests:12,globalMs:20_000,pdfReports:1}},{now:()=>Date.parse(asOf),fetch:async url=>{
   urls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({result:{data:Array.from({length:5},(_,i)=>({SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:`${2021+i}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'银行',PARENTNETPROFIT:10}))}}));
   if(u.searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO') return new Response(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:ticker,SECUCODE:`${ticker}.SH`,BUSINESS_SCOPE:'金融租赁服务',MAIN_BUSINESS:'融资租赁',INDUSTRYCSRC1:'金融业-货币金融服务'}]}}));
   throw new Error(`Unexpected request ${url}`);
  }});
  const company=(await loadEvidenceInput(result.inputFile)).input.companies[0],policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const evaluation=evaluateCompany(company,policy,{strategy});
  expect(company.method).toMatchObject({state:'applies',value:'financial_lease'});
  if(strategy==='quality') expect(evaluation.conditions).toContainEqual(expect.objectContaining({id:'F.methodValidation',state:'unknown',reason:'financial_method_not_supported'}));
  else expect(evaluation.strategies?.financial_research?.conditions).toContainEqual(expect.objectContaining({id:'FR.method',state:'unknown',reason:'financial_method_not_supported'}));
  expect(urls).toHaveLength(2);
  expect(urls.some(url=>url.includes('NewFinanceAnalysis')||url.includes('cninfo')||url.includes('/kline/get')||url.includes('/stock/get'))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it.each(['supported','unsupported','disabled'] as const)('bounds a routed bank PDF supplement and preserves other companies (%s)',async(mode)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-bank-regulatory-pdf-'));
 try {
  const asOf='2026-09-10',file=await writeQuoteReadyInput(dir,['600276'],asOf);
  const seed=JSON.parse(await fs.readFile(file,'utf8'));
  seed.companies.push({ticker:'600660',companyId:'600660',companyName:'Synthetic bank',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]});
  await fs.writeFile(file,JSON.stringify(seed));
  const urls:string[]=[];
  const bankRows=(years:number[])=>years.map(year=>({SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:`${year}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'银行',PARENTNETPROFIT:10,ROEJQ:20,ROEKCJQ:18}));
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,budget:{attempts:1,requestMs:1000,companyRequests:20,companyMs:20000,globalRequests:40,globalMs:30000,pdfReports:mode==='disabled'?0:1},concurrency:1},{now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   urls.push(url);const u=new URL(url),code=u.searchParams.get('code')?.slice(2);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA'&&u.searchParams.get('filter')?.includes('600660')) return new Response(JSON.stringify({data:bankRows([2021,2022,2023,2024,2025])}));
   if(u.searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO') return new Response(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:'600660',SECUCODE:'600660.SH',BUSINESS_SCOPE:'吸收公众存款;发放短期、中期和长期贷款',MAIN_BUSINESS:'公司金融',INDUSTRYCSRC1:'金融业-货币金融服务'}]}}));
   if(u.hostname==='emweb.securities.eastmoney.com') {
    const response=quoteReadyStatementResponse(url,init),body=JSON.parse(await response.text());
    if(code==='600660') for(const row of body.data) row.ORG_TYPE='银行';
    return new Response(JSON.stringify(body));
   }
   if(u.hostname==='www.cninfo.com.cn'&&u.pathname.endsWith('szse_stock.json')) return new Response(JSON.stringify({stockList:[{code:'600660',orgId:'bank-issuer'}]}));
   if(u.hostname==='www.cninfo.com.cn'&&u.pathname.includes('/hisAnnouncement/query')) return new Response(JSON.stringify({totalAnnouncement:1,hasMore:false,announcements:[{secCode:'600660',secName:'Synthetic bank',orgId:'bank-issuer',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/600660.PDF'}]}));
   if(u.pathname.endsWith('600660.PDF')) return new Response(mode==='supported'?await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url)):'unsupported synthetic disclosure');
   return completeResponse(url,init);
  }});
  const input=(await loadEvidenceInput(collected.inputFile)).input,bank=input.companies.find(c=>c.ticker==='600660')!,ordinary=input.companies.find(c=>c.ticker==='600276')!;
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  expect(bank.method).toMatchObject({state:'applies',value:'bank'});
  expect(evaluateCompany(bank,policy).quality).toBe(mode==='supported'?'fail':'unknown');
  expect(urls.some(url=>url.endsWith('szse_stock.json'))).toBe(mode!=='disabled');
  expect(urls.some(url=>url.includes('/hisAnnouncement/query'))).toBe(mode!=='disabled');
  expect(urls.filter(url=>url.endsWith('600660.PDF'))).toHaveLength(mode==='disabled'?0:1);
  expect(bank.collection?.errors.some(error=>error.startsWith('cninfo-annual-pdf:'))).toBe(mode==='unsupported');
  if(mode==='supported') {
   expect(bank.facts.find(f=>f.field==='regulatory.actual.cet1'&&f.year===2025)).toMatchObject({state:'observed',value:.0934});
   const capital=evaluateCompany(bank,policy).conditions.find(c=>c.id==='F.risk');
   expect(capital?.state).toBe('fail');
   const run=path.join(dir,'run');await runEvidenceSnapshot(collected.inputFile,run,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
   expect(await replayEvidenceRun(run)).toMatchObject({matches:true,count:2});
  }
  expect(ordinary.collection?.state).toBe('complete');
  expect(ordinary.facts.find(f=>f.field==='price')?.state).toBe('observed');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});


it('can collect only structured sources without turning diagnostic gaps into PDF requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-api-only-'));
 try {
  const file=path.join(dir,'input.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const urls:string[]=[];
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',evaluateAll:true,pdfFallback:false,budget:{attempts:1,requestMs:1000,companyRequests:12,companyMs:10000,globalRequests:12,globalMs:20000}},{fetch:async(url,init)=>{urls.push(url);return completeResponse(url,init);}});
  expect(urls.some(url=>url.includes('cninfo') || /\.pdf$/i.test(url))).toBe(false);
  const {input}=await loadEvidenceInput(result.inputFile);
  expect(input.sources.some(s=>s.mapping==='indicators')).toBe(true);
  expect(evaluateCompany(input.companies[0],await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname),{evaluateAll:true}).priority).toBe('unknown');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it.each(['wrong-issuer','pdf-fallback-disabled','pdf-budget-disabled'] as const)('routes a life insurer from public structured evidence and bounds its missing-CAS25 report supplement (%s)',async(mode)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-life-insurance-pdf-'));
 try {
  const file=await writeLifeInsuranceIdentity(dir),urls:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{
   asOf:'2026-09-10',
   ...(mode==='pdf-fallback-disabled'?{pdfFallback:false}:{}),
   budget:{attempts:3,requestMs:1000,companyRequests:20,companyMs:20_000,globalRequests:20,globalMs:30_000,pdfReports:mode==='pdf-budget-disabled'?0:1},
  },{now:()=>Date.parse('2026-09-10'),fetch:lifeInsuranceFetch(urls)});
  const company=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
  expect(company.method).toMatchObject({state:'applies',value:'life_insurance'});
  expect(new Set(company.facts.filter(f=>f.field==='parentProfit'&&f.state==='observed').map(f=>f.year))).toEqual(new Set([2021,2022,2023,2024,2025]));
  expect(new Set(company.facts.filter(f=>f.field==='weightedRoe'&&f.state==='observed').map(f=>f.year))).toEqual(new Set([2021,2022,2023,2024,2025]));
  expect(company.facts.find(f=>f.field==='business.profile')?.state).toBe('observed');
  expect(evaluateCompany(company,await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname)).quality).toBe('unknown');
  const downloaded=urls.filter(url=>url.endsWith('601628.PDF'));
  expect(downloaded).toHaveLength(mode==='wrong-issuer'?1:0);
  expect(urls.some(url=>url.includes('/hisAnnouncement/query'))).toBe(mode==='wrong-issuer');
  if(mode==='wrong-issuer') {
   expect(company.collection?.errors.some(error=>/^cninfo-annual-pdf:PDF (?:cover identity\/year mismatch|identity\/year unverified):/.test(error))).toBe(true);
   expect(company.collection?.errors).toContain('annual_report_pdf_unavailable');
   expect(company.collection?.errors).toContain('annual_report_supplement_unresolved');
  } else expect(company.collection?.errors.some(error=>error.startsWith('cninfo-annual-pdf:'))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('does not supplement a life insurer after reliable five-year profit evidence already fails',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-life-insurance-failure-'));
 try {
  const file=await writeLifeInsuranceIdentity(dir),urls:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:1,requestMs:1000,companyRequests:20,companyMs:20_000,globalRequests:20,globalMs:30_000,pdfReports:1}},{now:()=>Date.parse('2026-09-10'),fetch:lifeInsuranceFetch(urls,true)});
  const company=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
  expect(company.method).toMatchObject({state:'applies',value:'life_insurance'});
  expect(company.collection?.stoppedAfterFailure?.conditionIds).toContain('N1');
  expect(urls.some(url=>url.includes('cninfo')||url.endsWith('.PDF'))).toBe(false);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

async function writeLifeInsuranceIdentity(dir:string):Promise<string> {
 const file=path.join(dir,'input.json');
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker:'601628',companyId:'601628',companyName:'Synthetic life insurer',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
 return file;
}

function lifeInsuranceFetch(urls:string[],lossMaking=false):(url:string,init?:RequestInit)=>Promise<Response> {
 return async(url,init)=>{
  urls.push(url);const u=new URL(url),dates=u.searchParams.get('dates');
  if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({data:Array.from({length:5},(_,i)=>({SECURITY_CODE:'601628',REPORT_TYPE:'年报',REPORT_DATE:`${2021+i}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'保险',PARENTNETPROFIT:lossMaking?-10:10,ROEJQ:20}))}));
  if(u.searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO') return new Response(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:'601628',SECUCODE:'601628.SH',BUSINESS_SCOPE:'人寿保险、健康保险、意外伤害保险',MAIN_BUSINESS:'人寿保险、健康保险、意外伤害保险',INDUSTRYCSRC1:'金融业-保险业'}]}}));
  if(u.hostname==='www.cninfo.com.cn'&&u.pathname.endsWith('szse_stock.json')) return new Response(JSON.stringify({stockList:[{code:'601628',orgId:'life-issuer'}]}));
  if(u.hostname==='www.cninfo.com.cn'&&u.pathname.includes('/hisAnnouncement/query')) return new Response(JSON.stringify({totalAnnouncement:1,hasMore:false,announcements:[{secCode:'601628',secName:'Synthetic life insurer',orgId:'life-issuer',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/601628.PDF'}]}));
  if(url.endsWith('601628.PDF')) return new Response(annualPdf);
  if(dates) return new Response(JSON.stringify({data:dates.split(',').map(date=>({SECURITY_CODE:'601628',REPORT_TYPE:'年报',REPORT_DATE:date,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'保险',PARENT_NETPROFIT:lossMaking?-10:10,NETPROFIT:lossMaking?-10:10,TOTAL_EQUITY:100}))}));
  return completeResponse(url,init);
 };
}

it.each([[9,'financial'],[9,'all'],[7,'financial'],[7,'all']] as const)('keeps quote collection open only while %s%% ROE is eligible for %s',async(roe,strategy)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-financial-quote-gate-'));
 try {
  const asOf='2026-09-10T03:00:00Z',ticker='600660';
  // Synthetic broker capital disclosure exercises the existing parser. It is
  // saved evidence, not a newly fetched report or a real-method acceptance case.
  const original=(await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1');
  const objects=[...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(m=>m[2]);
  const lines=['十三、母公司净资本及有关风险控制指标','单位：元','项目 2025 年末 2025 年初 本年末比本年初增减','风险覆盖率 373.25% 226.00% 上升 147.25 个百分点','资本杠杆率 40.52% 33.89% 上升 6.63 个百分点','流动性覆盖率 392.92% 217.37% 上升 175.55 个百分点','净稳定资金率 230.89% 172.57% 上升 58.32 个百分点','备注：2025 年初相关数据已根据 2025 年 1 月 1 日执行的《证券公司风险控制指标计算标准规定》（证监会公告〔2024〕13 号）口径进行调整。'];
  const stream=(rows:string[])=>{const data='BT /F1 5 Tf 10 780 Td 10 TL\n'+rows.map(line=>'<'+Buffer.from(line,'utf16le').swap16().toString('hex')+'> Tj T*\n').join('')+'ET\n';return `<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}endstream`;};
  objects[7]=stream(lines);objects[9]=stream([]);
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const indicatorRows=quoteReadyRows(ticker).map(row=>({...row,ORG_TYPE:'证券',ROEJQ:roe,ROEKCJQ:roe}));
  const indicator=JSON.stringify({data:indicatorRows});
  const index=JSON.stringify({announcements:[{secCode:ticker,secName:'Synthetic broker',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  const sources:any[]=[];
  for(const [id,mapping,body,url,mediaType] of [
   ['indicator','indicators',indicator,'https://datacenter-web.eastmoney.com/api/data/v1/get','application/json'],
   ['index','cninfo-announcements',index,'https://www.cninfo.com.cn/new/hisAnnouncement/query','application/json'],
   ['pdf','cninfo-annual-pdf',pdf,'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF','application/pdf'],
  ]) {const name=`${id}.${id==='pdf'?'pdf':'json'}`;await fs.writeFile(path.join(dir,name),body);sources.push({id,mapping,path:name,url,mediaType,fetchedAt:asOf,sha256:sha256(body),...(id==='pdf'?{disclosure:{sourceId:'index',locator:'/announcements/0'}}:{})});}
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker,companyId:ticker,companyName:'Synthetic broker',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const before=evaluateCompany((await loadEvidenceInput(file)).input.companies[0],policy,{strategy});
  expect(before.quality).toBe('fail');
  expect(before.strategies?.financial_research?.state).toBe(roe===9?'pass':'fail');
  const urls:string[]=[];
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,strategy,pdfFallback:false,budget:{attempts:1,requestMs:1000,companyRequests:20,companyMs:20000,globalRequests:20,globalMs:30000,pdfReports:0}}, {now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   urls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({data:indicatorRows}));
   if(u.hostname==='emweb.securities.eastmoney.com') {const data=await quoteReadyStatementResponse(url,init).json();for(const row of data.data) row.ORG_TYPE='证券';return new Response(JSON.stringify(data));}
   return completeResponse(url,init);
  }});
  const after=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
  expect(urls.some(url=>new URL(url).hostname==='proxy.finance.qq.com'&&new URL(url).searchParams.get('param')?.startsWith('sh600660,'))).toBe(roe===9);
  expect(urls.some(url=>url.endsWith('.PDF')||url.includes('cninfo'))).toBe(false);
  const result=evaluateCompany(after,policy,{strategy});
  expect(result.quality).toBe('fail');
  expect(result.strategies?.financial_research?.state).toBe(roe===9?'pass':'fail');
  if(roe===9) {
   expect(after.facts.find(f=>f.field==='price')).toMatchObject({state:'observed',value:55.14});
   expect(result.strategies?.financial_value?.conditions.find(c=>c.id==='FV.P3')).toMatchObject({state:'fail',value:expect.any(Number)});
  } else {
   expect(urls).toHaveLength(1);
   expect(after.collection?.stoppedAfterFailure?.conditionIds).toContain('FR.roe5');
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
},15000);

it.each(['enabled','disabled','zero-budget','all'] as const)('bounds a financial insurance-group supplement selected from structured identity (%s)',async mode=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-financial-insurance-group-'));
 try {
  const ticker='601601',asOf='2026-09-10',file=path.join(dir,'input.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker,companyId:ticker,companyName:'Uninformative name',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  policy.strategies!.financial.methods.push('insurance_group');
  const policyFile=path.join(dir,'policy.yaml');await fs.writeFile(policyFile,JSON.stringify(policy));
  const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
  const profile=profiles.find((p:{ticker:string})=>p.ticker===ticker).response;
  const urls:string[]=[];
  const output=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,strategy:mode==='all'?'all':'financial',policyFile,pdfFallback:mode!=='disabled',budget:{attempts:1,requestMs:1000,companyRequests:20,companyMs:20000,globalRequests:20,globalMs:30000,pdfReports:mode==='zero-budget'?0:1}}, {now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   urls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({data:quoteReadyRows(ticker).map(row=>({...row,ORG_TYPE:'保险'}))}));
   if(u.searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO') return new Response(JSON.stringify(profile));
   if(u.hostname==='emweb.securities.eastmoney.com') {const body=await quoteReadyStatementResponse(url,init).json();for(const row of body.data) row.ORG_TYPE='保险';return new Response(JSON.stringify(body));}
   if(u.pathname.endsWith('szse_stock.json')) return new Response(JSON.stringify({stockList:[{code:ticker,orgId:'synthetic-group'}]}));
   if(u.pathname.includes('/hisAnnouncement/query')) return new Response(JSON.stringify({totalAnnouncement:1,hasMore:false,announcements:[{secCode:ticker,secName:'Uninformative name',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:`finalpage/2026-03-01/${ticker}.PDF`}]}));
   if(u.pathname.endsWith('.PDF')) return new Response('unsupported disclosure; no parser expansion');
   throw new Error(`Unexpected request ${url}`);
  }});
  const c=(await loadEvidenceInput(output.inputFile)).input.companies[0];
  expect(c.method).toMatchObject({state:'applies',value:'insurance_group'});
  expect(evaluateCompany(c,policy,{strategy:'financial'}).strategies?.financial_research?.state).toBe('unknown');
  expect(urls.filter(url=>url.endsWith('.PDF'))).toHaveLength(mode==='enabled'||mode==='all'?1:0);
  expect(urls.some(url=>url.includes('/hisAnnouncement/query'))).toBe(mode==='enabled'||mode==='all');
  expect(urls.some(url=>url.includes('/kline/get'))).toBe(false);
  expect(c.collection!.requests).toBeLessThanOrEqual(8);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it.each([['000563','trust'],['002961','futures']] as const)('retains explicit financial risk gaps for API-only %s without starting PDF collection',async(ticker,method)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-financial-api-route-'));
 try {
  const asOf='2026-09-10T03:00:00Z';
  const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
  const profile=profiles.find((p:{ticker:string})=>p.ticker===ticker).response,body=JSON.stringify(profile);
  await fs.writeFile(path.join(dir,'profile.json'),body);
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[{id:'profile',mapping:'company-profile',path:'profile.json',url:'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO',mediaType:'application/json',fetchedAt:asOf,sha256:sha256(body)}],companies:[{ticker,companyId:ticker,companyName:'Synthetic financial statements with saved issuer profile',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const urls:string[]=[];
  const output=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,strategy:'financial',pdfFallback:false,budget:{attempts:1,requestMs:1000,companyRequests:10,companyMs:20000,globalRequests:10,globalMs:30000,pdfReports:0}}, {now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   urls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({data:quoteReadyRows(ticker).map(row=>({...row,ORG_TYPE:'通用',ROEJQ:9,ROEKCJQ:9}))}));
   if(u.searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO') return new Response(body);
   if(u.hostname==='emweb.securities.eastmoney.com') return quoteReadyStatementResponse(url,init);
   throw new Error(`Unexpected request ${url}`);
  }});
  const c=(await loadEvidenceInput(output.inputFile)).input.companies[0];
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const result=evaluateCompany(c,policy,{strategy:'financial'});
  expect(c.method).toMatchObject({state:'applies',value:method});
  expect(result.strategies?.financial_research).toMatchObject({state:'unknown',applicability:'pass'});
  expect(result.strategies?.financial_research?.conditions.find(c=>c.id==='F.risk')?.state).toBe('unknown');
  expect(urls.some(url=>url.includes('cninfo')||url.includes('/kline/get'))).toBe(false);
  expect(c.collection!.requests).toBeLessThanOrEqual(5);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('recovers captured evidence between checkpoints and ignores only an unfinished final journal write',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-journal-recovery-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,Array.from({length:240},(_,i)=>String(600660+i)),asOf);
  let calls=0,recovered=0;
  const result=await collectCnEvidence(file,path.join(dir,'live'),{asOf,concurrency:1,pdfFallback:false},{now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   if([101,1001].includes(++calls)) {
    await fs.rm(path.join(dir,'crashed'),{recursive:true,force:true});
    await fs.cp(path.join(dir,'live'),path.join(dir,'crashed'),{recursive:true});
    const journal=path.join(dir,'crashed','collection-journal.jsonl');
    await fs.appendFile(journal,'{"sequence":');
    const snapshot=(await loadEvidenceInput(path.join(dir,'crashed','input.json'))).input;
    expect(snapshot.collection?.events.filter(e=>e.state==='success')).toHaveLength(calls-1);
    expect(snapshot.sources.some(s=>s.id.startsWith('collected:'))).toBe(true);
    recovered++;
   }
   return new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  expect(recovered).toBe(2);
  expect(JSON.parse(await fs.readFile(result.inputFile,'utf8')).collectionJournal).toBeUndefined();
  await expect(fs.stat(path.join(dir,'live','collection-journal.jsonl'))).rejects.toThrow();
 }finally{await fs.rm(dir,{recursive:true,force:true});}
},20_000);

it('bounds a persistently broken Tencent daily endpoint while retaining independently fetched share structure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-tencent-daily-circuit-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',tickers=['600660','600661','600662','600663','600664','600665'];
  const file=await writeQuoteReadyInput(dir,tickers,asOf);let dailyCalls=0;
  const result=await collectCnEvidence(file,path.join(dir,'live'),{asOf,concurrency:1,pdfFallback:false},{now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   if(new URL(url).hostname==='proxy.finance.qq.com' && !url.includes('sh000001')) {dailyCalls++;throw new Error('fetch failed',{cause:{code:'UND_ERR_SOCKET'}});}
   return new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  const input=(await loadEvidenceInput(result.inputFile)).input;
  expect(dailyCalls).toBe(tickers.length);
  expect(input.collection?.events.filter(e=>e.reason==='endpoint_temporarily_unavailable')).toHaveLength(0);
  for(const c of input.companies) {
   expect(c.facts.some(f=>f.field==='ordinaryShares' && f.state==='observed')).toBe(true);
   expect(c.facts.some(f=>f.field==='price' && f.state==='observed')).toBe(false);
   expect(c.collection?.errors.some(error=>error.includes('tencent-daily'))).toBe(true);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('refreshes indicators and quotes but reuses annual statements within the default 30-day cache window, invalidating expiry, override, or a revised report',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-live-annual-cache-'));
 try {
  const firstAt='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],firstAt);
  const response=async(url:string,init?:RequestInit)=>new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  const first=await collectCnEvidence(file,path.join(dir,'first'),{pdfFallback:false,concurrency:1},{now:()=>Date.parse(firstAt),fetch:response});
  for(const mode of ['warm','override','expired','revised'] as const) {
   const urls:string[]=[],clock=Date.parse(firstAt)+(mode==='expired'?31*24:mode==='warm'||mode==='override'?25:1)*60*60*1000;
   // The public option is intentionally exercised at runtime too: a one-day
   // policy must not silently inherit the default 30-day reuse window.
   const options:any={cacheFile:first.inputFile,pdfFallback:false,concurrency:1,...(mode==='override'?{annualCacheDays:1}:{})};
   const result=await collectCnEvidence(file,path.join(dir,mode),options,{now:()=>clock,fetch:async(url,init)=>{
    urls.push(url);
    const res=await response(url,init);
    if(mode==='revised' && url.includes('RPT_F10_FINANCE_MAINFINADATA')) {
     const body=await res.json();for(const row of body.data??body.result.data)row.UPDATE_DATE='2026-09-10T08:30:00.000Z';return new Response(JSON.stringify(body));
    }
    return res;
   }});
   const cached=(await loadEvidenceInput(result.inputFile)).input.collection!.events.filter(e=>e.reason==='annual_statement_within_cache_window_and_fresh_indicator_publication');
   expect(cached.length).toBe(mode==='warm'?3:0);
   const recentCache=(await loadEvidenceInput(result.inputFile)).input.collection!.events.filter(e=>e.reason==='recent_financials_within_cache_window');
   expect(recentCache).toHaveLength(mode==='warm'?1:0);
   expect(urls.some(url=>url.includes('RPT_F10_FINANCE_MAINFINADATA'))).toBe(true);
   expect(urls.some(url=>url.includes('kline/get'))).toBe(true);
   expect(urls.some(url=>url.includes('zcfzbAjaxNew'))).toBe(mode!=='warm');
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('treats corrupted cached annual bytes as a bounded refresh instead of aborting collection',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-corrupt-annual-cache-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],asOf);
  const response=async(url:string,init?:RequestInit)=>new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  const first=await collectCnEvidence(file,path.join(dir,'first'),{pdfFallback:false,concurrency:1},{now:()=>Date.parse(asOf),fetch:response});
  const saved=(await loadEvidenceInput(first.inputFile)).input;
  const annual=saved.sources.find(source=>source.mapping==='income')!;
  await fs.writeFile(path.resolve(path.dirname(first.inputFile),annual.path),'corrupted archived statement bytes');
  const urls:string[]=[];
  const refreshed=await collectCnEvidence(file,path.join(dir,'refreshed'),{cacheFile:first.inputFile,pdfFallback:false,concurrency:1},{now:()=>Date.parse(asOf)+60*60*1000,fetch:async(url,init)=>{urls.push(url);return response(url,init);}});
  expect(refreshed.status).toBe('complete');
  expect(urls.some(url=>url.includes('lrbAjaxNew'))).toBe(true);
  const input=(await loadEvidenceInput(refreshed.inputFile)).input;
  expect(input.collection?.events.some(event=>event.reason?.startsWith('annual_cache_invalid:Source hash mismatch:'))).toBe(true);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it.each([['explicit-empty',JSON.stringify({data:[]}),false],['malformed',JSON.stringify({$types:{data:'Array'}}),true]] as const)('uses a negative annual cache only for a confirmed %s response',async(_mode,emptyResponse,refetch)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-negative-annual-cache-'));
 try {
  const asOf='2026-09-10T08:00:00.000Z',file=await writeQuoteReadyInput(dir,['600660'],asOf);
  const fetchFor=(urls:string[])=>async(url:string,init?:RequestInit)=>{
   urls.push(url);
   if(url.includes('lrbAjaxNew')) return new Response(emptyResponse);
   return new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  };
  const initialUrls:string[]=[];
  const first=await collectCnEvidence(file,path.join(dir,'first'),{pdfFallback:false,concurrency:1},{now:()=>Date.parse(asOf),fetch:fetchFor(initialUrls)});
  expect(initialUrls.some(url=>url.includes('lrbAjaxNew'))).toBe(true);
  const resumedUrls:string[]=[];
  const resumed=await collectCnEvidence(file,path.join(dir,'resumed'),{cacheFile:first.inputFile,pdfFallback:false,concurrency:1},{now:()=>Date.parse(asOf)+60*60*1000,fetch:fetchFor(resumedUrls)});
  expect(resumedUrls.some(url=>url.includes('lrbAjaxNew'))).toBe(refetch);
  const events=(await loadEvidenceInput(resumed.inputFile)).input.collection!.events;
  expect(events.some(event=>event.reason==='negative_cache_no_records')).toBe(!refetch);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('collects an independent leasing lead before specialist enrichment, saves its full set with zero display seats, and replays the decision',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-financial-lead-'));
 try {
  const asOf='2026-09-10',ticker='600660',file=path.join(dir,'input.json'),urls:string[]=[];
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:[{ticker,companyId:ticker,companyName:'Synthetic lease issuer',market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const collected=await collectCnEvidence(file,path.join(dir,'collected'),{asOf,strategy:'all',budget:{attempts:1,requestMs:1000,companyRequests:5,companyMs:20_000,globalRequests:5,globalMs:20_000,pdfReports:0}},{now:()=>Date.parse(asOf),fetch:async url=>{
   urls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA') return new Response(JSON.stringify({result:{data:[2023,2024,2025].map(y=>({SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:`${y}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'银行',PARENTNETPROFIT:200,EPSJB:2,BPS:10}))}}));
   if(u.searchParams.get('reportName')==='RPT_F10_BASIC_ORGINFO') return new Response(JSON.stringify({success:true,result:{data:[{SECURITY_CODE:ticker,SECUCODE:`${ticker}.SH`,BUSINESS_SCOPE:'金融租赁服务',MAIN_BUSINESS:'融资租赁',INDUSTRYCSRC1:'金融业-货币金融服务'}]}}));
   if(u.hostname==='proxy.finance.qq.com') {const symbol=u.searchParams.get('param')!.split(',')[0];return new Response(JSON.stringify({code:0,data:{[symbol]:{day:[['2026-09-09','5','5']]}}}));}
   if(u.searchParams.get('reportName')==='RPT_F10_EH_EQUITY') return new Response(JSON.stringify({success:true,result:{data:[{SECUCODE:`${ticker}.SH`,SECURITY_CODE:ticker,END_DATE:'2025-01-01',NOTICE_DATE:'2025-01-01',TOTAL_SHARES:100,TOTAL_A_SHARES:100,B_FREE_SHARE:null,LIMITED_B_SHARES:null,H_FREE_SHARE:null,LIMITED_H_SHARES:null,OTHER_FREE_SHARES:null,PREFERRED_SHARES:null,CHANGE_REASON:'上市'}]}}));
   throw new Error(`Unexpected specialist request ${url}`);
  }});
  const c=(await loadEvidenceInput(collected.inputFile)).input.companies[0];
  const policyFile=new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname,policy=await loadCnPolicy(policyFile);
  const evaluation=evaluateCompany(c,policy,{strategy:'all'});
  expect(evaluation.strategies?.financial_discount?.state).toBe('pass');
  expect(evaluation.strategies?.financial_research?.state).toBe('unknown');
  expect(urls).toHaveLength(5);expect(urls.some(u=>u.includes('NewFinanceAnalysis')||u.includes('cninfo'))).toBe(false);
  const run=path.join(dir,'run');await runEvidenceSnapshot(collected.inputFile,run,{policyFile,strategy:'all',backupLimit:0});
  const summary=JSON.parse(await fs.readFile(path.join(run,'summary.json'),'utf8'));
  expect(summary.displayed).toEqual([]);expect(summary.strategies.financial_discount.qualified).toEqual([`CN:${ticker}`]);
  expect(summary.candidateQueue).toMatchObject([{id:`CN:${ticker}`,tier:3,displayed:false,reason:'backup_limit',backupStrategy:'financial_discount'}]);
  expect(await replayEvidenceRun(run)).toMatchObject({matches:true,count:1});
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const result=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','candidates',run,'--financial-leads'],{cwd:new URL('../../',import.meta.url).pathname});
  expect(JSON.parse(result.stdout)).toMatchObject({count:1,candidates:[{id:`CN:${ticker}`,selection:{tier:3,displayed:false}}]});
  expect(JSON.parse(result.stdout).candidates[0]).not.toHaveProperty('recentFinancials');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},20000);

it('supplements frozen research qualifiers only, preserves annual decisions on failure, and replays recent source bindings',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-recent-supplement-'));
 try {
  const asOf='2026-09-10',file=await writeQuoteReadyInput(dir,['600660'],asOf);
  const seed=await collectCnEvidence(file,path.join(dir,'seed'),{asOf,pdfFallback:false},{fetch:async(url,init)=>
   new URL(url).hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init)});
  const {input}=await loadEvidenceInput(seed.inputFile);
  input.sources=input.sources.filter(s=>s.mapping!=='recent-financials').map(s=>({...s,path:path.resolve(path.dirname(seed.inputFile),s.path)}));
  for(const c of input.companies)c.facts=c.facts.filter(f=>!f.field.startsWith('recent.'));
  const frozen=path.join(dir,'frozen.json');await fs.writeFile(frozen,JSON.stringify(input));
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const before=evaluateCompany(input.companies[0],policy,{strategy:'all'});
  expect(before.research).toBe('pass');
  const options={asOf,recentOnly:true,pdfFallback:false,strategy:'all' as const,budget:{attempts:1,requestMs:1000,companyRequests:1,companyMs:10000,globalRequests:1,globalMs:10000}};
  for(const mode of ['success','failure','invalid-entity'] as const) {
   let calls=0;
   const result=await collectCnEvidence(frozen,path.join(dir,mode),{...options,budget:mode==='invalid-entity'?{...options.budget,attempts:3,companyRequests:3,globalRequests:3}:options.budget},{fetch:async(url,init)=>{
    calls++;expect(new URL(url).searchParams.get('reportName')).toBe('RPT_F10_FINANCE_MAINFINADATA');
    expect(new URL(url).searchParams.get('filter')).not.toContain('REPORT_TYPE');
    if(mode==='failure')throw new Error('synthetic recent API outage');
    const response=completeResponse(url,init);
    if(mode==='invalid-entity'){const body=await response.json();body.result.data[0].SECURITY_CODE='other';return new Response(JSON.stringify(body));}
    return response;
   }});
   expect(calls).toBe(1);
   const c=(await loadEvidenceInput(result.inputFile)).input.companies[0],after=evaluateCompany(c,policy,{strategy:'all'});
   const {recentFinancials:oldHint,collection:oldCollection,...oldCore}=before,{recentFinancials:newHint,collection:newCollection,...newCore}=after;
   expect(newCore).toEqual(oldCore);
   expect(c.facts.filter(f=>!f.field.startsWith('recent.'))).toEqual(input.companies[0].facts);
   expect(c.collection?.state).toBe(before.collection?.state);
   expect(newHint?.state).toBe(mode==='success'?'complete':'missing');
   if(mode!=='success')expect(c.collection?.errors.some(e=>e.startsWith('recent-financials:'))).toBe(true);
   if(mode==='success') {
    const cached=await collectCnEvidence(result.inputFile,path.join(dir,'cached'),options,{fetch:async()=>{throw new Error('unexpected network');}});
    expect((await loadEvidenceInput(cached.inputFile)).input.collection).toMatchObject({requests:0,events:expect.arrayContaining([expect.objectContaining({state:'cache_hit',reason:'recent_same_cutoff_facts'})])});
    const run=path.join(dir,'run');await runEvidenceSnapshot(cached.inputFile,run,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname,strategy:'all'});
    expect(await replayEvidenceRun(run)).toEqual({matches:true,count:1});
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
    const output=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','candidates',run],{cwd:new URL('../../',import.meta.url).pathname});
    const rows=JSON.parse(output.stdout).candidates;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ranking:after.researchRanking,recentFinancials:newHint,selection:{displayed:true}});
   } else if(mode==='failure') {
    const run=path.join(dir,'missing-run');await runEvidenceSnapshot(result.inputFile,run,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname,strategy:'all',displayLimit:0});
    const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
    const output=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','candidates',run],{cwd:new URL('../../',import.meta.url).pathname});
    expect(JSON.parse(output.stdout).candidates).toMatchObject([{recentFinancials:{state:'missing'},selection:{displayed:false,reason:'main_limit'}}]);
   }
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
},20000);

it.each([false,true])('requests seven-year repair and quotes after a reliable quality failure, then reuses cache (existing balance: %s)',async(existingBalance)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-independent-repair-'));
 try {
  const asOf='2026-09-10T03:00:00Z',ticker='600660',file=await writeQuoteReadyInput(dir,[ticker],asOf);
  const seed=JSON.parse(await fs.readFile(file,'utf8')),source=seed.sources.find((s:any)=>s.mapping==='indicators');
  const bytes=JSON.stringify({data:quoteReadyRows(ticker).map(r=>({...r,ROEJQ:2,ROEKCJQ:2}))});
  await fs.writeFile(path.join(dir,source.path),bytes);source.sha256=sha256(bytes);await fs.writeFile(file,JSON.stringify(seed));
  if (existingBalance) {
   // A known balance lets repair reach price before unrelated statement refreshes.
   const url='https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/zcfzbAjaxNew?'+new URLSearchParams({type:'0',code:'SH'+ticker,dates:'2025-12-31',companyType:'4'});
   const body=await quoteReadyStatementResponse(url).json();body.data[0].TOTAL_CURRENT_ASSETS=5;body.data[0].TOTAL_LIABILITIES=10;
   const balanceBytes=JSON.stringify(body),balancePath='balance-'+ticker+'.json';
   await fs.writeFile(path.join(dir,balancePath),balanceBytes);
   seed.sources.push({id:'balance-'+ticker,mapping:'balance',path:balancePath,url,mediaType:'application/json',fetchedAt:'2026-03-01',sha256:sha256(balanceBytes)});
   await fs.writeFile(file,JSON.stringify(seed));
  }
  const urls:string[]=[];
  const options={asOf,strategy:'all' as const,pdfFallback:false,concurrency:1,budget:{attempts:1,requestMs:1000,companyRequests:existingBalance?4:10,companyMs:15000,globalRequests:existingBalance?4:10,globalMs:15000}};
  const first=await collectCnEvidence(file,path.join(dir,'first'),options,{now:()=>Date.parse(asOf),fetch:async(url,init)=>{
   urls.push(url);const u=new URL(url);
   if(u.searchParams.get('reportName')==='RPT_F10_FINANCE_MAINFINADATA'&&u.searchParams.get('filter')?.includes('REPORT_TYPE')) {
    expect(u.searchParams.get('filter')).toContain('2019-12-31');
    return Response.json({data:quoteReadyRows(ticker,[2019,2020,2021,2022,2023,2024,2025]).map(r=>({...r,NOTICE_DATE:'2026-03-02',ROEJQ:2,ROEKCJQ:2}))});
   }
   return u.hostname==='emweb.securities.eastmoney.com'?quoteReadyStatementResponse(url,init):completeResponse(url,init);
  }});
  const {input}=await loadEvidenceInput(first.inputFile),policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const result=evaluateCompany(input.companies[0],policy,{strategy:'all'});
  expect(result.quality).toBe('fail');
  expect(result.strategies!.earnings_repair!.conditions.find(c=>c.id==='ER.history')?.state).toBe('pass');
  expect(result.strategies!.earnings_repair!.conditions.find(c=>c.id==='ER.price')?.state).toBe('fail');
  expect(urls.some(url=>new URL(url).hostname==='proxy.finance.qq.com')).toBe(true);
  expect(urls.some(url=>url.includes('cninfo'))).toBe(false);
  if(existingBalance) expect(urls.some(url=>url.includes('AjaxNew'))).toBe(false);
  let calls=0;await collectCnEvidence(first.inputFile,path.join(dir,'second'),options,{now:()=>Date.parse(asOf),fetch:async()=>{calls++;throw Error('cache expected');}});
  expect(calls).toBe(0);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
