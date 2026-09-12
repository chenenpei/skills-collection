import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runEvidenceSnapshot, readEvidenceRun, replayEvidenceRun, diagnoseEvidenceRun, openEvidenceRun } from '../../src/cn/run-archive.js';
import { collectCnEvidence } from '../../src/cn/collection.js';
import { loadEvidenceInput } from '../../src/cn/evidence.js';
import { brokerRegulatoryReferenceSourceId } from '../../src/cn/sources/financial-reports.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

it('runs explicit diagnostic evaluation through the CLI and replays its mode without granting qualification',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-evaluate-all-'));
 try {
  const content=JSON.stringify({data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'证券',PARENT_NETPROFIT:10}]});
  await fs.writeFile(path.join(dir,'income.json'),content);
  // A securities-format statement alone cannot distinguish a broker from a futures firm.
  // Supply original issuer PDF text with explicit securities-company regulatory rules.
  const original=(await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1');
  const objects=[...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(m=>m[2]);
  const lines=['十三、母公司净资本及有关风险控制指标','单位：元','项目 2025 年末 2025 年初 本年末比本年初增减','风险覆盖率 373.25% 226.00% 上升 147.25 个百分点','资本杠杆率 40.52% 33.89% 上升 6.63 个百分点','流动性覆盖率 392.92% 217.37% 上升 175.55 个百分点','净稳定资金率 230.89% 172.57% 上升 58.32 个百分点','备注：2025 年初相关数据已根据 2025 年 1 月 1 日执行的《证券公司风险控制指标计算标准规定》（证监会公告〔2024〕13 号）口径进行调整。'];
  const stream=(rows:string[])=>{const data='BT /F1 5 Tf 10 780 Td 10 TL\n'+rows.map(line=>'<'+Buffer.from(line,'utf16le').swap16().toString('hex')+'> Tj T*\n').join('')+'ET\n';return `<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}endstream`;};
  objects[7]=stream(lines);objects[9]=stream([]);
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);await fs.writeFile(path.join(dir,'index.json'),index);
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const sources=[{id:'income',path:'income.json',mapping:'income',url:'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/lrbAjaxNew',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:hash(content)},
   {id:'index',path:'index.json',mapping:'cninfo-announcements',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:hash(index)},
   {id:'pdf',path:'report.pdf',mapping:'cninfo-annual-pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-09-10',sha256:hash(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const normal=path.join(dir,'normal'),diagnostic=path.join(dir,'diagnostic');
  await runEvidenceSnapshot(file,normal,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','run','--policy','cn-quality','--input',file,'--output',diagnostic,'--evaluate-all'],{cwd:new URL('../../',import.meta.url).pathname});
  const before=await readEvidenceRun(normal),after=await readEvidenceRun(diagnostic);
  expect(after.results[0].method).toMatchObject({state:'applies',value:'broker'});
  expect(after.input.sources.find(source=>source.id===brokerRegulatoryReferenceSourceId)).toMatchObject({mapping:'regulatory-reference-v1'});
  expect(after.input.companies[0].facts.filter(fact=>fact.field.startsWith('regulatory.requirement.'))).toHaveLength(8);
  expect(after.input.companies[0].facts.find(fact=>fact.field==='regulatory.requirement.capitalLeverage'&&fact.year===2024)?.value).toBe(.08);
  expect(before.results[0].conditions.find(c=>c.id==='P2')?.state).toBe('not_evaluated');
  expect(after.results[0].conditions.find(c=>c.id==='P2')?.state).toBe('unknown');
  expect(after.results[0].conditions.find(c=>c.id==='P2')?.components?.length).toBeGreaterThan(0);
  expect(after.manifest).toMatchObject({evaluateAll:true});
  expect(after.results[0].quality).toBe(before.results[0].quality);expect(after.results[0].priority).toBe(before.results[0].priority);
  expect(after.summary.opportunityCount).toBe(0);
  expect(await replayEvidenceRun(diagnostic)).toMatchObject({matches:true,count:1});
  const {compareEvidenceRuns}=await import('../../src/cn/run-archive.js');
  expect((await compareEvidenceRuns(normal,diagnostic)).changed).toMatchObject({evaluateAll:true,policy:false,sources:false});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},20000);

it('preserves raw evidence through run, query and offline replay, and rejects corrupted facts', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'evidence-run-'));
  const content=JSON.stringify({profit:10});
  await fs.writeFile(path.join(dir,'source.json'),content);
  const input={schemaVersion:1,sources:[{id:'source',path:'source.json',url:'https://example.test/statement',mediaType:'application/json',fetchedAt:'2026-09-08T00:00:00Z',sha256:createHash('sha256').update(content).digest('hex')}],companies:[{
    ticker:'TEST',companyId:'test',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'v1',latestFiscalYear:2025,
    method:{state:'unresolved',evidence:[],reason:'business_scope_missing'},checks:{},facts:[{
      id:'profit',field:'parentProfit',entity:'test',year:2025,period:{start:'2025-01-01',end:'2025-12-31'},publishedAt:'2026-03-01',basis:'v1',unit:'CNY',state:'observed',value:10,
      evidence:[{sourceId:'source',locator:'/profit',raw:10}],
    }],
  }]};
  const inputPath=path.join(dir,'input.json'); await fs.writeFile(inputPath,JSON.stringify(input));
  const output=path.join(dir,'run');
  await runEvidenceSnapshot(inputPath,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  const run=await readEvidenceRun(output);
  expect(run.results).toHaveLength(1);
  expect(run.results[0]).toMatchObject({ticker:'TEST',quality:'unknown',priority:'unknown'});
  expect(run.summary.inputCount).toBe(1);
  expect(run.input.companies[0].facts[0].evidence[0].raw).toBe(10);
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:1});
  await fs.writeFile(path.join(output,'sources',`${input.sources[0].sha256}.json`),'{}');
  await expect(replayEvidenceRun(output)).rejects.toThrow(/hash/i);
  input.companies[0].facts[0].value=20;
  await fs.writeFile(inputPath,JSON.stringify(input));
  await expect(runEvidenceSnapshot(inputPath,path.join(dir,'bad'),{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname})).rejects.toThrow(/normaliz|value/i);
});

