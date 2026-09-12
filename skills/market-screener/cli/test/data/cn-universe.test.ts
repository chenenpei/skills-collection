import {expect,it} from 'vitest';
import {parseCnListingPage,reconcileCnUniverse} from '../../src/cn/sources/listings.js';
const sse=(page=1,total=2)=>({result:[{A_STOCK_CODE:page===1?'600660':'600276',SEC_NAME_CN:page===1?'福耀玻璃':'恒瑞医药',STOCK_TYPE:'1',LIST_DATE:'19930610',DELIST_DATE:'-',CSRC_CODE:'C',CSRC_CODE_DESC:'制造业'}],pageHelp:{pageNo:page,pageSize:1,pageCount:total,total}});
const source=(page=1)=>({id:`sse-${page}`,mapping:'sse-list' as const,url:`https://query.sse.com.cn/sseQuery/commonQuery.do?sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L&STOCK_TYPE=1&COMPANY_STATUS=2%2C4%2C5%2C7%2C8&pageHelp.pageNo=${page}`,fetchedAt:'2026-09-10T01:00:00Z'});
it('verifies the BSE current-list POST contract and preserves its selected-tier date qualification',()=>{
 const src={id:'bse-1',mapping:'bse-list' as const,url:'https://www.bse.cn/nqxxController/nqxxCnzq.do',fetchedAt:'2026-09-10T01:00:00Z',request:{method:'POST' as const,contentType:'application/x-www-form-urlencoded' as const,body:'page=0&typejb=T&xxfcbj%5B%5D=2&xxzqdm=&sortfield=xxzqdm&sorttype=asc'}};
 const raw=[{content:[{xxzqdm:'920000',xxzqjc:'安徽凤凰',xxzqjb:'T',xxfcbj:'2',fxssrq:'20201223',xxjsrq:'20260910',xxhyzl:'汽车制造业'}],firstPage:true,lastPage:true,number:0,numberOfElements:1,size:20,totalElements:1,totalPages:1}];
 const page=parseCnListingPage(raw,src);
 expect(page.identities[0]).toMatchObject({ticker:'920000',identity:{exchange:'BSE',listedAt:'2020-12-23',listedAtBasis:'exchange_listing_or_selected_tier',locator:'/0/content/0',industryLabels:['汽车制造业']}});
 expect(reconcileCnUniverse([page],src.fetchedAt).universe.coverage.find(c=>c.board==='BSE')).toMatchObject({state:'complete',received:1});
 expect(()=>parseCnListingPage(raw,{...src,request:{...src.request,body:src.request.body+'&xxhyzl=汽车制造业'}})).toThrow(/Unfiltered/);
 expect(()=>parseCnListingPage(raw,{...src,request:{...src.request,body:src.request.body.replace('page=0','page=1')}})).toThrow(/page number/);
 raw[0].content[0].xxjsrq='20260909';expect(()=>parseCnListingPage(raw,src)).toThrow(/snapshot date/);
});
it('keeps identities without quotes and distinguishes complete board coverage from whole-market coverage',()=>{
 const pages=[1,2].map(p=>parseCnListingPage(sse(p),source(p)));
 const result=reconcileCnUniverse(pages,'2026-09-10T01:01:00Z');
 expect(result.identities.map(c=>c.ticker)).toEqual(['600276','600660']);
 expect(result.identities[0].identity).toMatchObject({exchange:'SSE',industryLabels:['C 制造业'],listedAt:'1993-06-10'});
 expect(result.universe.status).toBe('partial');
 expect(result.universe.coverage.find(c=>c.board==='SSE_MAIN')).toMatchObject({state:'complete',expected:2,received:2});
 expect(result.universe.coverage.find(c=>c.board==='BSE')).toMatchObject({state:'missing',received:0});
});
it('never declares a paginated list complete after a repeated page, missing page or changing total',()=>{
 const first=parseCnListingPage(sse(),source());
 expect(reconcileCnUniverse([first],'2026-09-10T01:01:00Z').universe.coverage[0].state).toBe('partial');
 expect(()=>reconcileCnUniverse([first,first],'2026-09-10T01:01:00Z')).toThrow(/Duplicate listing page/);
 expect(()=>reconcileCnUniverse([first,parseCnListingPage(sse(2,3),source(2))],'2026-09-10T01:01:00Z')).toThrow(/changed during pagination/);
 const duplicate=sse(2);duplicate.result[0].A_STOCK_CODE='600660';
 expect(()=>reconcileCnUniverse([first,parseCnListingPage(duplicate,source(2))],'2026-09-10T01:01:00Z')).toThrow(/Duplicate security/);
});
it('rejects filtered or wrong-board queries and future snapshots instead of quietly shrinking the universe',()=>{
 expect(()=>parseCnListingPage(sse(),{...source(),url:source().url+'&CSRC_CODE=C'})).toThrow(/Unfiltered/);
 const wrong=sse();wrong.result[0].STOCK_TYPE='8';
 expect(()=>parseCnListingPage(wrong,source())).toThrow(/board/);
 expect(()=>reconcileCnUniverse([parseCnListingPage(sse(),source())],'2026-09-09T01:00:00Z')).toThrow(/cutoff/);
});
it('selects only the SZSE A-share tab, preserves leading zeros and strips label HTML',()=>{
 const meta={catalogid:'1110',name:'A股列表',tabkey:'tab1',subname:'2026-09-10 ',pagesize:20,pageno:1,pagecount:1,recordcount:1};
 const body=[{metadata:meta,data:[{agdm:'000001',agjc:"<a href='example'><u>平安银行</u></a>",agssrq:'1991-04-03',bk:'主板',sshymc:'J 金融业'}]},{metadata:{...meta,name:'A＋B股列表',tabkey:'tab4'},data:[{agdm:'000001'}]}];
 const src={id:'szse-1',mapping:'szse-list' as const,url:'https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=1',fetchedAt:'2026-09-10T01:00:00Z'};
 const result=parseCnListingPage(body,src);
 expect(result.identities).toHaveLength(1);expect(result.identities[0]).toMatchObject({ticker:'000001',companyName:'平安银行',identity:{industryLabels:['J 金融业'],exchange:'SZSE'}});
 expect(()=>parseCnListingPage(body,{...src,url:src.url+'&selectModule=main'})).toThrow(/Unfiltered/);
 const future=structuredClone(body);future[0].metadata.subname='2026-09-11';
 expect(()=>parseCnListingPage(future,src)).toThrow(/snapshot date/);
});

