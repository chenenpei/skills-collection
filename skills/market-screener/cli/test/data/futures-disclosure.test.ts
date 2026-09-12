import fs from 'node:fs/promises';
import {expect,it} from 'vitest';
import {parseCnDisclosureFacts} from '../../src/cn/sources/annual-reports.js';
import {evaluateCompany} from '../../src/cn/screening.js';
import {loadCnPolicy} from '../../src/policy/loader.js';
it('uses actual PDF table cells to bind December futures amounts and the separate regulatory/warning columns',async()=>{
 const document=JSON.parse(await fs.readFile(new URL('../fixtures/futures-regulatory-pages.json',import.meta.url),'utf8'));
 const facts=parseCnDisclosureFacts(document,{sourceId:'real-futures-pdf',basis:'report'});
 const context=JSON.parse(String(facts.find(f=>f.field==='regulatory.context')?.value));
 expect(context).toMatchObject({scope:'legal_entity',assetScope:'own_funds_excluding_client_assets',reportYear:2025,metrics:{ownDebtEquity:{direction:'maximum',requirementKind:'warning'}}});
 expect(facts.find(f=>f.id===context.metrics.netCapital.actualFactId)).toMatchObject({value:1782100700,unit:'CNY',unitScale:10000,evidence:[{locator:'/pages/61/tables/0/1/14',raw:'178,2\n10.07'}]});
 expect(facts.find(f=>f.id===context.metrics.netCapital.requirementFactId)?.value).toBe(36000000);
 expect(facts.find(f=>f.id===context.metrics.ownSettlementReserve.requirementFactId)?.value).toBe(16000000);
 expect(facts.find(f=>f.field==='business.licensedMethod')?.value).toBe('futures');
 const result=evaluateCompany({ticker:'002961',companyId:'002961',companyName:'Source report issuer',market:'CN',currency:'CNY',asOf:'2026-09-10',latestFiscalYear:2025,basis:'report',method:{state:'applies',value:'futures',coverage:{start:'2025-01-01',end:'2025-12-31'},evidence:[facts.find(f=>f.field==='business.licensedMethod')!.id]},checks:{},facts},await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname),{evaluateAll:true});
 expect(result.conditions.find(r=>r.id==='F.risk')?.state).toBe('pass');expect(result.quality).toBe('unknown');
 document.pages['61'].tables[0][0][14]='11 月';
 expect(parseCnDisclosureFacts(document,{sourceId:'wrong-months',basis:'report'}).some(f=>f.field==='regulatory.context')).toBe(false);
});
it('never turns an actual-value bound into an exact ratio or suppresses a conflicting second regulatory table',async()=>{
 const original=JSON.parse(await fs.readFile(new URL('../fixtures/futures-regulatory-pages.json',import.meta.url),'utf8'));
 const bound=structuredClone(original);bound.pages['61'].tables[0][5][14]='≥20';
 const facts=parseCnDisclosureFacts(bound,{sourceId:'bound-cell',basis:'report'});
 expect(facts.some(f=>f.field==='regulatory.actual.ownDebtEquity')).toBe(false);
 const opposite=structuredClone(original);opposite.pages['61'].tables[0][5][2]='≥120';
 expect(parseCnDisclosureFacts(opposite,{sourceId:'wrong-warning-direction',basis:'report'}).some(f=>f.field==='regulatory.requirement.ownDebtEquity')).toBe(false);
 const duplicate=structuredClone(original),second=structuredClone(duplicate.pages['61'].tables[0]);second[5][14]='150';duplicate.pages['61'].tables.push(second);
 expect(parseCnDisclosureFacts(duplicate,{sourceId:'duplicate-tables',basis:'report'}).some(f=>f.field==='regulatory.context')).toBe(false);
});

it('identifies an issuer futures license across cover and company-information pages without borrowing a subsidiary license',async()=>{
 const original=JSON.parse(await fs.readFile(new URL('../fixtures/nanhua-futures-pages.json',import.meta.url),'utf8'));
 const parse=(document:typeof original)=>parseCnDisclosureFacts(document,{sourceId:'nanhua-report',basis:'report'});
 expect(parse(original).find(f=>f.field==='business.licensedMethod')).toMatchObject({value:'futures',entity:'603093',evidence:[{locator:'/pages/1/text'},{locator:'/pages/6/text'}]});
 const changed=(search:string,replacement:string)=>{const d=structuredClone(original);d.pages['6'].text=d.pages['6'].text.replace(search,replacement);d.pages['6'].lines=d.pages['6'].text.split('\n');return d;};
 expect(parse(changed('公司持有中国证监会颁发的','子公司持有中国证监会颁发的')).some(f=>f.field==='business.licensedMethod')).toBe(false);
 expect(parse(changed('商品期货经纪、金融期货经纪','基金管理、投资顾问')).some(f=>f.field==='business.licensedMethod')).toBe(false);
 expect(parse(changed('公司的中文名称 \t南华期货股份有限公司','公司的中文名称 \t其他期货股份有限公司')).some(f=>f.field==='business.licensedMethod')).toBe(false);
 const wrong=structuredClone(original);wrong.pages['1'].text=wrong.pages['1'].text.replace('603093','603094');wrong.pages['1'].lines=wrong.pages['1'].text.split('\n');
 expect(parse(wrong).some(f=>f.field==='business.licensedMethod')).toBe(false);
});

it('retains an issuer annual futures table with its two reported dates without inventing warning requirements or client-asset scope',async()=>{
 const original=JSON.parse(await fs.readFile(new URL('../fixtures/nanhua-futures-pages.json',import.meta.url),'utf8'));
 const parse=(document:typeof original)=>parseCnDisclosureFacts(document,{sourceId:'nanhua-annual',basis:'report'});
 const facts=parse(original);
 expect(facts.find(f=>f.field==='regulatory.actual.netCapital'&&f.year===2025)).toMatchObject({value:2744256789.93,unit:'CNY'});
 expect(facts.find(f=>f.field==='regulatory.actual.futuresRiskCoverage'&&f.year===2025)).toMatchObject({value:2.4,unit:'ratio'});
 expect(facts.find(f=>f.field==='regulatory.actual.ownSettlementReserve'&&f.year===2024)).toMatchObject({value:1160380887.58,unit:'CNY'});
 expect(facts.some(f=>f.field.startsWith('regulatory.requirement.'))).toBe(false);
 const context=JSON.parse(String(facts.find(f=>f.field==='regulatory.context'&&f.year===2025)?.value));
 expect(context).toMatchObject({subject:'603093',scope:'legal_entity',regime:'CSRC-202',reportYear:2025,position:'closing'});
 expect(context.assetScope).toBeUndefined();
 const changed=(search:string,replacement:string)=>{const d=structuredClone(original);d.pages['18'].text=d.pages['18'].text.replace(search,replacement);d.pages['18'].lines=d.pages['18'].text.split('\n');return d;};
 expect(parse(changed('母公司的净资本及风险控制指标','子公司的净资本及风险控制指标')).some(f=>f.field.startsWith('regulatory.actual.'))).toBe(false);
 expect(parse(changed('项目 \t本报告期末 \t上年度末','项目 \t上年度末 \t本报告期末')).some(f=>f.field.startsWith('regulatory.actual.'))).toBe(false);
 const noVersion=structuredClone(original);delete noVersion.pages['198'];
 expect(parse(noVersion).some(f=>f.field==='regulatory.context')).toBe(false);
 expect(parse(noVersion).some(f=>f.field==='regulatory.actual.netCapital'&&f.year===2025)).toBe(true);
});
