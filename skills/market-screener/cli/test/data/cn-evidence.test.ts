import { expect,it } from 'vitest';
import { parseCnStatementFacts } from '../../src/cn/sources/market-data.js';
import { parseCnPriceFacts, parseCnShareStructureFacts } from '../../src/cn/sources/market-data.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadEvidenceInput,sha256,resolveStatementMethod} from '../../src/cn/evidence.js';
import type {CompanyFacts} from '../../src/shared/financial-model.js';
import {evaluateCompany} from '../../src/cn/screening.js';
import {parseCnListingPage,reconcileCnUniverse} from '../../src/cn/sources/listings.js';
import {loadCnPolicy} from '../../src/policy/loader.js';

it('preserves effective and announcement dates and ordinary share classes from the latest structure snapshot',()=>{
 const row={SECUCODE:'920009.BJ',SECURITY_CODE:'920009',END_DATE:'2026-05-13 00:00:00',NOTICE_DATE:'2026-04-30 00:00:00',TOTAL_SHARES:77546000,TOTAL_A_SHARES:77546000,B_FREE_SHARE:null,LIMITED_B_SHARES:null,H_FREE_SHARE:null,LIMITED_H_SHARES:null,OTHER_FREE_SHARES:null,PREFERRED_SHARES:null,CHANGE_REASON:'转增股上市'};
 const options={sourceId:'structure',entity:'920009',basis:'reported',asOf:'2026-09-10T03:00:00Z',observedAt:'2026-09-10T02:59:00Z'};
 const url='https://datacenter.eastmoney.com/securities/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_F10_EH_EQUITY',columns:'ALL',filter:'(SECUCODE="920009.BJ")',pageNumber:'1',sortColumns:'END_DATE',sortTypes:'-1'});
 const body={success:true,result:{data:[row,{...row,END_DATE:'2025-11-03 00:00:00',TOTAL_SHARES:55390000,TOTAL_A_SHARES:55390000}]}};
 const facts=parseCnShareStructureFacts(body,url,options);
 expect(facts.find(f=>f.field==='quote.shareHistory')).toBeDefined();
 const structure=facts.find(f=>f.field==='quote.shareStructure')!;
 expect(structure).toMatchObject({period:{start:options.observedAt,end:options.observedAt},publishedAt:options.observedAt});
 expect(JSON.parse(String(structure.value))).toMatchObject({effectiveDate:'2026-05-13',announcedAt:'2026-04-30',totalShares:77546000,aShares:77546000,bShares:null,hShares:null});
 expect(structure.evidence).toContainEqual({sourceId:'structure',locator:'/result/data/0/TOTAL_SHARES',raw:77546000});
 expect(facts.find(f=>f.field==='ordinaryShares')).toMatchObject({value:77546000,unit:'shares',period:{start:'2026-09-10',end:'2026-09-10'},publishedAt:options.observedAt,evidence:[{sourceId:'structure',locator:'/result/data/0/TOTAL_SHARES',raw:77546000}],reason:'eastmoney_current_total_ordinary_shares_reconciled'});
 expect(parseCnShareStructureFacts(body,url,{...options,asOf:'2026-09-09'})).toEqual([]);
 expect(()=>parseCnShareStructureFacts(body,url.replace('pageNumber=1','pageNumber=2'),options)).toThrow(/structure/);
 expect(()=>parseCnShareStructureFacts(body,url,{...options,entity:'600660'})).toThrow(/identity/);
 const invalid=structuredClone(body);invalid.result.data[0].TOTAL_SHARES=-1;
 expect(parseCnShareStructureFacts(invalid,url,options)).toEqual([]); // Never fall back to the older, apparently usable record.
});

it('uses a structural ordinary-share fallback only when known classes exactly exhaust the total',()=>{
 const row={SECUCODE:'600660.SH',SECURITY_CODE:'600660',END_DATE:'2026-05-01 00:00:00',NOTICE_DATE:'2026-04-28 00:00:00',TOTAL_SHARES:100,TOTAL_A_SHARES:60,B_FREE_SHARE:40,LIMITED_B_SHARES:null,H_FREE_SHARE:null,LIMITED_H_SHARES:null,OTHER_FREE_SHARES:null,PREFERRED_SHARES:null,CHANGE_REASON:'股份性质变更'};
 const options={sourceId:'structure',entity:'600660',basis:'reported',asOf:'2026-09-10T03:00:00Z',observedAt:'2026-09-10T02:59:00Z'};
 const url='https://datacenter.eastmoney.com/securities/api/data/v1/get?'+new URLSearchParams({reportName:'RPT_F10_EH_EQUITY',columns:'ALL',filter:'(SECUCODE="600660.SH")',pageNumber:'1',sortColumns:'END_DATE',sortTypes:'-1'});
 const parse=(value:typeof row)=>parseCnShareStructureFacts({success:true,result:{data:[value]}},url,options).filter(f=>f.field==='ordinaryShares');
 expect(parse(row)).toMatchObject([{value:100,reason:'eastmoney_current_total_ordinary_shares_reconciled'}]);
 // The unknown B class is not assumed to be zero when the known total is short.
 expect(parse({...row,B_FREE_SHARE:null})).toEqual([]);
 expect(parse({...row,PREFERRED_SHARES:1})).toEqual([]);
 expect(parse({...row,OTHER_FREE_SHARES:1})).toEqual([]);
});