it('replays with the saved source implementation when the current workspace has moved on', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'archived-replay-'));
  const input=path.join(dir,'input.json');
  await fs.writeFile(input,JSON.stringify({schemaVersion:1,sources:[],companies:[]}));
  const output=path.join(dir,'run');
  await runEvidenceSnapshot(input,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  // Represent another compatible source revision without changing the actual worktree.
  const implFile=path.join(output,'implementation.json');
  const impl=JSON.parse(await fs.readFile(implFile,'utf8'));
  // Installed package metadata alone cannot identify the code that was executed.
  expect(impl.dependencyContents['node_modules/yaml']).toMatch(/^[a-f0-9]{64}$/);
  impl.files['cli/src/cn/screening.ts']+='\n// archived source revision\n';
  const archivedLock=JSON.parse(impl.files['cli/package-lock.json']);
  const yamlVersion=archivedLock.packages['node_modules/yaml'].version;
  archivedLock.packages[''].bin.screener='bin/screener.ts';
  impl.files['cli/package-lock.json']=JSON.stringify(archivedLock,null,2)+'\n';
  const content=JSON.stringify(impl,null,2)+'\n';await fs.writeFile(implFile,content);
  const manifestFile=path.join(output,'manifest.json');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  manifest.hashes['implementation.json']=createHash('sha256').update(content).digest('hex');
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:0});
  archivedLock.packages['node_modules/yaml'].version='0.0.0';
  impl.files['cli/package-lock.json']=JSON.stringify(archivedLock,null,2)+'\n';
  const changedLock=JSON.stringify(impl,null,2)+'\n';await fs.writeFile(implFile,changedLock);
  manifest.hashes['implementation.json']=createHash('sha256').update(changedLock).digest('hex');
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  await expect(replayEvidenceRun(output)).rejects.toThrow(/Replay dependencies differ/);
  // Restore the otherwise compatible archived lock before testing installed bytes.
  archivedLock.packages['node_modules/yaml'].version=yamlVersion;
  impl.files['cli/package-lock.json']=JSON.stringify(archivedLock,null,2)+'\n';
  impl.dependencyContents['node_modules/yaml']='0'.repeat(64);
  const changed=JSON.stringify(impl,null,2)+'\n';await fs.writeFile(implFile,changed);
  manifest.hashes['implementation.json']=createHash('sha256').update(changed).digest('hex');
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  await expect(replayEvidenceRun(output)).rejects.toThrow(/dependency content/i);
});

