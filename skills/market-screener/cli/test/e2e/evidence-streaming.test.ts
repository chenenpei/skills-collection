import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadEvidenceInput,sha256} from '../../src/cn/evidence.js';
import {evaluateCompanies} from '../../src/cn/screening.js';
import {loadCnPolicy} from '../../src/policy/loader.js';
import {runEvidenceSnapshot,readEvidenceRun,openEvidenceRun,replayEvidenceRun,compareEvidenceRuns,diagnoseEvidenceRun,explainCompanyCollectionDiagnostics} from '../../src/cn/run-archive.js';

it('preserves every evaluation across streamed and legacy archives, queries, replay and comparison',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-streamed-run-'));
 try {
  const companies=Array.from({length:24},(_,i)=>({ticker:String(600001+i),companyId:String(600001+i),companyName:`Synthetic ${i}`,market:'CN',currency:'CNY',asOf:'2026-05-01',latestFiscalYear:2025,basis:'test',method:{state:'unresolved',evidence:[]},checks:{},facts:[]}));
  const sources=[];
  for(const [i,c] of companies.entries()) {
   const bytes=JSON.stringify({data:[{SECURITY_CODE:c.ticker,REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENT_NETPROFIT:100+i}]}),name=`income-${i}.json`;
   await fs.writeFile(path.join(dir,name),bytes);
   sources.push({id:name,mapping:'income',path:name,url:`https://example.com/${name}`,mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(bytes)});
  }
  const inputFile=path.join(dir,'input.json');
  await fs.writeFile(inputFile,JSON.stringify({schemaVersion:1,companies,sources}));
  const policyFile=new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname,policy=await loadCnPolicy(policyFile);
  const expected=evaluateCompanies((await loadEvidenceInput(inputFile)).input.companies,policy,20,{evaluateAll:true});
  const output=path.join(dir,'streamed');
  await runEvidenceSnapshot(inputFile,output,{policyFile,displayLimit:20,evaluateAll:true});
  const metadata=JSON.parse(await fs.readFile(path.join(output,'input.json'),'utf8'));
  expect(metadata.schemaVersion).toBe(2);
  expect(metadata.companies.every((c:{facts:unknown[]})=>c.facts.length===0)).toBe(true);
  await expect(fs.access(path.join(output,'results.json'))).rejects.toThrow();
  const run=await readEvidenceRun(output);
  expect({results:run.results,summary:run.summary}).toEqual(JSON.parse(JSON.stringify(expected)));
  const opened=await openEvidenceRun(output);let count=0;
  for await(const record of opened.records()) {expect(record.result).toEqual(run.results[count]);expect(record.company).toEqual(run.input.companies[count++]);}
  expect(count).toBe(24);
  const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','explain','600012','--from-run',output]);
  expect(JSON.parse(stdout).result).toEqual(run.results[11]);
  expect(JSON.parse(stdout).facts.some((f:{field:string;value:number})=>f.field==='parentProfit'&&f.value===111)).toBe(true);
  const legacy=path.join(dir,'legacy');await fs.cp(output,legacy,{recursive:true});
  const input=JSON.stringify(run.input),results=JSON.stringify(run.results),manifest=structuredClone(run.manifest);
  manifest.schemaVersion=1;delete manifest.hashes['companies.jsonl'];delete manifest.hashes['results.jsonl'];
  manifest.hashes['input.json']=sha256(input);manifest.hashes['results.json']=sha256(results);
  await fs.writeFile(path.join(legacy,'input.json'),input);await fs.writeFile(path.join(legacy,'results.json'),results);
  await fs.writeFile(path.join(legacy,'manifest.json'),JSON.stringify(manifest));
  expect(await replayEvidenceRun(legacy)).toEqual({matches:true,count:24});
  expect((await compareEvidenceRuns(legacy,output)).companies).toEqual([]);
  // Capture IDs and local paths are bookkeeping, not a change to source evidence.
  await fs.writeFile(inputFile,JSON.stringify({schemaVersion:1,companies,sources:sources.map(s=>({...s,id:`renamed:${s.id}`}))}));
  const renamed=path.join(dir,'renamed');await runEvidenceSnapshot(inputFile,renamed,{policyFile,displayLimit:20,evaluateAll:true});
  const renaming=await compareEvidenceRuns(output,renamed);
  expect(renaming.changed.sources).toBe(false);expect(renaming.companies).toEqual([]);
  // Same reported amounts, different original JSON location: evidence must remain visible.
  const moved=JSON.stringify({result:JSON.parse(await fs.readFile(path.join(dir,sources[0].path),'utf8'))});
  await fs.writeFile(path.join(dir,sources[0].path),moved);sources[0].sha256=sha256(moved);
  await fs.writeFile(inputFile,JSON.stringify({schemaVersion:1,companies,sources}));
  const relocated=path.join(dir,'relocated');await runEvidenceSnapshot(inputFile,relocated,{policyFile,displayLimit:20,evaluateAll:true});
  const relocation=await compareEvidenceRuns(output,relocated);
  expect(relocation.changed.sources).toBe(true);
  expect(relocation.companies).toHaveLength(1);
  expect(relocation.companies[0]).toMatchObject({security:'CN:600001',changed:expect.arrayContaining(['evidence'])});
  expect(relocation.companies[0].changed).not.toContain('financialFacts');
  expect(relocation.companies[0].changed).not.toContain('qualification');
  // A changed derivation must be reported even if someone preserves the old verdict.
  const altered=path.join(dir,'altered');await fs.cp(output,altered,{recursive:true});
  const alteredResults=structuredClone(run.results);
  alteredResults[0].derivedFacts=[{...run.input.companies[0].facts.find(f=>f.field==='parentProfit')!,id:'synthetic-derived',field:'synthetic',state:'derived',derivation:{algorithm:'altered-algorithm',inputs:[run.input.companies[0].facts[0].id]}}];
  const alteredBytes=alteredResults.map(r=>JSON.stringify(r)+'\n').join(''),alteredManifest=structuredClone(run.manifest);
  alteredManifest.hashes['results.jsonl']=sha256(alteredBytes);
  await fs.writeFile(path.join(altered,'results.jsonl'),alteredBytes);await fs.writeFile(path.join(altered,'manifest.json'),JSON.stringify(alteredManifest));
  expect((await compareEvidenceRuns(output,altered)).companies[0].changed).toContain('derivedFacts');
  await expect(replayEvidenceRun(altered)).rejects.toThrow(/Replay result mismatch/);
  const renamedRun=await readEvidenceRun(renamed),renamedDerived=path.join(dir,'renamed-derived');await fs.cp(renamed,renamedDerived,{recursive:true});
  renamedRun.results[0].derivedFacts=[{...renamedRun.input.companies[0].facts.find(f=>f.field==='parentProfit')!,id:'another-local-id',field:'synthetic',state:'derived',derivation:{algorithm:'altered-algorithm',inputs:[renamedRun.input.companies[0].facts[0].id]}}];
  const renamedBytes=renamedRun.results.map(r=>JSON.stringify(r)+'\n').join('');
  renamedRun.manifest.hashes['results.jsonl']=sha256(renamedBytes);
  await fs.writeFile(path.join(renamedDerived,'results.jsonl'),renamedBytes);await fs.writeFile(path.join(renamedDerived,'manifest.json'),JSON.stringify(renamedRun.manifest));
  expect((await compareEvidenceRuns(altered,renamedDerived)).companies).toEqual([]);
  // Research-only changes are visible even when price qualification is unchanged.
  const researchChanged=path.join(dir,'research-changed');await fs.cp(output,researchChanged,{recursive:true});
  const researchResults=structuredClone(run.results);researchResults[0].research='fail';
  const researchBytes=researchResults.map(r=>JSON.stringify(r)+'\n').join(''),researchManifest=structuredClone(run.manifest);
  researchManifest.hashes['results.jsonl']=sha256(researchBytes);
  await fs.writeFile(path.join(researchChanged,'results.jsonl'),researchBytes);await fs.writeFile(path.join(researchChanged,'manifest.json'),JSON.stringify(researchManifest));
  const researchDiff=await compareEvidenceRuns(output,researchChanged);
  expect(researchDiff.companies[0]).toMatchObject({changed:['qualification'],before:{research:'unknown'},after:{research:'fail'}});
  await expect(replayEvidenceRun(researchChanged)).rejects.toThrow(/Replay result mismatch/);
  await fs.appendFile(path.join(output,'results.jsonl'),'{}\n');
  await expect(openEvidenceRun(output)).rejects.toThrow(/hash mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},30000);

it('derives saved-run necessary-condition and collection diagnostics from streamed records',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-breakdown-run-'));
 try {
  const sourceBytes=JSON.stringify({data:[{SECURITY_CODE:'NF',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',PARENT_NETPROFIT:1,CAPEX:null}]}),source={id:'capture',mapping:'income' as const,path:'capture.json',url:'https://example.test/capture',mediaType:'application/json' as const,fetchedAt:'2026-09-09',sha256:sha256(sourceBytes)};
  await fs.writeFile(path.join(dir,source.path),sourceBytes);
  const bankBytes=JSON.stringify({data:[{SECURITY_CODE:'BANK',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',PARENT_NETPROFIT:1}]}),bankCapture={id:'bank-capture',mapping:'income' as const,path:'bank-capture.json',url:'https://example.test/bank-capture',mediaType:'application/json' as const,fetchedAt:'2026-09-09',sha256:sha256(bankBytes)};await fs.writeFile(path.join(dir,bankCapture.path),bankBytes);
  const failedBytes=JSON.stringify({data:Array.from({length:5},(_,i)=>({SECURITY_CODE:'FAIL',REPORT_TYPE:'年报',REPORT_DATE:`${2021+i}-12-31`,NOTICE_DATE:`${2022+i}-03-01`,CURRENCY:'CNY',PARENT_NETPROFIT:-1}))}),failedCapture={id:'failed-capture',mapping:'income' as const,path:'failed-capture.json',url:'https://example.test/failed-capture',mediaType:'application/json' as const,fetchedAt:'2026-09-09',sha256:sha256(failedBytes)};await fs.writeFile(path.join(dir,failedCapture.path),failedBytes);
  const reviewSource=async(id:string,entity:string,value:string,sourceId:string,locator:string,raw:string)=>{
   const bytes=JSON.stringify({schemaVersion:1,entity,basis:'test',asOf:'2026-09-09',reviewedAt:'2026-09-09',expiresAt:'2027-01-01',reviewer:'synthetic test review',assertions:[{key:'method',value,coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'Synthetic method review',evidence:[{sourceId,locator,raw}]}]});
   const saved={id,path:`${id}.json`,url:`https://example.test/${id}`,mapping:'reviewed-scope-v1' as const,mediaType:'application/json' as const,fetchedAt:'2026-09-09',sha256:sha256(bytes)};await fs.writeFile(path.join(dir,saved.path),bytes);return saved;
  };
  const nfReview=await reviewSource('nf-review','NF','nonfinancial','capture','/data/0/SECURITY_CODE','NF'),bankReview=await reviewSource('bank-review','BANK','bank','bank-capture','/data/0/SECURITY_CODE','BANK'),failedReview=await reviewSource('failed-review','FAIL','nonfinancial','failed-capture','/data/4/SECURITY_CODE','FAIL');
  const fact=(id:string,field:string,year:number,state:'observed'|'missing',raw:unknown,entity=id==='bank-scope'?'BANK':'NF')=>({id,field,entity,year,period:{start:`${year}-01-01`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:'test',unit:field==='scope.method'?'text':'CNY',...(state==='observed'?{value:raw as string}:{}),state,evidence:[{sourceId:'capture',locator:field==='capex'?'/data/0/CAPEX':`/${id}`,raw}]});
  const input={schemaVersion:1 as const,sources:[source,bankCapture,failedCapture,nfReview,bankReview,failedReview],collection:{status:'partial' as const,asOf:'2026-09-09T00:00:00.000Z',startedAt:'2026-09-09T00:00:00.000Z',finishedAt:'2026-09-09T00:00:00.020Z',budget:{attempts:1,requestMs:10,companyRequests:2,companyMs:20,globalRequests:3,globalMs:30},requests:3,events:[
   {ticker:'NF',sourceId:'one',url:'https://example.test/one',attempt:1,state:'success' as const,durationMs:7,bytes:10},
   {ticker:'BANK',sourceId:'bank-capture',url:'https://example.test/two',attempt:1,state:'source_error' as const,durationMs:11,bytes:0,reason:'http_503'},
   {ticker:'BANK',sourceId:'cached',url:'https://example.test/cached',attempt:0,state:'cache_hit' as const,durationMs:2,bytes:10},
   {ticker:'BANK',sourceId:'bank-capture',url:'https://example.test/two',attempt:2,state:'success' as const,durationMs:3,bytes:10},
   {ticker:'FAIL',sourceId:'unavailable',url:'https://example.test/unavailable',attempt:1,state:'source_error' as const,durationMs:1,bytes:0,reason:'fetchfailed'},
  ]},companies:[
   {ticker:'NF',companyId:'NF',companyName:'Missing capex',market:'CN' as const,currency:'CNY',asOf:'2026-09-09',latestFiscalYear:2025,basis:'test',method:{state:'applies' as const,value:'nonfinancial' as const,evidence:['nf-review:0']},checks:{},collection:{state:'complete' as const,requests:1,errors:[]},facts:[fact('capex-null','capex',2025,'missing',null)]},
   {ticker:'BANK',companyId:'BANK',companyName:'Bank with missing data',market:'CN' as const,currency:'CNY',asOf:'2026-09-09',latestFiscalYear:2025,basis:'test',method:{state:'applies' as const,value:'bank' as const,evidence:['bank-review:0']},checks:{},collection:{state:'source_error' as const,requests:2,errors:[]},facts:[]},
   {ticker:'FAIL',companyId:'FAIL',companyName:'Known fail with gaps',market:'CN' as const,currency:'CNY',asOf:'2026-09-09',latestFiscalYear:2025,basis:'test',method:{state:'applies' as const,value:'nonfinancial' as const,evidence:['failed-review:0']},checks:{},collection:{state:'complete' as const,requests:0,errors:[]},facts:[]},
  ]};
  const inputFile=path.join(dir,'input.json'),output=path.join(dir,'run');await fs.writeFile(inputFile,JSON.stringify(input));
  await runEvidenceSnapshot(inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname,evaluateAll:true});
  const run=await openEvidenceRun(output),diagnostics=await diagnoseEvidenceRun(run);
  let streamedRequests=0,streamedRecords=0,streamedSourceErrors=0;
  for await(const {result} of run.records()) {streamedRecords++;streamedRequests+=result.collection?.requests??0;if(result.collection?.state==='source_error') streamedSourceErrors++;}
  expect(streamedRecords).toBe(run.summary.inputCount);
  expect(diagnostics.collection).toMatchObject({requests:{recorded:run.input.collection?.requests,companyTotal:streamedRequests},wallElapsedMs:20,eventDurationMs:24,cacheHits:1,sourceErrors:2,companyStates:{source_error:streamedSourceErrors},errors:{'http_503':1,fetchfailed:1}});
  expect(diagnostics.collection.issues.items).toEqual(expect.arrayContaining([expect.objectContaining({ticker:'BANK',endpoint:'https://example.test/two',sourceId:'bank-capture',category:'transport',causeCertainty:'observed',requestRecovery:'recovered',dataRecovery:'unknown',verifiedFields:[],source:expect.objectContaining({path:expect.stringContaining('sources/')})}),expect.objectContaining({ticker:'FAIL',reason:'fetchfailed',category:'transport',causeCertainty:'undetermined',requestRecovery:'not_recovered'})]));
  expect(diagnostics.collection.issues.byEndpointAndReason['https://example.test/two\u0000http_503']).toEqual({endpoint:'https://example.test/two',reason:'http_503',events:1,companies:1,actualRequests:1,skips:0});
  expect(Object.values(diagnostics.collection.issues.missingConditions).some(row=>row.ticker==='BANK' && row.association==='same_company_collection_issue' && row.causalCertainty==='undetermined')).toBe(true);
  expect(Object.values(diagnostics.collection.issues.missingConditions)).toContainEqual(expect.objectContaining({ticker:'NF',strategy:'quality',conditionId:'P3'}));
  expect(explainCompanyCollectionDiagnostics(diagnostics,'BANK')).toMatchObject({items:[expect.objectContaining({requestRecovery:'recovered'})],missingConditions:expect.arrayContaining([expect.objectContaining({association:'same_company_collection_issue',causalCertainty:'undetermined'})])});
  expect(diagnostics.necessaryConditions.N4).toMatchObject({states:{unknown:2},missing:{'capex:2025':{count:2,actionable:1,observedMissingOrNull:1,noSupportedMappingOrSourceFact:1},'operatingCashFlow:2025':{count:2,actionable:1}}});
  expect(diagnostics.necessaryConditions['F.methodValidation']).toBeUndefined();
  expect(diagnostics.diagnosis).toMatchObject({methodValidationPending:0,knownFailWithGaps:1,routing:{cycle:{states:{unresolved:3},reasons:{no_recorded_cycle_reason:3}}},byMethod:{bank:{companies:1,methodValidationPending:0,requests:2,eventDurationMs:16,sourceErrors:1,cacheHits:1},nonfinancial:{companies:2,requests:1,eventDurationMs:8,sourceErrors:1}},byIndustry:{unlabeled:{companies:3,requests:3,eventDurationMs:24,sourceErrors:2,cacheHits:1}}});
  expect(diagnostics.modelCalls).toBe(run.manifest.modelCalls);
  const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','filter-breakdown','--from-run',output],{cwd:new URL('../../',import.meta.url).pathname});
  const printed=JSON.parse(stdout);
  for(const [key,value] of Object.entries(run.summary)) expect(printed[key]).toEqual(value);
  expect(printed.diagnostics).toEqual(diagnostics);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},30000);