it('loads ordered company records separately from the identity catalogue and rejects missing or swapped records',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-company-records-'));
 try {
  const companies=['600660','600276'].map(ticker=>({ticker,companyId:ticker,companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',latestFiscalYear:2025,basis:'test',method:{state:'unresolved',evidence:[]},checks:{},facts:[]}));
  const file=path.join(dir,'input.json');
  const save=async(records:unknown[])=>{
   const bytes=records.map(c=>{const {market,ticker,facts}=c as typeof companies[number];return JSON.stringify({market,ticker,facts})+'\n';}).join('');await fs.writeFile(path.join(dir,'companies.jsonl'),bytes);
   await fs.writeFile(file,JSON.stringify({schemaVersion:2,companies,sources:[],companyRecords:{path:'companies.jsonl',sha256:sha256(bytes)}}));
   return loadEvidenceInput(file);
  };
  expect((await save(companies)).input.companies.map(c=>c.ticker)).toEqual(['600660','600276']);
  await expect(save(companies.slice(0,1))).rejects.toThrow(/record count/);
  await expect(save([...companies].reverse())).rejects.toThrow(/catalogue/);
  await save(companies);
  await fs.appendFile(path.join(dir,'companies.jsonl'),'{}\n');
  await expect(loadEvidenceInput(file)).rejects.toThrow();
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('reads original source paths on demand and rejects changed bytes instead of serving cached evidence',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-lazy-source-'));
 try {
  const raw='{"diagnostic":true}',file=path.join(dir,'input.json');
  await fs.writeFile(path.join(dir,'raw.json'),raw);
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,companies:[],sources:[{id:'raw',path:'raw.json',url:'https://example.com/raw',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(raw)}]}));
  const loaded=await loadEvidenceInput(file);
  expect(typeof loaded.readSource).toBe('function');
  loaded.input.sources[0].path='sources/archived.json';
  expect((await loaded.readSource('raw')).toString()).toBe(raw);
  await expect(loaded.readSource('absent')).rejects.toThrow(/Missing source/);
  await fs.writeFile(path.join(dir,'raw.json'),'{"diagnostic":false}');
  await expect(loaded.readSource('raw')).rejects.toThrow(/hash mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('does not retain the full batch of original byte buffers after loading',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-source-memory-'));
 try {
  const sources=[];
  for(let i=0;i<16;i++) {
   const raw=JSON.stringify({diagnostic:i,padding:'x'.repeat(4*1024*1024)}),name=`raw-${i}.json`;
   await fs.writeFile(path.join(dir,name),raw);
   sources.push({id:name,path:name,url:`https://example.com/${name}`,mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(raw)});
  }
  const file=path.join(dir,'input.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,companies:[],sources}));
  const script=`import {loadEvidenceInput} from ${JSON.stringify(new URL('../../src/cn/evidence.ts',import.meta.url).href)};global.gc();const before=process.memoryUsage().arrayBuffers;const loaded=await loadEvidenceInput(process.argv[1]);global.gc();console.log(JSON.stringify({retained:process.memoryUsage().arrayBuffers-before,count:loaded.input.sources.length}));`;
  const {stdout}=await promisify(execFile)(process.execPath,['--expose-gc','--import','tsx','--input-type=module','-e',script,file]);
  const measured=JSON.parse(stdout.trim());
  // The fixed broker reference is a small hashed source, added independently of
  // the 16 large caller-owned originals.
  expect(measured.count).toBe(16);
  // 64 MiB of originals must not remain live; allow several source-sized working buffers.
  expect(measured.retained).toBeLessThan(24*1024*1024);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},30000);

it('validates unused PDF originals and rejects missing or cyclic source dependencies',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-unused-pdf-'));
 try {
  const pdf=await fs.readFile(new URL('../fixtures/synthetic-scope.pdf',import.meta.url));
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  await fs.writeFile(path.join(dir,'index.json'),index);
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);
  const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},
   {id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
  const file=path.join(dir,'input.json'),save=async()=>{await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[]}));return loadEvidenceInput(file);};
  expect((await save()).input.companies).toEqual([]);
  const wrongIdentity=Buffer.from(pdf.toString('latin1').replaceAll('2025','2024'),'latin1');
  await fs.writeFile(path.join(dir,'report.pdf'),wrongIdentity);sources[1].sha256=sha256(wrongIdentity);
  await expect(save()).rejects.toThrow(/identity/);
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);sources[1].sha256=sha256(pdf);
  sources[1].disclosure!.sourceId='absent';
  await expect(save()).rejects.toThrow(/Missing source/);
  sources[1].disclosure!.sourceId='pdf';
  await expect(save()).rejects.toThrow(/Cyclic source dependency/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('extracts original statement facts without substituting parent profit, net finance expense or missing capex',()=>{
  const raw={data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31 00:00:00',NOTICE_DATE:'2026-03-18 00:00:00',UPDATE_DATE:'2026-08-19 00:00:00',CURRENCY:'CNY',NETPROFIT:9316796494,PARENT_NETPROFIT:9312304150,FE_INTEREST_EXPENSE:321414072,FINANCE_EXPENSE:-830940354}]};
  const facts=parseCnStatementFacts(raw,{sourceId:'income',entity:'600660',basis:'test',kind:'income'});
  expect(facts.find(f=>f.field==='netProfit')).toMatchObject({value:9316796494,publishedAt:'2026-08-19',evidence:[{sourceId:'income',locator:'/data/0/NETPROFIT',raw:9316796494}]});
  expect(facts.find(f=>f.field==='interestExpense')?.value).toBe(321414072);
  const cash=parseCnStatementFacts(raw,{sourceId:'cash',entity:'600660',basis:'test',kind:'cashflow'});
  expect(cash.find(f=>f.field==='capex')).toMatchObject({state:'missing'});
  expect(cash.find(f=>f.field==='capex')?.value).toBeUndefined();
  expect(()=>parseCnStatementFacts({result:null},{sourceId:'bad',entity:'600660',basis:'test',kind:'income'})).toThrow();
  const indicators=parseCnStatementFacts({data:[{...raw.data[0],PARENTNETPROFIT:9312304150,KCFJCXSYJLR:9164684348,ROEJQ:25.56,ROEKCJQ:25.16}]},{sourceId:'indicators',entity:'600660',basis:'test',kind:'indicators'});
  expect(indicators.find(f=>f.field==='parentProfit')).toMatchObject({value:9312304150});
  expect(indicators.find(f=>f.field==='reportedAdjustedParentProfit')).toMatchObject({value:9164684348});
});

it('uses only completed unadjusted sessions and keeps share counts separate from a preopen zero price',()=>{
  const options={sourceId:'daily',entity:'600660',basis:'test',asOf:'2026-09-10T10:00:00+08:00'};
  const daily={data:{code:'600660',market:1,klines:['2026-09-09,54.30,55.14,55.52,53.85,1','2026-09-10,55.00,55.50,56,54,1']}};
  expect(parseCnPriceFacts(daily,{...options,kind:'daily'})).toMatchObject([{field:'price',value:55.14,period:{end:'2026-09-09'},publishedAt:'2026-09-09T15:00:00+08:00'}]);
  const quote={data:{f57:'600660',f43:0,f59:2,f84:2609743532,f86:Date.parse('2026-09-10T08:30:00+08:00')/1000}};
  expect(parseCnPriceFacts(quote,{...options,kind:'shares'})).toMatchObject([{field:'ordinaryShares',value:2609743532,unit:'shares'}]);
  expect(parseCnPriceFacts(quote,{...options,asOf:'2026-09-09',kind:'shares'})).toEqual([]);
  expect(()=>parseCnPriceFacts(daily,{...options,entity:'ANOTHER',kind:'daily'})).toThrow(/identity/i);
});

it('keeps a bank-format statement pending legal-entity identification and rejects conflicting statement families',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-method-family-'));
 try {
  const file=path.join(dir,'input.json'),raw={data:[{SECURITY_CODE:'600000',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'银行',PARENT_NETPROFIT:10}]};
  const input={schemaVersion:1,sources:[{id:'income',mapping:'income',path:'income.json',url:'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/lrbAjaxNew',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:''}],companies:[{ticker:'600000',companyId:'600000',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
  const save=async()=>{const bytes=JSON.stringify(raw);await fs.writeFile(path.join(dir,'income.json'),bytes);input.sources[0].sha256=sha256(bytes);await fs.writeFile(file,JSON.stringify(input));return (await loadEvidenceInput(file)).input.companies[0];};
  let company=await save();
  expect(company.method).toMatchObject({state:'unresolved',reason:'bank_or_nonbank_credit_entity_unresolved'});
  expect(company.facts.find(f=>f.id===company.method.evidence[0])).toMatchObject({field:'statementFamily',state:'observed',value:'银行',evidence:[{sourceId:'income',locator:'/data/0/ORG_TYPE',raw:'银行'}]});
  expect(company.checks).toEqual({});
  raw.data[0].ORG_TYPE='证券';expect((await save()).method).toMatchObject({state:'unresolved',reason:'broker_or_futures_entity_unresolved'});
  raw.data[0].ORG_TYPE='通用';expect((await save()).method).toMatchObject({state:'unresolved',reason:'business_scope_required'});
  raw.data[0].ORG_TYPE='保险';expect((await save()).method).toMatchObject({state:'unresolved',reason:'insurance_business_scope_required'});
  raw.data[0].ORG_TYPE='银行';raw.data.push({...raw.data[0],ORG_TYPE:'证券'});
  expect((await save()).method).toMatchObject({state:'unresolved',reason:'conflicting_statement_families'});
  raw.data.pop();Object.assign(raw.data[0],{UPDATE_DATE:'2026-06-01'});
  expect((await save()).method.state).toBe('unresolved');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('accepts an annual report with a matching issuer name but no stock code on its cover',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-cover-name-'));
 try {
  // Preserve PDF byte offsets while modeling a common cover that prints the issuer name only.
  const pdf=Buffer.from((await fs.readFile(new URL('../fixtures/synthetic-scope.pdf',import.meta.url))).toString('latin1').replace('600660','      '),'latin1');
  const index={announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]};
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);
  const save=async()=>{
   const bytes=JSON.stringify(index);await fs.writeFile(path.join(dir,'index.json'),bytes);
   const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(bytes)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
   const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));return loadEvidenceInput(file);
  };
  expect((await save()).input.companies[0].facts.some(f=>f.field==='annualReportYear' && f.value===2025)).toBe(true);
  index.announcements[0].announcementTitle='Synthetic股份有限公司2025年年度报告';
  expect((await save()).input.companies[0].facts.some(f=>f.field==='annualReportYear')).toBe(true);
  index.announcements[0].announcementTitle='Synthetic股份有限公司2025年年度报告摘要';await expect(save()).rejects.toThrow(/announcement mismatch/);
  index.announcements[0].announcementTitle='2025年年度报告';
  index.announcements[0].secName='Another issuer';await expect(save()).rejects.toThrow(/identity\/year mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('finds a second-page report cover and preserves its actual evidence location on reload',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-frontmatter-'));
 try {
  // Reorder existing PDF pages without changing byte offsets; the cover is now physical page two.
  let pdf=Buffer.from((await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1').replace('/Kids [5 0 R 7 0 R 9 0 R]','/Kids [7 0 R 5 0 R 9 0 R]'),'latin1');
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  await fs.writeFile(path.join(dir,'index.json'),index);
  const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),pages:[3],disclosure:{sourceId:'index',locator:'/announcements/0'}}];
  const file=path.join(dir,'input.json'),input={schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
  const save=async()=>{await fs.writeFile(path.join(dir,'report.pdf'),pdf);sources[1].sha256=sha256(pdf);await fs.writeFile(file,JSON.stringify(input));return loadEvidenceInput(file);};
  const loaded=await save(),annual=loaded.input.companies[0].facts.find(f=>f.field==='annualReportYear');
  expect(annual).toMatchObject({value:2025,evidence:[{sourceId:'pdf',locator:'/pages/2/text'}]});
  await fs.writeFile(file,JSON.stringify(loaded.input));
  expect((await loadEvidenceInput(file)).input.companies[0].facts).toEqual(loaded.input.companies[0].facts);
  // A matching year mentioned in a capital note cannot repair a wrong-year report cover.
  pdf=Buffer.from(pdf.toString('latin1').replace('003200300032003500200061006e006e00750061006c','003200300032003400200061006e006e00750061006c'),'latin1');
  await expect(save()).rejects.toThrow(/identity\/year mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('verifies an issuer introduction with a Chinese-numbered annual header and explicit exchange ticker',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-issuer-intro-'));
 try {
  const original=(await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1');
  const objects=[...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(m=>m[2]);
  const stream=(lines:string[])=>{const data='BT /F1 10 Tf 40 780 Td 20 TL\n'+lines.map(line=>'<'+Buffer.from(line,'utf16le').swap16().toString('hex')+'> Tj T*\n').join('')+'ET\n';return `<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}endstream`;};
  objects[5]=stream([]);
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'示例公司',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});await fs.writeFile(path.join(dir,'index.json'),index);
  const save=async(code:string,companyInformation:boolean|'standard'=false)=>{
   objects[7]=stream(['关于我们','我们是谁','二零二五年年报 示例公司','公司在香港联合交易所主板(1234.HK)及上海证券交易所('+code+'.SH)两地上市。']);
   if(companyInformation) {objects[7]=stream([]);objects[9]=stream(['其他信息','公司信息','二零二五年年报 示例公司','法定名称','中文 ╱ 英文全称','示例公司股份有限公司','证券类别及上市地点','A股 上海证券交易所','H股 香港联合交易所有限公司','证券简称及代码','A股 示例公司 '+code,'H股 示例公司 2318']);}
   if(companyInformation==='standard') objects[9]=stream(['2025年年度报告','第二节 公司简介和主要财务指标','一、公司信息','股票简称 示例公司 股票代码 '+code,'股票上市证券交易所 深圳证券交易所','公司的中文名称 示例公司股份有限公司']);
   let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
   await fs.writeFile(path.join(dir,'report.pdf'),pdf);
   const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
   const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'示例公司',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));return loadEvidenceInput(file);
  };
  expect((await save('600660')).input.companies[0].facts.find(f=>f.field==='annualReportYear')).toMatchObject({value:2025,evidence:[{locator:'/pages/2/text'}]});
  await expect(save('600661')).rejects.toThrow(/identity\/year mismatch/);
  expect((await save('600660',true)).input.companies[0].facts.find(f=>f.field==='annualReportYear')).toMatchObject({value:2025,evidence:[{locator:'/pages/3/text'}]});
  await expect(save('600661',true)).rejects.toThrow(/identity\/year mismatch/);
  expect((await save('600660','standard')).input.companies[0].facts.find(f=>f.field==='annualReportYear')).toMatchObject({value:2025,evidence:[{locator:'/pages/3/text'}]});
  await expect(save('600661','standard')).rejects.toThrow(/identity\/year mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('reloads a parsed regulatory context spanning two original PDF pages and rejects an altered reference',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-capital-context-'));
 try {
  const pdf=await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url));
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);await fs.writeFile(path.join(dir,'index.json'),index);
  const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const {input}=await loadEvidenceInput(file);
  const context=input.companies[0].facts.find(f=>f.field==='regulatory.context' && f.year===2025)!;
  expect(context.evidence.map(e=>e.locator)).toEqual(['/pages/2/text','/pages/3/text']);
  expect(JSON.parse(String(context.value)).metrics.cet1.requirementFactId).toBeDefined();
  await fs.writeFile(file,JSON.stringify(input));
  expect((await loadEvidenceInput(file)).input.companies[0].facts).toEqual(input.companies[0].facts);
  context.evidence[1].raw='invented scope';await fs.writeFile(file,JSON.stringify(input));
  await expect(loadEvidenceInput(file)).rejects.toThrow(/locator\/value mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('uses the latest disclosed annual period and rejects contradictory method evidence even when unselected',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'latest-scope-'));
  try {
    const income={data:Array.from({length:6},(_,i)=>({SECURITY_CODE:'TEST',REPORT_TYPE:'年报',REPORT_DATE:`${2020+i}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',PARENT_NETPROFIT:i===5?-100:10}))};
    const assertion={key:'method',value:'nonfinancial',coverage:{start:'2020-01-01',end:'2025-12-31'},criteria:'synthetic business scope',evidence:[{sourceId:'income',locator:'/data/0/SECURITY_CODE',raw:'TEST'}]};
    const review={schemaVersion:1,entity:'TEST',basis:'v1',asOf:'2026-05-01',reviewedAt:'2026-05-01',expiresAt:'2027-01-01',reviewer:'test',assertions:[assertion]};
    const input={schemaVersion:1,sources:[] as Array<Record<string,unknown>>,companies:[{ticker:'TEST',companyId:'TEST',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-10',basis:'v1',latestFiscalYear:2024,method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks:{},facts:[]}]};
    const file=path.join(dir,'input.json');
    const save=async()=>{
      input.sources=[];
      for(const [id,mapping,document] of [['income','income',income],['review','reviewed-scope-v1',review]] as const) {
        const text=JSON.stringify(document);await fs.writeFile(path.join(dir,`${id}.json`),text);
        input.sources.push({id,mapping,path:`${id}.json`,url:`https://example.test/${id}`,mediaType:'application/json',fetchedAt:'2026-05-10',sha256:sha256(text)});
      }
      await fs.writeFile(file,JSON.stringify(input));
    };
    await save();
    let company=(await loadEvidenceInput(file)).input.companies[0];
    expect(company.latestFiscalYear).toBe(2025);
    const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
    expect(evaluateCompany(company,policy).conditions.find(r=>r.id==='N1')?.state).toBe('fail');
    // Even a direct pure-boundary caller cannot choose a more convenient old window.
    expect(evaluateCompany({...company,latestFiscalYear:2024},policy).conditions.find(r=>r.id==='N1')?.state).toBe('fail');
    income.data[5].PARENT_NETPROFIT=Number.NaN; // Serialized null: latest annual report exists, profit not parsed.
    await save();company=(await loadEvidenceInput(file)).input.companies[0];
    expect(company.latestFiscalYear).toBe(2025);
    expect(evaluateCompany(company,policy).conditions.find(r=>r.id==='N1')?.state).toBe('unknown');
    Object.assign(income.data[5],{PARENT_NETPROFIT:-100,UPDATE_DATE:'2026-06-01'});
    await save();company=(await loadEvidenceInput(file)).input.companies[0];
    expect(company.latestFiscalYear).toBe(2025); // Report existed, but this revision was not yet available.
    expect(evaluateCompany(company,policy).conditions.find(r=>r.id==='N1')?.state).toBe('unknown');
    income.data[5].NOTICE_DATE='2026-06-01';await save();
    expect((await loadEvidenceInput(file)).input.companies[0].latestFiscalYear).toBe(2024);
    income.data[5].NOTICE_DATE='2026-03-01';
    review.assertions.push({...assertion,value:'mixed'});await save();
    company=(await loadEvidenceInput(file)).input.companies[0];
    expect(company.method).toMatchObject({state:'unresolved',reason:'conflicting_scope_evidence',evidence:['review:0','review:1']});
    expect(evaluateCompany(company,policy).conditions.find(r=>r.id==='N1')?.state).toBe('unknown');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('imports dated scope and named financing classifications without importing formulas or invented amounts',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'classified-financing-'));
  try {
    const rows={data:Array.from({length:6},(_,i)=>({SECURITY_CODE:'TEST',REPORT_TYPE:'年报',REPORT_DATE:`${2020+i}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',
      PARENT_NETPROFIT:10,NETPROFIT:10,FE_INTEREST_EXPENSE:1,TOTAL_PROFIT:12,NETCASH_OPERATE:20,CONSTRUCT_LONG_ASSET:5,ROEJQ:20,ROEKCJQ:19,ORG_TYPE:'通用',
      TOTAL_EQUITY:100,TOTAL_PARENT_EQUITY:100,TOTAL_ASSETS:180,TOTAL_LIABILITIES:80,SHORT_LOAN:5,LONG_LOAN:6,BOND_PAYABLE:1,SHORT_BOND_PAYABLE:0,LEASE_LIAB:2,NONCURRENT_LIAB_1YEAR:3,NOTE_PAYABLE:4,LONG_PAYABLE:5,OTHER_CURRENT_LIAB:6,OTHER_NONCURRENT_LIAB:7,TOTAL_OTHER_PAYABLE:8,
      FINANCING_NOTE:'Synthetic fixture: listed balances fully financing; no additional financing; comparable group throughout declared periods.'}))};
    const coverage={start:'2018-12-31',end:'2025-12-31'};
    const evidence=[{sourceId:'balance',locator:'/data/5/FINANCING_NOTE',raw:rows.data[5].FINANCING_NOTE}];
    const assertions:Array<{key:string;value:string;coverage?:{start:string;end:string};components?:string[];criteria:string;evidence:typeof evidence}>=['method','cycle','cash','financing','interest','capital','earnings','debtLiabilityBound','capitalAssetBound'].map(key=>({key,value:key==='method'?'nonfinancial':key==='cycle'?'not_applicable':'applies',coverage,criteria:'Synthetic scope record, not a real issuer judgment',evidence}));
    const classifications:Record<string,string[]>={currentFinancingLiabilities:['currentNoncurrentLiabilities'],financingNotesPayable:['notesPayable'],noncurrentFinancingPayables:['longPayables'],otherFinancingLiabilities:['otherCurrentLiabilities','otherNoncurrentLiabilities','otherPayables'],additionalFinancing:[]};
    for(const [role,components] of Object.entries(classifications)) assertions.push({key:`financing.${role}`,value:components.length?'components':'absent',components,coverage:{start:'2025-12-31',end:'2025-12-31'},criteria:'Synthetic exhaustive classification for this one named role',evidence});
    const review={schemaVersion:1,entity:'TEST',basis:'v1',asOf:'2026-05-01',reviewedAt:'2026-05-01',expiresAt:'2027-01-01',reviewer:'synthetic test',assertions};
    const checks=Object.fromEntries(assertions.slice(1,9).map((a,i)=>[a.key,{state:a.value,evidence:[`review:${i+1}`],coverage:{start:'1900-01-01',end:'2099-01-01'}}]));
    const input={schemaVersion:1,sources:[] as Array<Record<string,unknown>>,companies:[{ticker:'TEST',companyId:'TEST',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-10',basis:'v1',latestFiscalYear:2025,method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks,facts:[]}]};
    const file=path.join(dir,'input.json');
    const save=async()=>{
      input.sources=[];
      for(const mapping of ['income','balance','cashflow','indicators','reviewed-scope-v1']) {
        const id=mapping==='reviewed-scope-v1'?'review':mapping,content=JSON.stringify(id==='review'?review:rows);
        await fs.writeFile(path.join(dir,`${id}.json`),content);
        input.sources.push({id,mapping,path:`${id}.json`,url:id==='balance'?'https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/zcfzbAjaxNew?companyType=4&reportDateType=0&reportType=1&code=shTEST':`https://example.test/${id}`,mediaType:'application/json',fetchedAt:'2026-05-10',sha256:sha256(content)});
      }
      await fs.writeFile(file,JSON.stringify(input));
    };
    const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
    const evaluate=async()=>evaluateCompany((await loadEvidenceInput(file)).input.companies[0],policy);
    await save();let result=await evaluate();
    expect((await loadEvidenceInput(file)).input.companies[0].facts.find(f=>f.field==='balance.consolidatedContext'&&f.year===2025)).toMatchObject({value:JSON.stringify({contract:'eastmoney_annual_consolidated_balance_v1',row:'/data/5'}),evidence:[{sourceId:'balance',locator:'/data/5/REPORT_DATE',raw:'2025-12-31'}]});
    expect(result.derivedFacts?.some(f=>f.field==='debt'||f.field==='additionalFinancing')).toBe(false);
    // Known financing outside the fixed report columns needs reconciliation,
    // but an absent complete-financing review is no longer a prerequisite.
    expect(result.conditions.find(c=>c.id==='N5')?.state).toBe('unknown');
    expect(result.conditions.find(c=>c.id==='N3')?.state).toBe('pass');
    expect(result.conditions.find(c=>c.id==='N7')).toBeUndefined();
    expect((await loadEvidenceInput(file)).input.companies[0].checks.cash.coverage).toEqual(coverage);
    assertions.push({...assertions[9],value:'absent',components:[]});await save();
    expect((await evaluate()).derivedFacts?.some(f=>f.field==='debt')).toBe(false);
    assertions.pop();
    assertions[2].coverage={start:'2025-01-01',end:'2025-12-31'};await save();result=await evaluate();
    expect(result.conditions.find(c=>c.id==='N3')?.reason).toBe('scope_unresolved:cash');
    expect(result.conditions.find(c=>c.id==='N2')?.state).toBe('pass');
    assertions[2].coverage=coverage;
    assertions.push({...assertions[2],value:'unresolved'});await save();
    expect((await loadEvidenceInput(file)).input.companies[0].checks.cash.reason).toBe('conflicting_scope_evidence');
    assertions.pop();review.expiresAt='2026-05-09';await save();result=await evaluate();
    expect(result.derivedFacts?.some(f=>f.field==='debt')).toBe(false);
    expect(result.conditions.find(c=>c.id==='N5')?.reason).toBe('method_pending');
    expect((await loadEvidenceInput(file)).input.companies[0].checks.interest.state).toBe('unresolved');
    review.expiresAt='2027-01-01';assertions[9].components!.push('currentBorrowings');await save();
    await expect(loadEvidenceInput(file)).rejects.toThrow(/overlapping/i);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('loads and replays source-bound insurance group conditions through the common annual PDF entry point',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-insurance-load-'));
 try {
  const original=(await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1');
  const objects=[...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(m=>m[2]);
  const pages=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-group-solvency-cn-pages.json',import.meta.url),'utf8')).pages;
  for(const [object,page] of [[7,'105'],[9,'106']] as const) {
   const data='BT /F1 5 Tf 10 830 Td 5 TL\n'+pages[page].lines.map((line:string)=>'<'+Buffer.from(line,'utf16le').swap16().toString('hex')+'> Tj T*\n').join('')+'ET\n';
   objects[object]=`<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}endstream`;
  }
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);await fs.writeFile(path.join(dir,'index.json'),index);
  const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const loaded=await loadEvidenceInput(file),company=loaded.input.companies[0];
  expect(company.method).toMatchObject({state:'applies',value:'insurance_group'});
  expect(company.facts.find(f=>f.field==='insurance.context')?.evidence.map(e=>e.locator)).toEqual(['/pages/3/text','/pages/2/text']);
  const {evaluateCompany}=await import('../../src/cn/screening.js');const {loadCnPolicy}=await import('../../src/policy/loader.js');
  const result=evaluateCompany(company,await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname),{evaluateAll:true});
  const flatten=(xs:typeof result.conditions):typeof result.conditions=>xs.flatMap(c=>[c,...flatten(c.components??[])]);
  expect(flatten(result.conditions).find(c=>c.id==='P2.stress')).toBeUndefined();
  expect(result.conditions.find(c=>c.id==='F.methodValidation')?.state).toBe('unknown');
  expect(result.quality).toBe('unknown');
  await fs.writeFile(file,JSON.stringify(loaded.input));
  expect((await loadEvidenceInput(file)).input.companies[0]).toEqual(company);
  const context=company.facts.find(f=>f.field==='insurance.context')!;
  context.evidence[1].raw='invented regulatory regime';await fs.writeFile(file,JSON.stringify(loaded.input));
  await expect(loadEvidenceInput(file)).rejects.toThrow(/locator\/value mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('rebuilds the ordinary-return context from original PDF pages and rejects a changed accounting claim',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-ordinary-return-'));
 try {
  const original=(await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1');
  const objects=[...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(m=>m[2]);
  const stream=(lines:string[])=>{const data='BT /F1 6 Tf 10 780 Td 12 TL\n'+lines.map(line=>'<'+Buffer.from(line,'utf16le').swap16().toString('hex')+'> Tj T*\n').join('')+'ET\n';return `<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}endstream`;};
  objects[7]=stream(['2025年年度报告','1、遵循企业会计准则的声明','本公司所编制的财务报表符合企业会计准则的要求','二十、补充资料','2、净资产收益率及每股收益','√适用 □不适用','报告期利润 加权平均净资产收益率（%） 每股收益','基本每股收益 稀释每股收益','归属于公司普通股股东的净利润 25.56 3.57 3.57','扣除非经常性损益后归属于公司普通股股东的净利润 25.16 3.51 3.51']);objects[9]=stream([]);
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:'2025年年度报告',announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
  await fs.writeFile(path.join(dir,'report.pdf'),pdf);await fs.writeFile(path.join(dir,'index.json'),index);
  const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}}];
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
  const {input}=await loadEvidenceInput(file);const facts=input.companies[0].facts,context=facts.find(f=>f.field==='earnings.returnContext')!;
  expect(context).toBeDefined();expect(context.evidence.length).toBeGreaterThan(1);
  expect(facts.find(f=>f.field==='weightedRoe')?.value).toBe(0.2556);
  await fs.writeFile(file,JSON.stringify(input));expect((await loadEvidenceInput(file)).input.companies[0].facts).toEqual(facts);
  context.value=JSON.stringify({...JSON.parse(String(context.value)),accountingStandard:'IFRS'});await fs.writeFile(file,JSON.stringify(input));
  await expect(loadEvidenceInput(file)).rejects.toThrow(/contract mismatch/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('routes disclosed ordinary operations without an exhaustive inventory gate and rejects financial or stale primary-business evidence',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-primary-method-'));
 try {
  const original=(await fs.readFile(new URL('../fixtures/synthetic-capital-context.pdf',import.meta.url))).toString('latin1');
  const file=path.join(dir,'input.json');
  const save=async(description:string,year=2025,family='通用')=>{
   const objects=[...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(m=>m[2].replaceAll('2025',String(year)).replaceAll(Buffer.from('2025','utf16le').swap16().toString('hex'),Buffer.from(String(year),'utf16le').swap16().toString('hex')));
   const stream=(lines:string[])=>{const data='BT /F1 6 Tf 10 780 Td 12 TL\n'+lines.map(line=>'<'+Buffer.from(line,'utf16le').swap16().toString('hex')+'> Tj T*\n').join('')+'ET\n';return `<< /Length ${Buffer.byteLength(data)} >>\nstream\n${data}endstream`;};
   objects[7]=stream([`${year}年年度报告`,'三、公司基本情况','1、公司概况',`本公司及子公司（以下合称“本集团”）主要从事${description}。`]);objects[9]=stream([]);
   let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
   const index=JSON.stringify({announcements:[{secCode:'600660',secName:'Synthetic',announcementTitle:`${year}年年度报告`,announcementTime:Date.parse('2026-03-01'),adjunctUrl:'finalpage/2026-03-01/report.PDF'}]});
   const indicators=JSON.stringify({data:[2021,2022,2023,2024,2025].map(year=>({SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:`${year}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:family,PARENTNETPROFIT:10,ROEJQ:20,ROEKCJQ:20}))});
   await fs.writeFile(path.join(dir,'report.pdf'),pdf);await fs.writeFile(path.join(dir,'index.json'),index);await fs.writeFile(path.join(dir,'indicators.json'),indicators);
   const sources=[{id:'index',mapping:'cninfo-announcements',path:'index.json',url:'https://www.cninfo.com.cn/new/hisAnnouncement/query',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(index)},{id:'pdf',mapping:'cninfo-annual-pdf',path:'report.pdf',url:'https://static.cninfo.com.cn/finalpage/2026-03-01/report.PDF',mediaType:'application/pdf',fetchedAt:'2026-05-01',sha256:sha256(pdf),disclosure:{sourceId:'index',locator:'/announcements/0'}},{id:'indicators',mapping:'indicators',path:'indicators.json',url:'https://datacenter-web.eastmoney.com/api/data/v1/get',mediaType:'application/json',fetchedAt:'2026-05-01',sha256:sha256(indicators)}];
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-05-01',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
   return (await loadEvidenceInput(file)).input;
  };
  const input=await save('药品的研发、生产和销售'),company=input.companies[0];
  expect(company.method).toMatchObject({state:'applies',value:'nonfinancial'});
  const {evaluateCompany}=await import('../../src/cn/screening.js');const {loadCnPolicy}=await import('../../src/policy/loader.js');
  const result=evaluateCompany(company,await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname),{evaluateAll:true});
  expect(result.conditions.find(c=>c.id==='N1')?.state).toBe('pass');
  expect(result.conditions.find(c=>c.id==='F.scope')).toMatchObject({state:'not_applicable',reason:'company_level_method_scope'});
  expect(result.conditions.find(c=>c.id==='N2')?.state).toBe('pass'); // Validated API ROE fields now establish the reported return definition.
  expect(result.quality).toBe('unknown');
  await fs.writeFile(file,JSON.stringify(input));expect((await loadEvidenceInput(file)).input.companies[0]).toEqual(company);
  expect((await save('药品生产和销售以及信托投资')).companies[0].method.state).toBe('unresolved');
  expect((await save('药品的研发、生产和销售',2025,'银行')).companies[0].method.state).toBe('unresolved');
  expect((await save('药品的研发、生产和销售',2024)).companies[0].method.state).toBe('unresolved');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});


it('routes a verified nonfinancial exchange classification with ordinary API statements without fetching a report',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-api-routing-'));
 try {
  const source={id:'listing',mapping:'sse-list' as const,url:'https://query.sse.com.cn/sseQuery/commonQuery.do?sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L&STOCK_TYPE=1&COMPANY_STATUS=2%2C4%2C5%2C7%2C8&pageHelp.pageNo=1&pageHelp.pageSize=100',fetchedAt:'2026-09-10'};
  const file=path.join(dir,'input.json');
  for(const [code,label,family,expected] of [['C','制造业','通用','applies'],['J','金融业','通用','unresolved'],['C','制造业','银行','unresolved'],['Z','未知分类','通用','unresolved']] as const) {
   const listing={result:[{A_STOCK_CODE:'600660',SEC_NAME_CN:'Synthetic',STOCK_TYPE:'1',LIST_DATE:'2000-01-01',DELIST_DATE:'-',CSRC_CODE:code,CSRC_CODE_DESC:label}],pageHelp:{pageNo:1,pageSize:100,pageCount:1,total:1}};
   const identities=reconcileCnUniverse([parseCnListingPage(listing,source)],'2026-09-10');
   const statement={data:[{SECURITY_CODE:'600660',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:family,PARENTNETPROFIT:10}]};
   const listingBytes=JSON.stringify(listing),statementBytes=JSON.stringify(statement);
   await fs.writeFile(path.join(dir,'listing.json'),listingBytes);await fs.writeFile(path.join(dir,'statement.json'),statementBytes);
   const c={...identities.identities[0],companyId:'600660',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]};
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,universe:identities.universe,companies:[c],sources:[{...source,path:'listing.json',mediaType:'application/json',sha256:sha256(listingBytes)},{id:'statement',mapping:'indicators',url:'https://example.test/statement',path:'statement.json',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statementBytes)}]}));
   const loaded=(await loadEvidenceInput(file)).input.companies[0];
   expect(loaded.method.state,`${code}/${family}`).toBe(expected);
   if(expected==='applies') {
    expect(loaded.method.value).toBe('nonfinancial');
    expect(loaded.method.evidence).toContain('listing:600660:industry');
    expect(loaded.facts.find(f=>f.id==='listing:600660:industry')).toMatchObject({value:'C 制造业',evidence:[{sourceId:'listing',locator:'/result/0/CSRC_CODE_DESC',raw:'制造业'}]});
   }
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('routes explicit BSE manufacturing categories without treating arbitrary plastic labels as manufacturing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-bse-industry-routing-'));
 try {
  const source={id:'listing',mapping:'bse-list' as const,url:'https://www.bse.cn/nqxxController/nqxxCnzq.do',fetchedAt:'2026-09-10',request:{method:'POST' as const,contentType:'application/x-www-form-urlencoded' as const,body:'page=0&typejb=T&xxfcbj%5B%5D=2&xxzqdm=&sortfield=xxzqdm&sorttype=asc'}};
  const file=path.join(dir,'input.json');
  for(const [label,family,expected] of [['橡胶和塑料制品业','通用','applies'],['纺织业','通用','applies'],['有色金属冶炼和压延加工业','通用','applies'],['废弃资源综合利用业','通用','applies'],['塑料金融服务业','通用','unresolved'],['综合服务业','通用','unresolved'],['橡胶和塑料制品业','银行','unresolved']] as const) {
   const listing=[{content:[{xxzqdm:'920204',xxzqjc:'Synthetic',xxzqjb:'T',xxfcbj:'2',fxssrq:'20201223',xxjsrq:'20260910',xxhyzl:label}],firstPage:true,lastPage:true,number:0,numberOfElements:1,size:20,totalElements:1,totalPages:1}];
   const identities=reconcileCnUniverse([parseCnListingPage(listing,source)],'2026-09-10');
   const statement={data:[{SECURITY_CODE:'920204',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:family,PARENTNETPROFIT:10}]};
   const listingBytes=`null(${JSON.stringify(listing)})`,statementBytes=JSON.stringify(statement);
   await fs.writeFile(path.join(dir,'listing.json'),listingBytes);await fs.writeFile(path.join(dir,'statement.json'),statementBytes);
   const c={...identities.identities[0],companyId:'920204',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]};
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,universe:identities.universe,companies:[c],sources:[{...source,path:'listing.json',mediaType:'application/json',sha256:sha256(listingBytes)},{id:'statement',mapping:'indicators',url:'https://example.test/statement',path:'statement.json',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statementBytes)}]}));
   const loaded=(await loadEvidenceInput(file)).input.companies[0];
   expect(loaded.method.state,`${label}/${family}`).toBe(expected);
   if(expected==='applies') expect(loaded.method).toMatchObject({value:'nonfinancial',reason:'exchange_classification_and_ordinary_statements'});
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('derives C1 cycle applicability only from verified fine business classifications',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-cycle-routing-'));
 try {
  const source={id:'listing',mapping:'bse-list' as const,url:'https://www.bse.cn/nqxxController/nqxxCnzq.do',fetchedAt:'2026-09-10',request:{method:'POST' as const,contentType:'application/x-www-form-urlencoded' as const,body:'page=0&typejb=T&xxfcbj%5B%5D=2&xxzqdm=&sortfield=xxzqdm&sorttype=asc'}};
  const file=path.join(dir,'input.json');
  const cases=[
   ['食品制造业','通用','not_applicable'],['医药制造业','通用','not_applicable'],['软件和信息技术服务业','通用','not_applicable'],
   ['煤炭开采和洗选业','通用','applies'],
   ['农业','通用',undefined],['计算机、通信和其他电子设备制造业','通用',undefined],['电气机械和器材制造业','通用',undefined],
   ['造纸和纸制品业','通用',undefined],['道路运输业','通用',undefined],['房地产业','通用',undefined],
   ['食品制造业','银行',undefined],['新型量子服务业','通用',undefined],
  ] as const;
  for(const [label,family,cycle] of cases) {
   const listing=[{content:[{xxzqdm:'920204',xxzqjc:'Synthetic',xxzqjb:'T',xxfcbj:'2',fxssrq:'20201223',xxjsrq:'20260910',xxhyzl:label}],firstPage:true,lastPage:true,number:0,numberOfElements:1,size:20,totalElements:1,totalPages:1}];
   const identities=reconcileCnUniverse([parseCnListingPage(listing,source)],'2026-09-10');
   const statement={data:[{SECURITY_CODE:'920204',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:family,PARENTNETPROFIT:10}]};
   const listingBytes=`null(${JSON.stringify(listing)})`,statementBytes=JSON.stringify(statement);
   await fs.writeFile(path.join(dir,'listing.json'),listingBytes);await fs.writeFile(path.join(dir,'statement.json'),statementBytes);
   const c={...identities.identities[0],companyId:'920204',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved' as const,evidence:[]},checks:{},facts:[]};
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,universe:identities.universe,companies:[c],sources:[{...source,path:'listing.json',mediaType:'application/json',sha256:sha256(listingBytes)},{id:'statement',mapping:'indicators',url:'https://example.test/statement',path:'statement.json',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statementBytes)}]}));
   const loaded=(await loadEvidenceInput(file)).input.companies[0];
   if(family==='银行'||label==='新型量子服务业') {
    expect(loaded.method.state,`${label}/${family}`).toBe('unresolved');
    expect(loaded.checks.cycle,`${label}/${family}`).toBeUndefined();
   } else {
    expect(loaded.method,`${label}/${family}`).toMatchObject({state:'applies',value:'nonfinancial'});
    if(cycle) expect(loaded.checks.cycle,`${label}/${family}`).toMatchObject({state:cycle,reason:'verified_fine_business_cycle_mapping',evidence:['listing:920204:industry']});
    else expect(loaded.checks.cycle,`${label}/${family}`).toBeUndefined();
   }
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('uses a current verified fine profile to refine a broad class and retains cycle conflicts',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-profile-cycle-routing-'));
 try {
  const listingSource={id:'listing',mapping:'bse-list' as const,url:'https://www.bse.cn/nqxxController/nqxxCnzq.do',fetchedAt:'2026-09-10',request:{method:'POST' as const,contentType:'application/x-www-form-urlencoded' as const,body:'page=0&typejb=T&xxfcbj%5B%5D=2&xxzqdm=&sortfield=xxzqdm&sorttype=asc'}};
  const listing=[{content:[{xxzqdm:'920204',xxzqjc:'Synthetic',xxzqjb:'T',xxfcbj:'2',fxssrq:'20201223',xxjsrq:'20260910',xxhyzl:'计算机、通信和其他电子设备制造业'}],firstPage:true,lastPage:true,number:0,numberOfElements:1,size:20,totalElements:1,totalPages:1}];
  const statement={data:[{SECURITY_CODE:'920204',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'通用',PARENTNETPROFIT:10}]};
  const file=path.join(dir,'input.json');
  const load=async(mainBusiness:string,industry='制造业',observed='2026-09-10')=>{
   const identities=reconcileCnUniverse([parseCnListingPage(listing,listingSource)],'2026-09-10');
   const profile={success:true,result:{data:[{SECURITY_CODE:'920204',SECUCODE:'920204.BJ',BUSINESS_SCOPE:'技术开发和产品销售',MAIN_BUSINESS:mainBusiness,INDUSTRYCSRC1:industry}]}};
   const listingBytes=`null(${JSON.stringify(listing)})`,statementBytes=JSON.stringify(statement),profileBytes=JSON.stringify(profile);
   await Promise.all([fs.writeFile(path.join(dir,'listing.json'),listingBytes),fs.writeFile(path.join(dir,'statement.json'),statementBytes),fs.writeFile(path.join(dir,'profile.json'),profileBytes)]);
   const c={...identities.identities[0],companyId:'920204',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved' as const,evidence:[]},checks:{},facts:[]};
   await fs.writeFile(file,JSON.stringify({schemaVersion:1,universe:identities.universe,companies:[c],sources:[
    {...listingSource,path:'listing.json',mediaType:'application/json',sha256:sha256(listingBytes)},
    {id:'statement',mapping:'indicators',url:'https://example.test/statement',path:'statement.json',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statementBytes)},
    {id:'profile',mapping:'company-profile',url:'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO',path:'profile.json',mediaType:'application/json',fetchedAt:observed,sha256:sha256(profileBytes)},
   ]}));
   return (await loadEvidenceInput(file)).input.companies[0];
  };
  expect((await load('半导体器件研发、生产和销售')).checks.cycle).toMatchObject({state:'applies',evidence:['profile:business.profile']});
  expect((await load('半导体测试设备生产和销售')).checks.cycle).toBeUndefined();
  expect((await load('半导体器件制造；兼营软件销售')).checks.cycle).toMatchObject({state:'applies'});
  expect((await load('白酒生产和销售','制造业-酒、饮料和精制茶制造业')).checks.cycle).toMatchObject({state:'not_applicable',evidence:['profile:business.profile']});
  expect((await load('生物制药研发和生产','制造业-医药制造业')).checks.cycle).toMatchObject({state:'not_applicable'});
  expect((await load('普通产品生产和销售','制造业-新型量子服务业')).checks.cycle).toBeUndefined();
  expect((await load('转换器、墙壁开关插座、LED照明和数码配件等电源连接产品的研发、生产和销售','制造业-电气机械和器材制造业')).checks.cycle).toMatchObject({state:'not_applicable'});
  expect((await load('电气设备研发生产','制造业-电气机械和器材制造业')).checks.cycle).toBeUndefined();
  expect((await load('墙壁开关插座及光伏电池片的生产销售','制造业-电气机械和器材制造业')).checks.cycle).toMatchObject({state:'applies'});
  expect((await load('一次性个人卫生用品的研发、生产和销售','制造业-造纸和纸制品业')).checks.cycle).toMatchObject({state:'not_applicable'});
  expect((await load('纸制品生产销售','制造业-造纸和纸制品业')).checks.cycle).toBeUndefined();
  expect((await load('网络游戏的研发及运营业务','信息传输、软件和信息技术服务业-互联网和相关服务')).checks.cycle).toMatchObject({state:'not_applicable'});
  expect((await load('互联网平台服务','信息传输、软件和信息技术服务业-互联网和相关服务')).checks.cycle).toBeUndefined();
  expect((await load('半导体器件研发、生产和销售','制造业-酒、饮料和精制茶制造业')).checks.cycle).toMatchObject({state:'unresolved',reason:'conflicting_cycle_evidence'});
  listing[0].content[0].xxhyzl='通用设备制造业';
  expect((await load('半导体器件研发、生产和销售','制造业-通用设备制造业')).checks.cycle).toMatchObject({state:'applies'});
  expect((await load('半导体器件研发、生产和销售','制造业-酒、饮料和精制茶制造业')).checks.cycle).toMatchObject({state:'unresolved',reason:'conflicting_cycle_evidence'});
  listing[0].content[0].xxhyzl='C 制造业';
  expect((await load('半导体器件研发、生产和销售','制造业-通用设备制造业')).checks.cycle).toMatchObject({state:'applies'});
  listing[0].content[0].xxhyzl='计算机、通信和其他电子设备制造业';
  expect((await load('白酒生产和销售','制造业-酒、饮料和精制茶制造业','2026-09-11')).checks.cycle).toBeUndefined();
  // The same source family can also contradict a fine noncyclical exchange label.
  listing[0].content[0].xxhyzl='食品制造业';
  expect((await load('半导体器件研发、生产和销售')).checks.cycle).toMatchObject({state:'unresolved',reason:'conflicting_cycle_evidence'});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('routes supported current issuer activities with annual statement families and preserves conflicts',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-profile-route-'));
 const bank='吸收公众存款;发放短期、中期和长期贷款;代理保险业务';
 const cases:Array<{scope:string;industry:string;family:string;method?:string;observed?:string;mainBusiness?:string;reason?:string}>=[
  // A nonfinancial-looking leaf cannot erase a financial parent or turn a
  // broad conglomerate label into a verified ordinary business classification.
  {scope:'投资管理;房地产开发及经营;建筑材料生产、销售;建筑工程施工',industry:'金融业-资本市场服务',family:'通用',mainBusiness:'私募股权投资管理、房地产开发与经营和建筑施工业务'},
  {scope:'投资管理;软件开发;信息系统集成服务;以自有资金从事投资活动',industry:'金融业-资本市场服务',family:'通用',mainBusiness:'经纪业务、自营业务、资产管理业务、投行业务、信用业务'},
  {scope:'集成电路芯片制造;污水处理;以自有资金从事投资活动',industry:'综合-综合',family:'通用',mainBusiness:'投资与管理、电子器件制造、污水处理、科技园区'},
  {scope:'地铁经营及相关综合开发;轨道交通投资',industry:'综合-综合',family:'通用',mainBusiness:'公共交通运维管理、融资租赁及商业保理、产业投资'},
  {scope:'高速公路运营管理',industry:'交通运输、仓储和邮政业-道路运输业',family:'通用',mainBusiness:'高速公路运营管理及金融投资业务',method:'nonfinancial',reason:'reported_primary_operations'},
  {scope:bank,industry:'金融业-货币金融服务',family:'银行',method:'bank'},
  {scope:'吸收本外币公众存款;发放本外币短期、中期和长期贷款',industry:'金融业-货币金融服务',family:'银行',method:'bank'},
  // Registered scopes often use the compact statutory banking wording rather
  // than spelling out the two legacy phrases above.
  {scope:'办理人民币存、贷、结算、汇兑业务;办理票据贴现',industry:'金融业-货币金融服务',family:'银行',method:'bank'},
  {scope:'商业银行业务',industry:'金融业-货币金融服务',family:'银行',method:'bank'},
  {scope:'(一)吸收人民币存款;(二)发放短期、中期和长期贷款',industry:'金融业-货币金融服务',family:'银行',method:'bank'},
  {scope:'人民币和外币存款、贷款及其他金融服务',industry:'金融业-货币金融服务',family:'银行',mainBusiness:'吸收公众存款;发放短期、中期和长期贷款;办理国内外结算',method:'bank'},
  {scope:'公司金融业务,个人金融业务,资金业务',industry:'金融业-货币金融服务',family:'银行',mainBusiness:'提供银行及相关金融服务',method:'bank'},
  {scope:'许可项目:证券业务;外汇业务;证券公司为期货公司提供中间介绍业务',industry:'金融业-资本市场服务',family:'证券',method:'broker'},
  {scope:'许可项目:证券投资咨询;证券投资基金销售服务',industry:'金融业-资本市场服务',family:'证券'},
  {scope:'许可经营项目:证券经纪;证券承销与保荐;为期货公司提供中间介绍业务',industry:'金融业-资本市场服务',family:'证券',method:'broker'},
  {scope:'金融期货经纪;商品期货经纪;期货投资咨询;资产管理',industry:'金融业-资本市场服务',family:'证券',method:'futures'},
  {scope:'资金信托;动产信托;不动产信托;有价证券信托;作为投资基金管理公司的发起人从事投资基金业务',industry:'金融业-其他金融业',family:'银行',method:'trust'},
  {scope:'吸收非银行股东定期存款;许可项目:金融租赁服务(依法须经批准)',industry:'金融业-货币金融服务',family:'银行',method:'financial_lease'},
  {scope:'期货投资咨询;资产管理;为期货公司提供中间介绍业务',industry:'金融业-资本市场服务',family:'证券'},
  {scope:'子公司经营金融期货经纪;商品期货经纪',industry:'金融业-资本市场服务',family:'证券'},
  {scope:'信托咨询;资金信托服务;动产信托服务;不动产信托服务',industry:'金融业-其他金融业',family:'银行'},
  {scope:'不吸收公众存款;发放贷款',industry:'金融业-货币金融服务',family:'银行'},
  {scope:bank,industry:'金融业-资本市场服务',family:'证券'},
  {scope:bank,industry:'金融业-货币金融服务',family:'通用'},
  {scope:bank,industry:'金融业-货币金融服务',family:'银行',observed:'2026-02-01'},
  {scope:'信息服务业务;计算机软件的技术开发和技术服务',industry:'金融业-其他金融业',family:'通用',mainBusiness:'互联网金融信息服务提供商，向证券公司和银行提供服务',method:'nonfinancial'},
  {scope:'信息服务业务;计算机软件的技术开发和技术服务',industry:'金融业-其他金融业',family:'银行',mainBusiness:'互联网金融信息服务提供商'},
  {scope:'信息服务业务;计算机软件的技术开发和技术服务',industry:'金融业-其他金融业',family:'通用',mainBusiness:'金融信息服务平台及自营投资'},
  {scope:'信息服务业务;发放贷款',industry:'金融业-其他金融业',family:'通用',mainBusiness:'金融信息服务平台'},
  {scope:'软件服务',industry:'金融业-其他金融业',family:'通用',mainBusiness:'服务金融机构的多元平台'},
  {scope:'软件服务',industry:'金融业-其他金融业',family:'通用',mainBusiness:'金融信息服务平台',observed:'2026-02-01'},
 ];
 try {
  for(const item of cases) {
   const statement={data:[{SECURITY_CODE:'600660',REPORT_DATE:'2025-12-31',REPORT_TYPE:'年报',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:item.family}]};
   const profile={success:true,result:{data:[{SECURITY_CODE:'600660',SECUCODE:'600660.SH',BUSINESS_SCOPE:item.scope,MAIN_BUSINESS:item.mainBusiness??'业务说明',INDUSTRYCSRC1:item.industry}]}};
   const sources=[];
   for(const [id,mapping,raw,url] of [['indicator','indicators',statement,'https://example.test/indicator'],['profile','company-profile',profile,'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO']] as const){
    const bytes=JSON.stringify(raw);await fs.writeFile(path.join(dir,id+'.json'),bytes);sources.push({id,mapping,path:id+'.json',url,mediaType:'application/json',fetchedAt:id==='profile'?(item.observed??'2026-09-09'):'2026-09-09',sha256:sha256(bytes)});
   }
   const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,sources,companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]}));
   const loaded=(await loadEvidenceInput(file)).input.companies[0];
   if(item.method)expect(loaded.method).toMatchObject({state:'applies',value:item.method,reason:item.reason??(item.method==='nonfinancial'?'reported_fee_information_services':'observed_business_profile_and_annual_statement_family')});
   else expect(loaded.method.state).toBe('unresolved');
   if(item.method==='nonfinancial') {
    // The pure routing boundary receives already-validated report facts. Extra
    // corroborating evidence must not reverse a valid fee-service classification.
    for(const [description,expected] of [['本公司提供金融信息服务','applies'],['本公司提供金融信息服务以及自营交易','unresolved']] as const) {
      const c=structuredClone(loaded) as CompanyFacts,base=c.facts.find(f=>f.field==='statementFamily')!;
      c.facts.push({...base,id:'primary',field:'business.primaryActivity',value:JSON.stringify({scope:'issuer',description})});
      resolveStatementMethod(c);
      expect(c.method.state,description).toBe(expected);
    }
   }
   const fact=loaded.facts.find(f=>f.field==='business.profile');expect(fact?.period).toEqual({start:item.observed??'2026-09-09',end:item.observed??'2026-09-09'});
   expect(loaded.checks.financing).toBeUndefined();
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('routes the saved China Life profile to life insurance without treating reinsurance or agency language as a group route',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-profile-'));
 try {
  const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
  const saved=Buffer.from(JSON.stringify(profiles.find((p:{ticker:string})=>p.ticker==='601628').response));
  const profilePath=path.join(dir,'profile.json'),statementPath=path.join(dir,'statement.json');await fs.writeFile(profilePath,saved);
  const statement=JSON.stringify({data:[{SECURITY_CODE:'601628',REPORT_DATE:'2025-12-31',REPORT_TYPE:'年报',NOTICE_DATE:'2026-03-26',CURRENCY:'CNY',ORG_TYPE:'保险'}]});await fs.writeFile(statementPath,statement);
  const input={schemaVersion:1,sources:[
   {id:'profile',mapping:'company-profile',path:'profile.json',url:'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=ALL&filter=%28SECUCODE%3D%22601628.SH%22%29&pageSize=1&pageNumber=1',mediaType:'application/json',fetchedAt:'2026-09-10T14:56:29.733Z',sha256:sha256(saved)},
   {id:'indicator',mapping:'indicators',path:'statement.json',url:'https://example.test/indicator',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statement)},
  ],companies:[{ticker:'601628',companyId:'601628',companyName:'中国人寿',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
  const inputFile=path.join(dir,'input.json');await fs.writeFile(inputFile,JSON.stringify(input));
  expect((await loadEvidenceInput(inputFile)).input.companies[0].method).toMatchObject({state:'applies',value:'life_insurance',reason:'observed_business_profile_and_annual_statement_family'});
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('routes saved direct futures and trust profiles without turning their ancillary activities into issuer-wide requirements',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'other-financial-profile-'));
 try {
  const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
  for(const [ticker,family,method] of [['002961','证券','futures'],['000563','银行','trust']] as const) {
   const saved=profiles.find((p:{ticker:string})=>p.ticker===ticker),profile=JSON.stringify(saved.response);
   const statement=JSON.stringify({data:[{SECURITY_CODE:ticker,REPORT_DATE:'2025-12-31',REPORT_TYPE:'年报',NOTICE_DATE:'2026-03-26',CURRENCY:'CNY',ORG_TYPE:family}]});
   await fs.writeFile(path.join(dir,`${ticker}-profile.json`),profile);await fs.writeFile(path.join(dir,`${ticker}-statement.json`),statement);
   const input={schemaVersion:1,sources:[
    {id:'profile',mapping:'company-profile',path:`${ticker}-profile.json`,url:saved.sourceUrl,mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(profile)},
    {id:'indicator',mapping:'indicators',path:`${ticker}-statement.json`,url:'https://example.test/indicator',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statement)},
   ],companies:[{ticker,companyId:ticker,companyName:'Synthetic identity name',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
   const file=path.join(dir,`${ticker}-input.json`);await fs.writeFile(file,JSON.stringify(input));
   expect((await loadEvidenceInput(file)).input.companies[0].method).toMatchObject({state:'applies',value:method,reason:'observed_business_profile_and_annual_statement_family'});
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('keeps insurance agents and mixed life-property profiles unresolved',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ambiguous-insurance-profile-'));
 try {
  for(const [index,scope] of ['保险代理服务;保险咨询服务','保险代理业务;代理销售人寿保险、健康保险、意外伤害保险','人寿保险、健康保险、意外伤害保险、财产保险','再保险业务;再保险经纪业务','控股公司投资;子公司经营人寿保险、健康保险、意外伤害保险'].entries()) {
   const statement=JSON.stringify({data:[{SECURITY_CODE:'600660',REPORT_DATE:'2025-12-31',REPORT_TYPE:'年报',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'保险'}]}),profile=JSON.stringify({success:true,result:{data:[{SECURITY_CODE:'600660',SECUCODE:'600660.SH',BUSINESS_SCOPE:scope,MAIN_BUSINESS:scope,INDUSTRYCSRC1:'金融业-保险业'}]}});
   await fs.writeFile(path.join(dir,`statement-${index}.json`),statement);await fs.writeFile(path.join(dir,`profile-${index}.json`),profile);
   const input={schemaVersion:1,sources:[{id:'statement',mapping:'indicators',path:`statement-${index}.json`,url:'https://example.test/statement',mediaType:'application/json',fetchedAt:'2026-09-09',sha256:sha256(statement)},{id:'profile',mapping:'company-profile',path:`profile-${index}.json`,url:'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO',mediaType:'application/json',fetchedAt:'2026-09-09',sha256:sha256(profile)}],companies:[{ticker:'600660',companyId:'600660',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-10',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
   const file=path.join(dir,`input-${index}.json`);await fs.writeFile(file,JSON.stringify(input));expect((await loadEvidenceInput(file)).input.companies[0].method.state).toBe('unresolved');
  }
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});


it('routes a saved ordinary business profile when investment is only an incidental listed activity',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mixed-primary-profile-'));
 try {
  const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
  const saved=profiles.find((p:{ticker:string})=>p.ticker==='600739');
  const statement=JSON.stringify({data:[{SECURITY_CODE:'600739',REPORT_DATE:'2025-12-31',REPORT_TYPE:'年报',NOTICE_DATE:'2026-04-30',CURRENCY:'CNY',ORG_TYPE:'通用'}]});
  await fs.writeFile(path.join(dir,'statement.json'),statement);
  const profile=JSON.stringify(saved.response);await fs.writeFile(path.join(dir,'profile.json'),profile);
  const file=path.join(dir,'input.json');
  const input={schemaVersion:1,sources:[{id:'statement',mapping:'indicators',path:'statement.json',url:'https://example.test/statement',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statement)},{id:'profile',mapping:'company-profile',path:'profile.json',url:saved.sourceUrl,mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(profile)}],companies:[{ticker:'600739',companyId:'600739',companyName:'Synthetic identity name',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
  await fs.writeFile(file,JSON.stringify(input));
  const c=(await loadEvidenceInput(file)).input.companies[0];
  expect(c.method).toMatchObject({state:'applies',value:'nonfinancial',reason:'reported_primary_operations'});
  expect(c.method.evidence).toContain('profile:business.profile');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('distinguishes an investment mention from conflicting primary business evidence',async()=>{
 const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
 const mainBusiness=profiles.find((p:{ticker:string})=>p.ticker==='600739').response.result.data[0].MAIN_BUSINESS;
 // Pure routing boundary: these are synthetic, source-validated observations,
 // not extra disclosures or a qualification claim about the saved issuer.
 const c:CompanyFacts={ticker:'600739',companyId:'600739',companyName:'Synthetic routing counterexample',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]};
 const base={entity:c.companyId,year:2025,period:{start:'2025-01-01',end:'2025-12-31'},publishedAt:'2026-04-30',basis:'test',unit:'text' as const,state:'observed' as const,evidence:[{sourceId:'synthetic',locator:'/description',raw:'synthetic source-validated observations'}]};
 c.facts=[{...base,id:'family',field:'statementFamily',value:'通用'},
  {...base,id:'classification',field:'industryClassification',value:'批发业'},
  {...base,id:'profile',field:'business.profile',publishedAt:'2026-09-10',value:JSON.stringify({scope:'贸易业务',industry:'批发和零售业-批发业',mainBusiness})}];
 resolveStatementMethod(c);
 expect(c.method).toMatchObject({state:'applies',value:'nonfinancial',reason:'exchange_classification_and_ordinary_statements'});
 const creditConflict=structuredClone(c);
 creditConflict.facts.find(f=>f.id==='profile')!.value=JSON.stringify({scope:'贸易业务',industry:'批发和零售业-批发业',mainBusiness:'经营商品批发，同时发放小额贷款'});
 resolveStatementMethod(creditConflict);
 expect(creditConflict.method).toMatchObject({state:'unresolved',reason:'conflicting_primary_business_evidence'});
 c.facts.push({...base,id:'primary',field:'business.primaryActivity',value:JSON.stringify({scope:'group',description:'药品批发及医疗设备销售'})});
 resolveStatementMethod(c);
 expect(c.method).toMatchObject({state:'applies',value:'nonfinancial',reason:'reported_primary_operations'});
 const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
 expect(evaluateCompany(c,policy).conditions.some(x=>x.reason==='method_pending')).toBe(false);
 for(const main of ['金融投资','本公司主要从事自有资金投资。','以金融控股为主']) {
  const conflict=structuredClone(c);
  conflict.facts.find(f=>f.id==='profile')!.value=JSON.stringify({scope:'投资业务',industry:'金融业-其他金融业',mainBusiness:main});
  resolveStatementMethod(conflict);
  expect(conflict.method,main).toMatchObject({state:'unresolved',reason:'conflicting_primary_business_evidence'});
  conflict.facts=conflict.facts.filter(f=>f.id!=='primary');resolveStatementMethod(conflict);
  expect(conflict.method,main).toMatchObject({state:'unresolved',reason:'reported_investment_operations_require_specific_method'});
 }
 const financialPrimary=structuredClone(c);
 financialPrimary.facts.find(f=>f.id==='primary')!.value=JSON.stringify({scope:'group',description:'金融投资及信用资产处置'});
 resolveStatementMethod(financialPrimary);
 expect(financialPrimary.method.state).toBe('unresolved');
 const missingPrimary=structuredClone(c);missingPrimary.facts=missingPrimary.facts.filter(f=>f.id!=='primary');resolveStatementMethod(missingPrimary);
 expect(missingPrimary.method).toMatchObject({state:'applies',value:'nonfinancial'});
});

it('uses industry-consistent ordinary operations without letting an incidental investment mention override them',()=>{
 const c:CompanyFacts={ticker:'SYN',companyId:'SYN',companyName:'Synthetic routing boundary',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]};
 const base={entity:c.companyId,year:2025,period:{start:'2025-01-01',end:'2025-12-31'},publishedAt:'2026-04-30',basis:c.basis,unit:'text' as const,state:'observed' as const,evidence:[{sourceId:'synthetic',locator:'/description',raw:'synthetic source-validated observations'}]};
 c.facts=[
  {...base,id:'family',field:'statementFamily',value:'通用'},
  {...base,id:'classification',field:'industryClassification',value:'燃气生产和供应业'},
  {...base,id:'profile',field:'business.profile',publishedAt:'2026-09-10',value:JSON.stringify({scope:'城市燃气业务',industry:'电力、热力、燃气及水生产和供应业-燃气生产和供应业',mainBusiness:'生猪养殖及金融投资'})},
  {...base,id:'primary',field:'business.primaryActivity',value:JSON.stringify({scope:'issuer',description:'河南省内的管道天然气业务、城市燃气等业务,位于天然气产业链的中下游'})},
 ];
 resolveStatementMethod(c);
 expect(c.method).toMatchObject({state:'applies',value:'nonfinancial',reason:'reported_primary_operations'});
 const breeding=structuredClone(c);
 breeding.facts=breeding.facts.filter(f=>f.id!=='primary');
 breeding.facts.find(f=>f.id==='classification')!.value='畜牧业';
 breeding.facts.find(f=>f.id==='profile')!.value=JSON.stringify({scope:'畜禽养殖',industry:'农、林、牧、渔业-畜牧业',mainBusiness:'肉鸡养殖、肉猪养殖及金融投资'});
 resolveStatementMethod(breeding);
 expect(breeding.method).toMatchObject({state:'applies',value:'nonfinancial',reason:'exchange_classification_and_ordinary_statements'});
});

it.each(['601318','601601'])('routes a saved insurance holding profile without assuming its regulatory capital scope (%s)',async ticker=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'insurance-holding-profile-'));
 try {
  const profiles=JSON.parse(await fs.readFile(new URL('../fixtures/company-profiles.json',import.meta.url),'utf8'));
  const saved=profiles.find((p:{ticker:string})=>p.ticker===ticker);
  for(const [index,scope] of [saved.response.result.data[0].BUSINESS_SCOPE,'保险投资咨询;监督管理咨询业务;','投资保险企业;','代理投资保险企业;监督管理控股投资企业的业务;'].entries()) {
   const profile=structuredClone(saved.response);profile.result.data[0].BUSINESS_SCOPE=scope;
   const statement=JSON.stringify({data:[{SECURITY_CODE:ticker,REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',ORG_TYPE:'保险'}]}),bytes=JSON.stringify(profile);
   await fs.writeFile(path.join(dir,`profile-${index}.json`),bytes);await fs.writeFile(path.join(dir,'statement.json'),statement);
   const input={schemaVersion:1,sources:[{id:'profile',mapping:'company-profile',path:`profile-${index}.json`,url:saved.sourceUrl,mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(bytes)},{id:'statement',mapping:'indicators',path:'statement.json',url:'https://example.test/statement',mediaType:'application/json',fetchedAt:'2026-09-10',sha256:sha256(statement)}],companies:[{ticker,companyId:ticker,companyName:'Uninformative name',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]}]};
   const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify(input));
   const company=(await loadEvidenceInput(file)).input.companies[0];
   expect(company.method).toMatchObject(index===0?{state:'applies',value:'insurance_group'}:{state:'unresolved'});
   expect(company.facts.some(f=>f.field==='regulatory.context'||f.field==='insurance.context')).toBe(false);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

it('accepts supported financial mappings but keeps future scope reviews out of an earlier decision', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scope-run-'));
  try {
    const statement={data:[{SECURITY_CODE:'TEST',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',PARENT_NETPROFIT:10}]};
    const review={schemaVersion:1,entity:'TEST',basis:'v1',asOf:'2026-12-31',reviewedAt:'2026-09-01',expiresAt:'2027-01-01',reviewer:'test reviewer',assertions:[{key:'method',value:'nonfinancial',criteria:'synthetic business scope',evidence:[{sourceId:'income',locator:'/data/0/SECURITY_CODE',raw:'TEST'}]}]};
    const sources=[];
    for(const [id,mapping,document] of [['income','income',statement],['review','reviewed-scope-v1',review]] as const) {
      const bytes=JSON.stringify(document);await fs.writeFile(path.join(dir,`${id}.json`),bytes);
      sources.push({id,mapping,path:`${id}.json`,url:`https://example.test/${id}`,mediaType:'application/json',fetchedAt:'2026-09-09',sha256:sha256(bytes)});
    }
    const input={schemaVersion:1,sources,companies:[{ticker:'TEST',companyId:'TEST',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-09',basis:'v1',latestFiscalYear:2025,
      method:{state:'applies',value:'nonfinancial',evidence:['review:0']},checks:{},facts:[
        ...parseCnStatementFacts(statement,{sourceId:'income',entity:'TEST',basis:'v1',kind:'income'}),
        {id:'review:0',field:'scope.method',entity:'TEST',year:2026,period:{start:'2026-12-31',end:'2026-12-31'},publishedAt:'2026-09-01',basis:'v1',unit:'text',state:'observed',value:'nonfinancial',evidence:[{sourceId:'review',locator:'/assertions/0/value',raw:'nonfinancial'}]},
      ]}]};
    const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify(input));
    const run=await loadEvidenceInput(file);
    expect(run.input.companies[0].facts.find(f=>f.field==='parentProfit')).toMatchObject({state:'observed',value:10});
    // Selecting only one imported fact cannot hide another observed disclosure.
    const omitted=structuredClone(input);
    omitted.companies[0].facts=omitted.companies[0].facts.filter(f=>f.field!=='parentProfit');
    await fs.writeFile(file,JSON.stringify(omitted));
    expect((await loadEvidenceInput(file)).input.companies[0].facts.find(f=>f.field==='parentProfit')).toMatchObject({state:'observed',value:10});
    expect(run.input.companies[0].method.state).toBe('unresolved');
    review.asOf='2026-09-01';
    input.companies[0].facts.at(-1)!.period={start:review.asOf,end:review.asOf};
    const reviewedBytes=JSON.stringify(review);await fs.writeFile(path.join(dir,'review.json'),reviewedBytes);
    sources[1].sha256=sha256(reviewedBytes);
    await fs.writeFile(file,JSON.stringify(input));
    expect((await loadEvidenceInput(file)).input.companies[0].method.state).toBe('applies');
    // A new source invalidates the old review even if its rows were omitted from imported facts.
    const revision=JSON.stringify({data:[{...statement.data[0],UPDATE_DATE:'2026-09-08'}]});
    await fs.writeFile(path.join(dir,'revision.json'),revision);
    sources.push({...sources[0],id:'revision',path:'revision.json',sha256:sha256(revision)});
    await fs.writeFile(file,JSON.stringify(input));
    expect((await loadEvidenceInput(file)).input.companies[0].method.state).toBe('unresolved');
    input.companies[0].facts[0].entity='ANOTHER';
    await fs.writeFile(file,JSON.stringify(input));
    await expect(loadEvidenceInput(file)).rejects.toThrow(/contract/i);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it.each([
 ['人民币、外币的人身保险(包括各类人寿保险、健康保险、意外伤害保险);为境内外保险机构代理保险', '保险', 'life_insurance'],
 ['保险代理销售人民币、外币的人身保险、健康保险、意外伤害保险', '保险', undefined],
 ['证券经纪;证券承销与保荐;商品期货经纪、金融期货经纪、期货投资咨询', '证券', 'broker'],
 ['商品期货经纪、金融期货经纪、期货投资咨询', '证券', 'futures'],
])('routes core licensed activity despite currency prefixes or ancillary activities: %s', (scope,family,expected) => {
 const c:CompanyFacts={ticker:'600001',companyId:'600001',companyName:'Synthetic',market:'CN',currency:'CNY',asOf:'2026-09-11',basis:'test',latestFiscalYear:2025,method:{state:'unresolved',evidence:[]},checks:{},facts:[]};
 const base={entity:c.companyId,year:2025,period:{start:'2025-01-01',end:'2025-12-31'},publishedAt:'2026-04-30',basis:'test',unit:'text',state:'observed' as const,evidence:[{sourceId:'synthetic',locator:'/source',raw:scope}]};
 c.facts=[{...base,id:'family',field:'statementFamily',value:family},{...base,id:'profile',field:'business.profile',publishedAt:'2026-09-10',value:JSON.stringify({scope,mainBusiness:scope,industry:family==='保险'?'金融业-保险业':'金融业-资本市场服务'})}];
 resolveStatementMethod(c);
 expect(c.method.state).toBe(expected?'applies':'unresolved');
 if(expected)expect(c.method.value).toBe(expected);
});