it('links a reusable scope review to dated issuer PDF text and replays its original bytes', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-scope-'));
  const pdf=await fs.readFile(new URL('../fixtures/synthetic-scope.pdf',import.meta.url));
  const discovery={announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'Synthetic2025年年度报告',announcementTime:Date.parse('2026-03-18T00:00:00+08:00'),adjunctUrl:'finalpage/2026-03-18/synthetic.PDF'}]};
  const review={schemaVersion:1,entity:'600660',basis:'v1',asOf:'2026-09-01',reviewedAt:'2026-09-01',expiresAt:'2027-01-01',reviewer:'synthetic test record',assertions:[{key:'method',value:'nonfinancial',criteria:'Business description identifies manufacturing',evidence:[{sourceId:'report',locator:'/pages/1/lines/1',raw:'The company manufactures automotive glass.'}]}]};
  const sources=[];
  for(const [id,mapping,document] of [['discovery','cninfo-announcements',discovery],['review','reviewed-scope-v1',review]] as const) {
    const content=JSON.stringify(document);await fs.writeFile(path.join(dir,`${id}.json`),content);
    sources.push({id,mapping,path:`${id}.json`,url:`https://www.cninfo.com.cn/${id}`,mediaType:'application/json',fetchedAt:'2026-09-09',sha256:createHash('sha256').update(content).digest('hex')});
  }
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);
  const quote=JSON.stringify({data:{f57:'600660',f84:100,f86:Date.parse('2026-09-08T15:00:00+08:00')/1000}});
  await fs.writeFile(path.join(dir,'quote.json'),quote);
  const input={schemaVersion:1,sources:[...sources,{id:'quote',mapping:'eastmoney-shares',path:'quote.json',url:'https://push2.eastmoney.com/api/qt/stock/get?secid=1.600660',mediaType:'application/json',fetchedAt:'2026-09-09',sha256:createHash('sha256').update(quote).digest('hex')},{id:'report',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-18/synthetic.PDF',mediaType:'application/pdf',fetchedAt:'2026-09-09',sha256:createHash('sha256').update(pdf).digest('hex'),disclosure:{sourceId:'discovery',locator:'/announcements/0'},pages:[1]}],companies:[{
    ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'v1',latestFiscalYear:2024,
    method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks:{},facts:[{id:'review:0',field:'scope.method',entity:'600660',year:2026,period:{start:'2026-09-01',end:'2026-09-01'},publishedAt:'2026-09-01',basis:'v1',unit:'text',state:'observed',value:'nonfinancial',evidence:[{sourceId:'review',locator:'/assertions/0/value',raw:'nonfinancial'}]}],
  }]};
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify(input));
  const output=path.join(dir,'run');await runEvidenceSnapshot(file,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  const run=await readEvidenceRun(output);
  expect(run.results[0].method.state).toBe('applies');
  expect(run.input.companies[0].latestFiscalYear).toBe(2025); // The report exists even though its numeric tables are not parsed.
  expect(run.results[0].quality).toBe('unknown');
  expect(run.input.sources.find(s=>s.id==='report')?.path).toMatch(/\.pdf$/);
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:1});
});

