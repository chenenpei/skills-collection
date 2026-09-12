import fs from 'node:fs/promises';
import {beforeAll,expect,it} from 'vitest';
import {parseCnInsuranceFacts} from '../../src/cn/sources/financial-reports.js';
import type {DisclosureText} from '../../src/cn/sources/annual-reports.js';
let reports:Array<{year:number;source:{availableBy:string};pages:DisclosureText['pages']}>;
let accountingPolicyPages:Array<{year:number;pages:Record<string,{lines:string[]}>}>;
let serviceStatements:Array<{entity:string;periodEnd:string;publishedAt:string;source:{sha256:string;page:string};pages:DisclosureText['pages']}>;
beforeAll(async()=>{
  reports=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-group-solvency-pages.json',import.meta.url),'utf8'));
  accountingPolicyPages=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-group-accounting-policy-cn-pages.json',import.meta.url),'utf8')).reports;
  serviceStatements=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-service-statements.json',import.meta.url),'utf8')).reports;
});
function document(year=2025):DisclosureText{const report=reports.find(r=>r.year===year)!;return {entity:'SOURCE-VERIFIED-ISSUER',periodEnd:`${year}-12-31`,publishedAt:report.source.availableBy,pages:structuredClone(report.pages)};}
function attachAccountingPolicy(document:DisclosureText,year:number) {
  const report=accountingPolicyPages.find(r=>r.year===year)!;
  for(const [page,content] of Object.entries(report.pages)) document.pages[page]={lines:[...content.lines],text:content.lines.join('\n')};
}
function serviceStatement(entity:string):DisclosureText {
  const report=serviceStatements.find(r=>r.entity===entity)!;
  return {entity:report.entity,periodEnd:report.periodEnd,publishedAt:report.publishedAt,pages:Object.fromEntries(Object.entries(report.pages).map(([page,content])=>[page,{lines:[...content.lines],text:content.lines.join('\n')}]))};
}
it('extracts only the four signed insurance-service operands from the common actual consolidated income-statement format',()=>{
  for(const [entity,expected] of [['601628',[214136,-148736,-5750,5248]],['601318',[559502,-453268,-16098,11032]]] as const) {
    const report=serviceStatements.find(r=>r.entity===entity)!;
    const facts=parseCnInsuranceFacts(serviceStatement(entity),{sourceId:report.source.sha256,basis:'CN-consolidated-CAS'});
    const fields=['insurance.serviceRevenue','insurance.serviceExpense','insurance.reinsuranceAllocation','insurance.reinsuranceRecovery'];
    expect(fields.map(field=>facts.find(f=>f.field===field&&f.year===2025)?.value)).toEqual(expected.map(value=>value*1_000_000));
    expect(facts.filter(f=>fields.includes(f.field)).every(f=>f.state==='observed'&&f.unit==='CNY'&&f.unitScale===1_000_000&&f.evidence[0].locator===`/pages/${report.source.page}/lines/${f.evidence[0].locator.split('/').at(-1)}`)).toBe(true);
    expect(facts.some(f=>f.field==='insurance.serviceResult')).toBe(false);
  }
});
it('accepts the issuer-specific, explicitly bounded CAS25 restatement declaration without inventing an operating result',()=>{
  const report=serviceStatements.find(r=>r.entity==='601628')!;
  const facts=parseCnInsuranceFacts(serviceStatement('601628'),{sourceId:report.source.sha256,basis:'CN-consolidated-CAS'});
  expect(facts.filter(f=>f.field==='insurance.accountingBasis').map(f=>[f.year,f.value])).toEqual([[2023,'CAS25-2023'],[2024,'CAS25-2023'],[2025,'CAS25-2023']]);
});
it('rejects company-only, wrong-unit, incomplete, and liability-roll-forward lookalikes',()=>{
  const base=serviceStatement('601628');
  const variants=[
    (d:DisclosureText)=>d.pages['93'].lines[0]='2025年度公司利润表',
    (d:DisclosureText)=>d.pages['93'].lines[1]='（除特别注明外，金额单位为美元百万元）',
    (d:DisclosureText)=>d.pages['93'].lines=d.pages['93'].lines.filter(line=>!line.includes('摊回保险服务费用')),
    (d:DisclosureText)=>d.pages['93']={lines:['保险合同负债变动表','（除特别注明外，金额单位为人民币百万元）','2025年度 2024年度','保险服务业绩 (65,112) (28,204)'],text:''},
  ];
  for(const mutate of variants) {
    const d=structuredClone(base);mutate(d);
    const facts=parseCnInsuranceFacts(d,{sourceId:'rejected',basis:'CN-consolidated-CAS'});
    expect(facts.some(f=>f.field.startsWith('insurance.service'))).toBe(false);
  }
});
it('extracts the group solvency ratios, definitions and applicable requirements from the actual English report without mixing subsidiary columns',()=>{
  const facts=parseCnInsuranceFacts(document(),{sourceId:'real-pdf-2025',basis:'source-regulatory-basis'});
  const actual=facts.find(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2025)!;
  expect(actual).toMatchObject({value:1.607,unit:'ratio',unitScale:0.01,entity:'SOURCE-VERIFIED-ISSUER'});
  expect(facts.find(f=>f.field==='regulatory.actual.comprehensiveSolvency'&&f.year===2025)?.value).toBe(1.933);
  expect(facts.find(f=>f.field==='regulatory.requirement.coreSolvency'&&f.year===2025)?.value).toBe(0.5);
  const context=JSON.parse(String(facts.find(f=>f.field==='insurance.context')?.value));
  expect(context).toMatchObject({scope:'group',kind:'group',accountingStandard:'regulatory-only',reportYear:2025});
  const regulatory=JSON.parse(String(facts.find(f=>f.id===context.regulatoryContextFactId)?.value));
  expect(regulatory).toMatchObject({scope:'regulatory_consolidated',regime:'C-ROSS-II',metrics:{coreSolvency:{actualFactId:actual.id,definition:'core-capital/minimum-capital',direction:'minimum'}}});
  expect(facts.some(f=>f.field==='weightedRoe'||f.field==='insurance.riskRating')).toBe(false);
});
it('binds source-stated group CAS 25 accounting policy to each report year, retaining the 2023 transition instead of inventing an operating result',async()=>{
  const d2023=await chineseDocument2023();attachAccountingPolicy(d2023,2023);
  const d2024=document(2024);attachAccountingPolicy(d2024,2024);
  const d2025=await chineseDocument();attachAccountingPolicy(d2025,2025);
  for(const [year,d] of [[2023,d2023],[2024,d2024],[2025,d2025]] as const) {
    const facts=parseCnInsuranceFacts(d,{sourceId:`cn-${year}-accounting`,basis:'CN-consolidated-CAS'});
    const basis=facts.find(f=>f.field==='insurance.accountingBasis')!;
    const context=JSON.parse(String(facts.find(f=>f.field==='insurance.context')?.value));
    expect(facts.filter(f=>f.field==='insurance.accountingBasis')).toHaveLength(1);
    expect(basis).toMatchObject({year,value:'CAS25-2023',unit:'text',state:'observed',period:{start:`${year}-01-01`,end:`${year}-12-31`}});
    expect(basis.evidence).toHaveLength(1);
    expect(context).toMatchObject({accountingStandard:'CAS25-2023',accountingBasisFactId:basis.id,comparisonBasis:'CAS25-2023:group-insurance-contract-policy',operating:{}});
    expect(facts.some(f=>f.field==='insurance.serviceResult'||f.field==='insurance.reinsuranceResult')).toBe(false);
  }
  const transitionContext=factsFor(d2023,2023);
  expect(transitionContext.evidence.map(e=>e.locator)).toContain('/pages/196/text');
});
it('rejects a group basis when the policy version, adoption state, subject, or same-document declarations conflict',async()=>{
  const valid=await chineseDocument();attachAccountingPolicy(valid,2025);
  const policyLine=valid.pages['214'].lines.findIndex(line=>line.includes('企业会计准则第25号'));
  const cases=[
    (d:DisclosureText)=>updatePage(d,'214',lines=>{lines[policyLine]=lines[policyLine].replace('财会[2020]20号','财会[2021]20号');}),
    (d:DisclosureText)=>updatePage(d,'214',lines=>lines.push('本集团计划采用新保险合同准则，尚未执行。')),
    (d:DisclosureText)=>updatePage(d,'214',lines=>{lines[policyLine]=lines[policyLine].replace('本集团','平安产险');}),
    (d:DisclosureText)=>updatePage(d,'214',lines=>lines.push('本集团根据财政部发布的《企业会计准则第25号 —— 保险合同》（财会[2021]20号）制定了保险合同相关的会计政策。')),
    (d:DisclosureText)=>updatePage(d,'214',lines=>lines.push('本集团于2023年1月1日开始执行新保险合同准则。','本集团于2024年1月1日开始执行新保险合同准则。')),
  ];
  for(const alter of cases) {
    const d=structuredClone(valid);alter(d);
    const facts=parseCnInsuranceFacts(d,{sourceId:'invalid-accounting-policy',basis:'CN-consolidated-CAS'});
    expect(facts.some(f=>f.field==='insurance.accountingBasis')).toBe(false);
    expect(JSON.parse(String(facts.find(f=>f.field==='insurance.context')?.value)).accountingStandard).toBe('regulatory-only');
  }
});
function factsFor(document:DisclosureText,year:number) {return parseCnInsuranceFacts(document,{sourceId:`cn-${year}-accounting`,basis:'CN-consolidated-CAS'}).find(f=>f.field==='insurance.context')!;}
it('binds the group’s two independent pressure rows to its own closing capital, retaining percentage-point units',()=>{
  const facts=parseCnInsuranceFacts(document(),{sourceId:'real-pdf-2025',basis:'source-regulatory-basis'});
  const context=JSON.parse(String(facts.find(f=>f.field==='insurance.context')?.value));
  const interest=context.stress.interest_rate_minus_50bp, equity=context.stress.equity_minus_10pct;
  expect(facts.find(f=>f.id===interest.coreSolvency.factId)).toMatchObject({value:-1.2,unit:'percentage_points',entity:'SOURCE-VERIFIED-ISSUER',period:{start:'2025-12-31',end:'2025-12-31'}});
  expect(facts.find(f=>f.id===interest.comprehensiveSolvency.factId)?.value).toBe(-2.5);
  expect(facts.find(f=>f.id===equity.coreSolvency.factId)?.value).toBe(-4.4);
  expect(facts.find(f=>f.id===equity.comprehensiveSolvency.factId)?.value).toBe(-3.7);
  expect(interest.coreSolvency.baseFactId).toBe(facts.find(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2025)?.id);
  expect(facts.some(f=>f.field.startsWith('insurance.stress.')&&f.year===2024)).toBe(false);
});
function updatePage(d:DisclosureText,page:string,change:(lines:string[])=>unknown) {const result=change(d.pages[page].lines);if(Array.isArray(result))d.pages[page].lines=result;d.pages[page].text=d.pages[page].lines.join('\n');}
it('refuses conflicting capital rows and never scales smaller shocks or borrows a different first subject’s stress column',()=>{
  const conflicting=document();updatePage(conflicting,'91',lines=>lines.push('Core solvency margin ratio (%) 80.0 165.2'));
  expect(parseCnInsuranceFacts(conflicting,{sourceId:'conflicting',basis:'regulatory'}).some(f=>f.field==='insurance.context')).toBe(false);
  const smaller=document();updatePage(smaller,'91',lines=>{const i=lines.findIndex(l=>l==='50 bps decline in current');lines[i]='25 bps decline in current';});
  expect(parseCnInsuranceFacts(smaller,{sourceId:'smaller',basis:'regulatory'}).some(f=>f.field.includes('interest_rate_minus_50bp'))).toBe(false);
  const shifted=document();updatePage(shifted,'91',lines=>{const i=lines.findIndex(l=>l.startsWith('December 31, 2025')&&l.includes('Ping An Group'));lines[i]=lines[i].replace('Ping An Group','Ping An Life');});
  expect(parseCnInsuranceFacts(shifted,{sourceId:'shifted',basis:'regulatory'}).some(f=>f.field.startsWith('insurance.stress.'))).toBe(false);
});
it('preserves the prior report’s base values and points requirement observations at the line containing the actual number',()=>{
  const facts=parseCnInsuranceFacts(document(2024),{sourceId:'real-pdf-2024',basis:'source-regulatory-basis'});
  expect(facts.find(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2024)?.value).toBe(1.652);
  expect(facts.find(f=>f.field==='regulatory.actual.comprehensiveSolvency'&&f.year===2023)?.value).toBe(2.08);
  expect(facts.find(f=>f.field==='regulatory.requirement.coreSolvency')?.evidence[0].raw).toContain('50%');
  expect(facts.find(f=>f.field==='regulatory.requirement.comprehensiveSolvency')?.evidence[0].raw).toContain('100%');
  expect(facts.some(f=>f.field.startsWith('insurance.stress.'))).toBe(false);
});
it('runs the real group capital and pressure facts through the shared evaluator while preserving rating, accounting and subsidiary gaps',async()=>{
  const {evaluateCompany}=await import('../../src/cn/screening.js');
  const {loadCnPolicy}=await import('../../src/policy/loader.js');
  const facts=[2024,2025].flatMap(year=>parseCnInsuranceFacts(document(year),{sourceId:`real-pdf-${year}`,basis:'source-regulatory-basis'}));
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const result=evaluateCompany({ticker:'SOURCE-VERIFIED-ISSUER',companyId:'SOURCE-VERIFIED-ISSUER',companyName:'Source report group',market:'CN',currency:'CNY',asOf:'2026-09-10',latestFiscalYear:2025,basis:'source-regulatory-basis',method:{state:'applies',value:'insurance_group',coverage:{start:'2025-01-01',end:'2025-12-31'},evidence:[facts.find(f=>f.field==='insurance.context')!.id]},checks:{},facts},policy,{evaluateAll:true});
  const flatten=(xs:typeof result.conditions):typeof result.conditions=>xs.flatMap(x=>[x,...flatten(x.components??[])]);
  const conditions=flatten(result.conditions);
  expect(conditions.find(r=>r.id==='F.risk.SOURCE-VERIFIED-ISSUER.coreSolvency')?.state).toBe('pass');
  expect(conditions.find(r=>r.id==='F.risk.SOURCE-VERIFIED-ISSUER.rating')).toMatchObject({state:'not_applicable',reason:'insurance_rating_not_verified'});
  expect(conditions.find(r=>r.id==='P2.stress')).toBeUndefined();
  expect(result.quality).toBe('unknown');expect(result.priority).toBe('unknown');
});
async function chineseDocument():Promise<DisclosureText>{const r=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-group-solvency-cn-pages.json',import.meta.url),'utf8'));return {entity:'SOURCE-VERIFIED-ISSUER',periodEnd:'2025-12-31',publishedAt:r.publishedAt,pages:r.pages};}
async function chineseDocument2023():Promise<DisclosureText>{const r=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-group-solvency-cn-2023-pages.json',import.meta.url),'utf8'));return {entity:'SOURCE-VERIFIED-ISSUER',periodEnd:r.periodEnd,publishedAt:r.publishedAt,pages:structuredClone(r.pages)};}
it('reads both Chinese group tables and retains agreeing observations without creating conflicting contexts',async()=>{
  const facts=parseCnInsuranceFacts(await chineseDocument(),{sourceId:'cn-original',basis:'source-regulatory-basis'});
  expect(facts.filter(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2025).map(f=>f.value)).toEqual([1.607,1.607]);
  expect(facts.filter(f=>f.field==='insurance.context')).toHaveLength(1);
  const context=JSON.parse(String(facts.find(f=>f.field==='insurance.context')?.value));
  expect(context).toMatchObject({accountingStandard:'regulatory-only',scope:'group'});
  expect(facts.find(f=>f.id===context.stress.interest_rate_minus_50bp.coreSolvency.factId)?.value).toBe(-1.2);
  expect(facts.find(f=>f.id===context.stress.interest_rate_minus_50bp.comprehensiveSolvency.factId)?.value).toBe(-2.5);
  expect(facts.find(f=>f.field==='insurance.context')?.evidence.map(e=>e.locator)).toEqual(expect.arrayContaining(['/pages/89/text','/pages/105/text','/pages/106/text']));
  expect(facts.some(f=>f.field==='insurance.riskRating')).toBe(false);
});
it('keeps contradictory Chinese duplicate tables unresolved and interprets an increase as a positive percentage-point change',async()=>{
  const conflicting=await chineseDocument();updatePage(conflicting,'106',lines=>{const i=lines.findIndex(l=>l.startsWith('核心偿付能力充足率(%)'));lines[i]=lines[i].replace('160.7','80.0');});
  const facts=parseCnInsuranceFacts(conflicting,{sourceId:'contradictory-cn',basis:'regulatory'});
  expect(facts.filter(f=>f.field==='insurance.context')).toHaveLength(2);
  expect(facts.filter(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2025).map(f=>f.value)).toEqual([1.607,0.8]);
  const increased=await chineseDocument();delete increased.pages['106'];updatePage(increased,'89',lines=>{const i=lines.findIndex(l=>l.startsWith('当期利率下降50个基点'));lines[i]=lines[i].replace('下降1.2个百分点','上升1.2个百分点');});
  expect(parseCnInsuranceFacts(increased,{sourceId:'increase-cn',basis:'regulatory'}).find(f=>f.field==='insurance.stress.interest_rate_minus_50bp.coreSolvency')?.value).toBe(1.2);
});
it('evaluates the real Chinese report’s repeated capital and pressure tables without treating SARMRA as a risk rating',async()=>{
  const {evaluateCompany}=await import('../../src/cn/screening.js');const {loadCnPolicy}=await import('../../src/policy/loader.js');
  const facts=parseCnInsuranceFacts(await chineseDocument(),{sourceId:'cn-original',basis:'regulatory'});
  const result=evaluateCompany({ticker:'SOURCE-VERIFIED-ISSUER',companyId:'SOURCE-VERIFIED-ISSUER',companyName:'Source report group',market:'CN',currency:'CNY',asOf:'2026-09-10',latestFiscalYear:2025,basis:'regulatory',method:{state:'applies',value:'insurance_group',coverage:{start:'2025-01-01',end:'2025-12-31'},evidence:[facts.find(f=>f.field==='insurance.context')!.id]},checks:{},facts},await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname),{evaluateAll:true});
  const flatten=(xs:typeof result.conditions):typeof result.conditions=>xs.flatMap(x=>[x,...flatten(x.components??[])]);const conditions=flatten(result.conditions);
  expect(conditions.find(r=>r.id==='F.risk.SOURCE-VERIFIED-ISSUER.coreSolvency')?.state).toBe('pass');
  expect(conditions.find(r=>r.id==='P2.stress')).toBeUndefined();
  expect(conditions.find(r=>r.id==='F.risk.SOURCE-VERIFIED-ISSUER.rating')).toMatchObject({state:'not_applicable',reason:'insurance_rating_not_verified'});
  expect(result.quality).toBe('unknown');
});

it('reads the 2023 original’s separate capital-regime note and direct stress ratios without converting them to percentage-point changes',async()=>{
  const report=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-group-solvency-cn-2023-pages.json',import.meta.url),'utf8'));
  const d:DisclosureText={entity:'SOURCE-VERIFIED-ISSUER',periodEnd:report.periodEnd,publishedAt:report.publishedAt,pages:report.pages};
  const facts=parseCnInsuranceFacts(d,{sourceId:'cn-2023-original',basis:'regulatory'});
  const context=JSON.parse(String(facts.find(f=>f.field==='insurance.context')?.value));
  expect(context).toMatchObject({reportYear:2023,accountingStandard:'regulatory-only'});
  const binding=context.stress.interest_rate_minus_50bp.coreSolvency;
  expect(binding.mode).toBe('scenario_ratio');
  const {insuranceContextSchema}=await import('../../src/shared/financial-model.js');
  expect(insuranceContextSchema.safeParse(context).success).toBe(true);
  expect(facts.find(f=>f.id===binding.factId)).toMatchObject({value:1.568,unit:'ratio',unitScale:0.01});
  expect(facts.find(f=>f.id===context.stress.equity_minus_10pct.comprehensiveSolvency.factId)?.value).toBe(2.039);
  expect(facts.find(f=>f.field==='insurance.context')?.evidence.map(e=>e.locator)).toEqual(['/pages/73/text','/pages/311/text']);
  updatePage(d,'311',lines=>{for(let i=0;i<lines.length;i++)lines[i]=lines[i].replace('2023年12月31日','2022年12月31日');});
  expect(parseCnInsuranceFacts(d,{sourceId:'wrong-regime-period',basis:'regulatory'}).some(f=>f.field==='insurance.context')).toBe(false);
});
it('reads all explicitly headed columns in the real three-year restated statement without shifting the optional note column',()=>{
  const report=serviceStatements.find(r=>r.periodEnd==='2024-12-31')!;
  const facts=parseCnInsuranceFacts(report,{sourceId:report.source.sha256,basis:'CN-consolidated-CAS'});
  expect(facts.filter(f=>f.field==='insurance.serviceRevenue').map(f=>[f.year,f.value])).toEqual([[2024,208161e6],[2023,212445e6],[2022,182578e6]]);
  const fields=['insurance.serviceRevenue','insurance.serviceExpense','insurance.reinsuranceAllocation','insurance.reinsuranceRecovery'];
  expect(fields.map(field=>facts.find(f=>f.field===field&&f.year===2023)?.value)).toEqual([212445e6,-150353e6,-4726e6,4438e6]);
  expect(facts.filter(f=>fields.includes(f.field))).toHaveLength(12);
});

it('does not extend the explicit 2023 restatement declaration to earlier or future three-year windows',()=>{
  for(const year of [2024,2026]) {
    const document=serviceStatement('601628');document.periodEnd=`${year}-12-31`;
    // Preserve the declaration while offering the extra year that previously
    // let the broad summary-year check extend its claimed coverage.
    const page=document.pages['8'];page.lines.push(`${year-2}年 ${year-1}年 ${year}年`);page.text=page.lines.join('\n');
    expect(parseCnInsuranceFacts(document,{sourceId:'outside-declared-window',basis:'CN-consolidated-CAS'}).some(f=>f.field==='insurance.accountingBasis')).toBe(false);
  }
});

async function actualInsuranceFixture(name:string):Promise<DisclosureText> {
  return JSON.parse(await fs.readFile(new URL(`../fixtures/${name}.json`,import.meta.url),'utf8'));
}
it('binds the direct issuer capital to precise percentages and only corroborates the rounded regulatory note',async()=>{
  const d=await actualInsuranceFixture('insurance-direct-capital-pages');
  const facts=parseCnInsuranceFacts(d,{sourceId:'saved-life-pdf',basis:'CAS'});
  expect(facts.filter(f=>f.field.startsWith('regulatory.actual.')).map(f=>[f.year,f.value,f.state])).toEqual([[2025,1.2877,'observed'],[2025,1.7401,'observed'],[2024,1.5334,'observed'],[2024,2.0776,'observed']]);
  const context=JSON.parse(String(facts.find(f=>f.field==='regulatory.context'&&f.year===2025)!.value));
  expect(context).toMatchObject({subject:'601628',scope:'legal_entity',reportYear:2025,position:'closing',regime:'C-ROSS-II'});
  expect(JSON.parse(String(facts.find(f=>f.field==='regulatory.context'&&f.year===2024)!.value))).toMatchObject({reportYear:2025,position:'opening'});
  expect(facts.some(f=>f.field==='insurance.context'||f.field==='insurance.riskRating')).toBe(false);
  expect(facts.filter(f=>f.field==='regulatory.context').every(f=>f.evidence.some(e=>e.locator==='/pages/152/text'))).toBe(true);
  expect(facts.filter(f=>f.field.startsWith('regulatory.actual.')).every(f=>f.evidence.length===1&&f.evidence[0].locator.startsWith('/pages/25/lines/'))).toBe(true);
});
it.each(['subject','period','percent-unit','definition','partial','duplicate','capital-conflict','rounded-conflict'] as const)('protects the direct insurer binding from %s',async mode=>{
  const d=await actualInsuranceFixture('insurance-direct-capital-pages');
  if(mode==='subject') updatePage(d,'152',ls=>ls.map(l=>l.replace('本公司已按照上述要求','本集团已按照上述要求')));
  if(mode==='period') d.periodEnd='2024-12-31';
  if(mode==='percent-unit') updatePage(d,'25',ls=>ls.map(l=>l.replaceAll('%','')));
  if(mode==='definition') updatePage(d,'25',ls=>ls.map(l=>l.replace('核心资本与最低资本','核心资本与实际资本')));
  if(mode==='partial') updatePage(d,'152',ls=>ls.filter(l=>!l.startsWith('最低资本')));
  if(mode==='duplicate') updatePage(d,'25',ls=>{ls.splice(11,0,ls[10]);});
  if(mode==='capital-conflict') updatePage(d,'152',ls=>ls.map(l=>l.replace('777,291','777,292')));
  if(mode==='rounded-conflict') updatePage(d,'152',ls=>ls.map(l=>l.replace('129%','130%')));
  const actual=parseCnInsuranceFacts(d,{sourceId:'bad',basis:'CAS'}).filter(f=>f.field.startsWith('regulatory.actual.'));
  if(mode.endsWith('conflict')) {expect(actual).toHaveLength(4);expect(actual.every(f=>f.state==='conflicting')).toBe(true);}
  else expect(actual).toEqual([]);
});
it('uses direct capital table semantics for a renamed issuer and subsequent report year',async()=>{
  const original=await actualInsuranceFixture('insurance-direct-capital-pages');
  const d:DisclosureText=JSON.parse(JSON.stringify(original).replaceAll('601628','SOURCE-ISSUER').replaceAll('2026','2027').replaceAll('2025','2026').replaceAll('2024','2025'));
  const facts=parseCnInsuranceFacts(d,{sourceId:'metamorphic',basis:'CAS'});
  expect(facts.some(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2026)).toBe(true);
  expect(facts.every(f=>f.entity.startsWith('SOURCE-ISSUER'))).toBe(true);
});