it('archives a budget-limited universe, verifies identity provenance and replays its partial status',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const {collectCnUniverse}=await import('../../src/cn/sources/listings.js');
 const {loadEvidenceInput}=await import('../../src/cn/evidence.js');
 const {runEvidenceSnapshot,readEvidenceRun,replayEvidenceRun}=await import('../../src/cn/run-archive.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-universe-'));
 try {
  let calls=0;
  const result=await collectCnUniverse(path.join(dir,'universe'),{maxRequests:1,maxMs:10000,requestMs:1000},{now:()=>Date.parse('2026-09-10T01:00:00Z'),fetch:async()=>{calls++;return new Response(JSON.stringify(sse()));}});
  expect(calls).toBe(1);expect(result).toMatchObject({status:'partial',count:1});
  const {input}=await loadEvidenceInput(result.inputFile);expect(input.companies[0].ticker).toBe('600660');
  expect(input.companies[0].identity?.sourceId).toBe('listing:SSE_MAIN:1');
  const output=path.join(dir,'run');
  await runEvidenceSnapshot(result.inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  const saved=await readEvidenceRun(output);
  expect(saved.manifest.status).toBe('partial');expect(saved.results[0].identity).toEqual(input.companies[0].identity);
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:1});
  const original=await fs.readFile(result.inputFile,'utf8'),raw=JSON.parse(original);
  raw.companies=[];await fs.writeFile(result.inputFile,JSON.stringify(raw));
  await expect(loadEvidenceInput(result.inputFile)).rejects.toThrow(/removed or added/);
  raw.companies=JSON.parse(original).companies;raw.companies[0].identity.industryLabels=['J 金融业'];await fs.writeFile(result.inputFile,JSON.stringify(raw));
  await expect(loadEvidenceInput(result.inputFile)).rejects.toThrow(/Identity differs/);
  raw.companies=JSON.parse(original).companies;raw.universe.status='complete';await fs.writeFile(result.inputFile,JSON.stringify(raw));
  await expect(loadEvidenceInput(result.inputFile)).rejects.toThrow(/coverage/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
},20_000); // Includes two isolated replay processes plus source-integrity rejection checks.
it('accepts an explicit development sample only when archived exchange pages still reconcile the full universe',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const {collectCnUniverse}=await import('../../src/cn/sources/listings.js');
 const {loadEvidenceInput}=await import('../../src/cn/evidence.js');
 const {runEvidenceSnapshot,openEvidenceRun,replayEvidenceRun}=await import('../../src/cn/run-archive.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-universe-selection-'));
 try {
  const collected=await collectCnUniverse(path.join(dir,'universe'),{maxRequests:2,maxMs:10000,requestMs:1000},{now:()=>Date.parse('2026-09-10T01:00:00Z'),fetch:async(url)=>new Response(JSON.stringify(sse(Number(new URL(url).searchParams.get('pageHelp.pageNo')))))});
  expect(collected).toMatchObject({status:'partial',count:2});
  const original=JSON.parse(await fs.readFile(collected.inputFile,'utf8'));
  const sampled={...original,selection:{companyIds:[original.companies[0].companyId],reason:'development sample'},companies:[original.companies[0]]};
  await fs.writeFile(collected.inputFile,JSON.stringify(sampled));
  expect((await loadEvidenceInput(collected.inputFile)).input.companies).toHaveLength(1);
  const reject=async(change:(input:any)=>void,pattern:RegExp)=>{
   const candidate=structuredClone(sampled);change(candidate);await fs.writeFile(collected.inputFile,JSON.stringify(candidate));
   await expect(loadEvidenceInput(collected.inputFile)).rejects.toThrow(pattern);
  };
  await reject(input=>{input.companies=[];},/selection/);
  await reject(input=>{input.companies=original.companies;},/selection/);
  await reject(input=>{input.selection.companyIds=[sampled.selection.companyIds[0],sampled.selection.companyIds[0]];},/unique/);
  await reject(input=>{input.selection.companyIds=['999999'];},/absent from exchange universe/);
  await reject(input=>{delete input.selection;},/removed or added/);
  await fs.writeFile(collected.inputFile,JSON.stringify(sampled));
  const output=path.join(dir,'run');
  await runEvidenceSnapshot(collected.inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  const run=await openEvidenceRun(output);
  expect(run.manifest).toMatchObject({status:'partial',selection:sampled.selection});
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:1});
  const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
  manifest.selection={companyIds:['600276'],reason:'tampered'};await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest));
  await expect(openEvidenceRun(output)).rejects.toThrow(/selection does not match input/);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