it('imports dated prices with an independent completed-session observation and rejects adjusted price inputs',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'price-run-'));
  const row='2026-09-09,54.30,55.14,55.52,53.85,1';
  const sources=[];
  for(const [id,mapping,code,secid] of [['price','eastmoney-daily','600660','1.600660'],['session','eastmoney-session','000001','1.000001']]) {
    const bytes=JSON.stringify({data:{code,market:1,klines:[row]}});await fs.writeFile(path.join(dir,`${id}.json`),bytes);
    sources.push({id,mapping,path:`${id}.json`,url:`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=0`,mediaType:'application/json',requestStartedAt:'2026-09-10',fetchedAt:'2026-09-10',sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const input={schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'v1',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify(input));
  const output=path.join(dir,'run');await runEvidenceSnapshot(file,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  const run=await readEvidenceRun(output);
  expect(run.input.companies[0]).toMatchObject({quoteDate:'2026-09-09',lastCompletedTradingDay:'2026-09-09'});
  expect(run.input.companies[0].facts.find(f=>f.field==='price')).toMatchObject({value:55.14});
  sources[0].url=sources[0].url.replace('fqt=0','fqt=1');await fs.writeFile(file,JSON.stringify(input));
  await expect(runEvidenceSnapshot(file,path.join(dir,'adjusted'),{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname})).rejects.toThrow(/unadjusted/i);
});

it('compares saved runs by changed inputs without attributing a rule change to new facts',async()=>{
 const {compareEvidenceRuns}=await import('../../src/cn/run-archive.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'evidence-compare-'));
 try {
  const makeInput=async(profit:number)=>{
   const body=JSON.stringify({data:[{SECURITY_CODE:'TEST',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',PARENT_NETPROFIT:profit}]}),hash=createHash('sha256').update(body).digest('hex');
   await fs.writeFile(path.join(dir,`${hash}.json`),body);
   const input={schemaVersion:1,sources:[{id:'source-'+profit,path:`${hash}.json`,url:'https://example.test/income',mapping:'income',mediaType:'application/json',fetchedAt:'2026-09-09',sha256:hash}],companies:[{ticker:'TEST',companyId:'TEST',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'v1',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
   const file=path.join(dir,`input-${profit}.json`);await fs.writeFile(file,JSON.stringify(input));return file;
  };
  const policyFile=new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname;
  const file=await makeInput(10),left=path.join(dir,'left'),capacity=path.join(dir,'capacity'),data=path.join(dir,'data');
  await runEvidenceSnapshot(file,left,{policyFile,displayLimit:20});
  await runEvidenceSnapshot(file,capacity,{policyFile,displayLimit:30});
  const capacityChange=await compareEvidenceRuns(left,capacity);
  expect(capacityChange.changed).toMatchObject({policy:false,implementation:false,displayLimit:true,sources:false});
  expect(capacityChange.companies).toEqual([]);
  await runEvidenceSnapshot(await makeInput(20),data,{policyFile,displayLimit:20});
  const dataChange=await compareEvidenceRuns(left,data);
  expect(dataChange.changed).toMatchObject({policy:false,implementation:false,displayLimit:false,sources:true});
  expect(dataChange.companies).toHaveLength(1);
  expect(dataChange.companies[0]).toMatchObject({security:'CN:TEST',changed:['financialFacts','evidence']});
  expect(await compareEvidenceRuns(left,left)).toMatchObject({added:[],removed:[],companies:[]});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},15000);

it('diagnoses and compares financial strategy archives without treating evidence IDs as qualification changes',async()=>{
 const {compareEvidenceRuns}=await import('../../src/cn/run-archive.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'financial-evidence-run-'));
 try {
  const policyFile=new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname;
  const input=async(sourceId:string,roe=9,lease=false)=>{
   // Exercise approved provider mappings: arbitrary imported facts are
   // intentionally rejected by the evidence boundary.
   const sources=[];
   const documents=[
    ['indicators',{data:[2021,2022,2023,2024,2025].map(year=>({SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:`${year}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'银行',PARENTNETPROFIT:10,ROEJQ:roe,ROEKCJQ:roe}))}],
    ['company-profile',{success:true,result:{data:[{SECURITY_CODE:'600660',SECUCODE:'600660.SH',BUSINESS_SCOPE:lease?'许可项目:金融租赁服务(依法须经批准)':'吸收公众存款;发放短期、中期和长期贷款',MAIN_BUSINESS:lease?'金融租赁':'公司金融',INDUSTRYCSRC1:'金融业-货币金融服务'}]}}],
   ] as const;
   for(const [mapping,document] of documents) {
    const bytes=JSON.stringify(document),hash=createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(path.join(dir,`${hash}.json`),bytes);
    sources.push({id:`${sourceId}-${mapping}`,path:`${hash}.json`,url:mapping==='company-profile'?'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO':`https://example.test/${mapping}`,mapping,mediaType:'application/json',fetchedAt:'2026-09-09',sha256:hash});
   }
   const file=path.join(dir,`input-${sourceId}.json`);
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic bank',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
   return file;
  };
  const left=path.join(dir,'left'),renamed=path.join(dir,'renamed'),changedValue=path.join(dir,'changed-value'),quality=path.join(dir,'quality'),ncav=path.join(dir,'ncav'),all=path.join(dir,'all');
  await runEvidenceSnapshot(await input('source-a'),left,{policyFile,strategy:'financial'});
  const diagnosis=await diagnoseEvidenceRun(await openEvidenceRun(left));
  expect(diagnosis.diagnosis.byMethod.bank.strategies).toMatchObject({financial_research:{unknown:1},financial_value:{unknown:1}});
  expect(diagnosis.necessaryConditions['FR.profits']).toMatchObject({qualification:'financial_research',states:{pass:1}});
  expect(diagnosis.necessaryConditions['FV.P3']).toMatchObject({qualification:'financial_value',states:{unknown:1}});
  expect(Object.keys(diagnosis.necessaryConditions)).not.toEqual(expect.arrayContaining(['N2','P1']));
  expect(Object.keys(diagnosis.diagnosis.rawReasons)).toContain('regulatory_context_missing:2025:closing');
  await runEvidenceSnapshot(await input('source-b'),renamed,{policyFile,strategy:'financial'});
  const renamedComparison=await compareEvidenceRuns(left,renamed);
  expect(renamedComparison.changed).toMatchObject({strategy:false,sources:false});
  expect(renamedComparison.companies).toEqual([]);
  await runEvidenceSnapshot(await input('source-c',10),changedValue,{policyFile,strategy:'financial'});
  expect((await compareEvidenceRuns(left,changedValue)).companies[0]).toMatchObject({security:'CN:600660',changed:expect.arrayContaining(['financialFacts','evidence'])});
  await runEvidenceSnapshot(await input('source-a'),quality,{policyFile,strategy:'quality'});
  const removedStrategies=await compareEvidenceRuns(left,quality),addedStrategies=await compareEvidenceRuns(quality,left);
  expect(removedStrategies.changed.strategy).toBe(true);
  for(const comparison of [removedStrategies,addedStrategies]) expect(comparison.companies[0].changed).toContain('strategyConditions');
  await runEvidenceSnapshot(await input('source-a'),ncav,{policyFile,strategy:'ncav'});
  await runEvidenceSnapshot(await input('source-a'),all,{policyFile,strategy:'all'});
  expect((await openEvidenceRun(ncav)).manifest.strategy).toBe('ncav');
  const allRun=await openEvidenceRun(all),allDiagnosis=await diagnoseEvidenceRun(allRun);
  expect(allRun.manifest.strategy).toBe('all');
  expect(allDiagnosis.diagnosis.byMethod.bank.strategies).toHaveProperty('ncav');
  expect(allDiagnosis.strategyConditions.financial_research['FR.profits']).toMatchObject({qualification:'financial_research',states:{pass:1}});
  expect(allDiagnosis.strategyConditions.financial_value['FR.profits']).toMatchObject({qualification:'financial_value',states:{pass:1}});
  expect(allDiagnosis.strategyConditions.quality_research['P1']).toBeDefined();
  const leaseRun=path.join(dir,'lease');
  await runEvidenceSnapshot(await input('lease',9,true),leaseRun,{policyFile,strategy:'all'});
  const leaseDiagnosis=await diagnoseEvidenceRun(await openEvidenceRun(leaseRun));
  expect(leaseDiagnosis.diagnosis.byMethod.financial_lease.methodNotSupported).toBe(1);
  expect(leaseDiagnosis.diagnosis.methodNotSupported).toBe(1);
  expect(leaseDiagnosis.strategyConditions.financial_research['FR.method']).toMatchObject({states:{unknown:1},machineReasons:{financial_method_not_supported:1},missing:{financial_method_not_supported:{actionable:0}}});
  expect(diagnosis.diagnosis.methodNotSupported).toBe(0);
  expect((await compareEvidenceRuns(ncav,all)).changed.strategy).toBe(true);
  expect(await replayEvidenceRun(ncav)).toMatchObject({matches:true,count:1});
  expect(await replayEvidenceRun(all)).toMatchObject({matches:true,count:1});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},45000);

it('executes the structured CN funnel for qualified, failed, missing and known special-claim companies',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-c1-funnel-'));
 try {
  const {sha256}=await import('../../src/cn/evidence.js');
  const asOf='2026-09-10T03:00:00Z',sources:any[]=[],companies:any[]=[];
  const save=async(id:string,mapping:string,body:unknown,url=`https://example.test/${id}`)=>{
   const bytes=JSON.stringify(body);await fs.writeFile(path.join(dir,`${id}.json`),bytes);
   sources.push({id,mapping,path:`${id}.json`,url,mediaType:'application/json',fetchedAt:asOf,requestStartedAt:asOf,sha256:sha256(bytes)});
  };
  for(const [index,ticker] of ['600001','600002','600003','600004','600005'].entries()) {
   const rows=Array.from({length:5},(_,i)=>({SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:`${2021+i}-12-31`,NOTICE_DATE:`${2022+i}-03-01`,CURRENCY:'CNY',ORG_TYPE:'通用',
    PARENT_NETPROFIT:100,PARENTNETPROFIT:100,NETPROFIT:100,DEDUCT_PARENT_NETPROFIT:100,KCFJCXSYJLR:100,ROEJQ:20,ROEKCJQ:20,
    NETCASH_OPERATE:100,CONSTRUCT_LONG_ASSET:index===1?110:index===2?null:10,
    TOTAL_EQUITY:1000,TOTAL_PARENT_EQUITY:1000,SHORT_LOAN:10,LONG_LOAN:10,BOND_PAYABLE:10,LEASE_LIAB:10,NONCURRENT_LIAB_1YEAR:10,SHORT_BOND_PAYABLE:10,
    OTHER_EQUITY_TOOL:index===0||index===3?100:0,PREFERRED_SHARES:index===3?100:null,
   }));
   for(const kind of ['income','balance','cashflow','indicators']) await save(`${ticker}-${kind}`,kind,{data:rows});
   const assertions=[{key:'method',value:'nonfinancial'},{key:'cycle',value:'not_applicable'}].map(a=>({...a,coverage:{start:'2021-01-01',end:'2025-12-31'},criteria:'Synthetic normal consumer business classification, not a real investment observation',evidence:[{sourceId:`${ticker}-income`,locator:'/data/4/SECURITY_CODE',raw:ticker}]}));
   await save(`${ticker}-review`,'reviewed-scope-v1',{schemaVersion:1,entity:ticker,basis:'test',asOf,reviewedAt:asOf,expiresAt:'2027-01-01',reviewer:'synthetic test fixture',assertions});
   await save(`${ticker}-daily`,'eastmoney-daily',{data:{code:ticker,market:1,klines:[index===4?'2026-09-09,50,50,50,50,100':'2026-09-09,5,5,5,5,100']}},`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.${ticker}&klt=101&fqt=0`);
   await save(`${ticker}-shares`,'eastmoney-shares',{data:{f57:ticker,f84:100,f86:Date.parse(asOf)/1000}},`https://push2.eastmoney.com/api/qt/stock/get?secid=1.${ticker}`);
   await save(`${ticker}-structure`,'share-structure',{success:true,result:{data:[{SECURITY_CODE:ticker,SECUCODE:`${ticker}.SH`,END_DATE:'2026-05-01',NOTICE_DATE:'2026-04-28',TOTAL_SHARES:100,TOTAL_A_SHARES:100,B_FREE_SHARE:null,LIMITED_B_SHARES:null,H_FREE_SHARE:null,LIMITED_H_SHARES:null,OTHER_FREE_SHARES:null,PREFERRED_SHARES:null,CHANGE_REASON:'期末股本'}]}},`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_EH_EQUITY&pageNumber=1&sortColumns=END_DATE&sortTypes=-1&filter=${encodeURIComponent(`(SECUCODE="${ticker}.SH")`)}`);
   companies.push({ticker,companyId:ticker,companyName:`Synthetic CN ${index}`,market:'CN',currency:'CNY',asOf,basis:'test',latestFiscalYear:2025,
    method:{state:'applies',value:'nonfinancial',evidence:[`${ticker}-review:0`]},checks:{cycle:{state:'not_applicable',evidence:[`${ticker}-review:1`]}},facts:[]});
  }
  await save('session','eastmoney-session',{data:{code:'000001',market:1,klines:['2026-09-09,1,1,1,1,100']}},'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=0');
  const inputFile=path.join(dir,'input.json');await fs.writeFile(inputFile,JSON.stringify({schemaVersion:1,sources,companies}));
  const output=path.join(dir,'run');
  await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','run','--policy','cn-quality','--input',inputFile,'--output',output,'--evaluate-all'],{cwd:new URL('../../',import.meta.url).pathname});
  const run=await readEvidenceRun(output);
  expect(run.manifest).toMatchObject({policyVersion:'cn-screening',strategy:'all',modelCalls:0,replayVerified:true});
  expect(run.results.map(r=>[r.quality,r.research,r.priority]),JSON.stringify(run.results[0].conditions.filter(c=>c.state==='unknown'))).toEqual([['pass','pass','pass'],['fail','fail','fail'],['unknown','unknown','unknown'],['pass','pass','unknown'],['pass','pass','fail']]);
  expect(run.results[1].conditions.find(c=>c.id==='N4')).toMatchObject({state:'fail',value:-50});
  expect(run.results[2].conditions.find(c=>c.id==='N4')).toMatchObject({state:'unknown'});
  expect(run.results[3].conditions.find(c=>c.id==='P3')?.missing.join(' ')).toMatch(/allocation|claim/);
  expect(run.results.every(r=>!r.conditions.some(c=>c.id==='N7'||c.id==='N8'))).toBe(true);
  expect(run.summary).toMatchObject({inputCount:5,qualityCount:3,researchCount:3,researchDisplayCount:3,researchCandidates:['CN:600001','CN:600005','CN:600004'],researchDisplayed:['CN:600001','CN:600005','CN:600004'],opportunityCount:1,displayCount:3});
  const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','explain','600001','--from-run',output],{cwd:new URL('../../',import.meta.url).pathname});
  expect(JSON.parse(stdout).result).toEqual(run.results[0]);
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:5});
  const breakdown=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','filter-breakdown','--from-run',output],{cwd:new URL('../../',import.meta.url).pathname});
  const printed=JSON.parse(breakdown.stdout);
  expect(printed.researchCount).toBe(3);
  expect(printed.diagnostics.diagnosis.byMethod.nonfinancial.research).toMatchObject({pass:3,fail:1,unknown:1});
  expect(printed.diagnostics.necessaryConditions['P1.return'].qualification).toBe('research');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},30000);


it('compares archived cyclic and missing context references without hanging or inventing a difference',async()=>{
 const {compareEvidenceRuns}=await import('../../src/cn/run-archive.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'context-reference-cycle-'));
 try {
  const value=JSON.stringify({weightedRoeFactId:'cycle',adjustedWeightedRoeFactId:'absent'});
  const body=JSON.stringify({context:value});
  await fs.writeFile(path.join(dir,'source.json'),body);
  const input={schemaVersion:1,sources:[{id:'source',path:'source.json',url:'https://example.test/context',mediaType:'application/json',fetchedAt:'2026-09-09',sha256:createHash('sha256').update(body).digest('hex')}],companies:[{
   ticker:'TEST',companyId:'test',companyName:'Synthetic malformed context',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[{
    id:'cycle',field:'earnings.returnContext',entity:'test',year:2025,period:{start:'2025-01-01',end:'2025-12-31'},publishedAt:'2026-03-01',basis:'test',unit:'text',state:'observed',value,evidence:[{sourceId:'source',locator:'/context',raw:value}],
   }],
  }]};
  const inputPath=path.join(dir,'input.json'),output=path.join(dir,'run');
  await fs.writeFile(inputPath,JSON.stringify(input));
  await runEvidenceSnapshot(inputPath,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  expect((await compareEvidenceRuns(output,output)).companies).toEqual([]);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},10000);

it('preserves the complete identity input when the global request budget ends mid-company',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-collection-'));
 try {
  const file=path.join(dir,'identities.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources:[],companies:['600660','600276','600519'].map(ticker=>({ticker,companyId:ticker,companyName:`Synthetic ${ticker}`,market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}))}));
  let calls=0;
  const fetch=async(url:string)=>{calls++;const code='600660';return new Response(JSON.stringify({data:[{SECURITY_CODE:code,REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10,PARENT_NETPROFIT:10,TOTAL_EQUITY:50}]}));};
  const result=await collectCnEvidence(file,path.join(dir,'collected'),{asOf:'2026-09-10',budget:{attempts:2,requestMs:1000,companyRequests:8,companyMs:5000,globalRequests:1,globalMs:10000},concurrency:1},{fetch});
  expect(calls).toBe(1);expect(result.status).toBe('partial');
  const {input}=await loadEvidenceInput(result.inputFile);
  expect(input.companies.map(c=>c.ticker)).toEqual(['600660','600276','600519']);
  expect(input.companies[0].collection?.state).toBe('budget_exhausted');
  expect(input.companies[1].collection?.state).toBe('pending');
  expect(input.companies[0].facts.some(f=>f.field==='parentProfit' && f.value===10)).toBe(true);
  expect(input.collection?.requests).toBe(1);
  const output=path.join(dir,'run');
  await runEvidenceSnapshot(result.inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  const run=await readEvidenceRun(output);
  expect(run.manifest.status).toBe('partial');
  expect(run.summary.terminalCounts).toEqual({collection_budget_exhausted:1,collection_pending:2});
  expect(run.results.find(c=>c.ticker==='600276')?.conditions).toEqual([]);
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:3});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},15000);