it('collects every BSE page as original JSONP bytes and replays the complete four-board universe',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const {collectCnUniverse}=await import('../../src/cn/sources/listings.js');
 const {loadEvidenceInput}=await import('../../src/cn/evidence.js');
 const {runEvidenceSnapshot,replayEvidenceRun}=await import('../../src/cn/run-archive.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-bse-universe-'));
 try {
  const bodies:string[]=[];
  const collected=await collectCnUniverse(path.join(dir,'universe'),{maxRequests:5,maxMs:15000,requestMs:1000},{now:()=>Date.parse('2026-09-10T01:00:00Z'),fetch:async(url,init)=>{
   if(url.includes('sse.com.cn')) {const body=sse(1,1);if(new URL(url).searchParams.get('STOCK_TYPE')==='8') Object.assign(body.result[0],{A_STOCK_CODE:'688001',STOCK_TYPE:'8'});return new Response(JSON.stringify(body));}
   if(url.includes('szse.cn')) return new Response(JSON.stringify([{metadata:{catalogid:'1110',name:'A股列表',tabkey:'tab1',subname:'2026-09-10',pageno:1,pagesize:20,pagecount:1,recordcount:1},data:[{agdm:'000001',agjc:'平安银行',agssrq:'1991-04-03',bk:'主板',sshymc:'金融业'}]}]));
   expect(init?.method).toBe('POST');expect(new Headers(init?.headers).get('Origin')).toBe('https://www.bse.cn');
   const body=String(init?.body);bodies.push(body);const page=Number(new URLSearchParams(body).get('page'));
   return new Response('null('+JSON.stringify([{content:[{xxzqdm:page?'920001':'920000',xxzqjc:page?'纬达光电':'安徽凤凰',xxzqjb:'T',xxfcbj:'2',fxssrq:'20221227',xxjsrq:'20260910',xxhyzl:'制造业'}],firstPage:page===0,lastPage:page===1,number:page,numberOfElements:1,size:1,totalElements:2,totalPages:2}])+')');
  }});
  expect(collected).toMatchObject({status:'complete',count:5});expect(bodies.map(b=>new URLSearchParams(b).get('page'))).toEqual(['0','1']);
  const {input}=await loadEvidenceInput(collected.inputFile),bse=input.sources.filter(s=>s.mapping==='bse-list');
  expect(bse).toHaveLength(2);expect(bse[1].request?.body).toBe(bodies[1]);
  expect(await fs.readFile(path.join(path.dirname(collected.inputFile),bse[0].path),'utf8')).toMatch(/^null\(\[/);
  const output=path.join(dir,'run');await runEvidenceSnapshot(collected.inputFile,output,{policyFile:new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname});
  expect(await replayEvidenceRun(output)).toMatchObject({matches:true,count:5});
  const {collectCnEvidence}=await import('../../src/cn/collection.js');
  const financial=await collectCnEvidence(collected.inputFile,path.join(dir,'financial'),{asOf:'2026-09-10T02:00:00Z',budget:{attempts:1,requestMs:1000,companyRequests:1,companyMs:10000,globalRequests:1,globalMs:10000},concurrency:1},{now:()=>Date.parse('2026-09-10T02:00:00Z'),fetch:async()=>new Response('unavailable',{status:503})});
  expect(financial.status).toBe('partial');expect((await loadEvidenceInput(financial.inputFile)).input.companies).toHaveLength(5);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

it('saves obtained identities on interruption and does not call an unavailable next source',async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const {collectCnUniverse}=await import('../../src/cn/sources/listings.js');
 const {loadEvidenceInput}=await import('../../src/cn/evidence.js');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cn-universe-abort-')),controller=new AbortController();
 try {
  let calls=0;
  const result=await collectCnUniverse(path.join(dir,'universe'),{maxRequests:100,maxMs:10000,requestMs:1000,signal:controller.signal},{now:()=>Date.parse('2026-09-10T01:00:00Z'),fetch:async()=>{calls++;controller.abort();return new Response(JSON.stringify(sse()));}});
  expect(calls).toBe(1);expect(result).toMatchObject({status:'partial',count:1});
  expect((await loadEvidenceInput(result.inputFile)).input.companies).toHaveLength(1);
  expect(JSON.parse(await fs.readFile(path.join(dir,'universe/collection.json'),'utf8')).interrupted).toBe(true);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});
