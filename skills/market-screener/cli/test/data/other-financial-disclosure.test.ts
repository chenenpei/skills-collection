import fs from 'node:fs/promises';
import {expect,it} from 'vitest';
import {parseCnOtherFinancialFacts} from '../../src/cn/sources/financial-reports.js';
import { loadCnPolicy } from "../../src/policy/loader.js";
import { regulatoryContextSchema, regulatoryMetricDefinitions } from "../../src/shared/financial-model.js";
import {evaluateCompany} from '../../src/cn/screening.js';

const fixture=JSON.parse(await fs.readFile(new URL('../fixtures/shaanguotou-2025-trust-lines.json',import.meta.url),'utf8'));
const historicalFixture=JSON.parse(await fs.readFile(new URL('../fixtures/shaanguotou-historical-trust-lines.json',import.meta.url),'utf8'));
const options={sourceId:'trust-report',basis:'CN-consolidated-CAS'};

it('reads the issuer’s current trust capital ratios and explicitly disclosed regulatory minima',()=>{
  const facts=parseCnOtherFinancialFacts(fixture.document,options);
  expect(facts.find(f=>f.field==='regulatory.actual.trustRiskCoverage')).toMatchObject({year:2025,value:2.3507,unit:'ratio',period:{start:'2025-12-31',end:'2025-12-31'}});
  expect(facts.find(f=>f.field==='regulatory.requirement.trustRiskCoverage')?.value).toBe(1);
  expect(facts.find(f=>f.field==='regulatory.actual.netCapitalEquity')?.value).toBeCloseTo(0.6849,10);
  expect(facts.find(f=>f.field==='regulatory.requirement.netCapitalEquity')?.value).toBe(0.4);
});

it('routes the named licensed issuer from its own licence and current trustee business description',()=>{
  const facts=parseCnOtherFinancialFacts(fixture.document,options);
  expect(facts.find(f=>f.field==='business.licensedMethod')).toMatchObject({value:'trust',entity:'000563'});
  expect(facts.find(f=>f.field==='business.licenseNumber')?.value).toBe('K0068H261010001');
  expect(facts.find(f=>f.field==='business.licensedMethod')!.evidence.map(e=>e.locator)).toEqual(expect.arrayContaining(['/pages/5/text','/pages/13/text','/pages/112/text']));
  expect(facts.some(f=>f.field.startsWith('scope.'))).toBe(false);
});

it('binds proprietary trust capital to the complete cross-page client-asset exclusion and evaluates only the two disclosed ratios',async()=>{
  const facts=parseCnOtherFinancialFacts(fixture.document,options);
  expect(facts.find(f=>f.field==='business.trustAssetSeparation')).toMatchObject({value:'proprietary_excluding_trust_assets'});
  const contextFact=facts.find(f=>f.field==='regulatory.context');
  expect(contextFact).toBeDefined();
  const context=regulatoryContextSchema.parse(JSON.parse(String(contextFact!.value)));
  expect(context).toMatchObject({subject:'000563',scope:'legal_entity',assetScope:'proprietary_excluding_trust_assets',regime:'issuer-disclosed-trust-capital-requirements:2025',comparisonBasis:'report-specific-trust-capital',reportYear:2025,position:'closing'});
  for(const key of ['trustRiskCoverage','netCapitalEquity'] as const) {
    expect(context.metrics[key]).toMatchObject({definition:regulatoryMetricDefinitions[key],direction:'minimum',requirementKind:'regulatory'});
    expect(facts.some(f=>f.id===context.metrics[key].actualFactId)).toBe(true);
    expect(facts.some(f=>f.id===context.metrics[key].requirementFactId)).toBe(true);
  }
  expect(contextFact!.evidence.map(e=>e.locator)).toEqual(expect.arrayContaining(['/pages/5/text','/pages/13/text','/pages/80/text','/pages/112/text','/pages/132/text','/pages/133/text']));
  expect(contextFact!.reason).toContain('legislative_version_unidentified');
  expect(contextFact!.reason).toContain('cross_year_restatement_comparability_not_asserted');
  const policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);
  const result=evaluateCompany({ticker:'000563',companyId:'000563',companyName:'陕国投A',market:'CN',currency:'CNY',asOf:'2026-09-10',latestFiscalYear:2025,basis:options.basis,method:{state:'applies',value:'trust',coverage:{start:'2025-01-01',end:'2026-09-10'},evidence:['trust-report']},checks:{},facts},policy,{evaluateAll:true});
  expect(result.conditions.find(c=>c.id==='F.risk')).toMatchObject({state:'pass'});
  expect(result.conditions.find(c=>c.id==='F.scope')).toMatchObject({state:'not_applicable',reason:'company_level_method_scope'});
  expect(result.quality).not.toBe('pass');
});

it('reads the two historical PDF excerpts in their original report wording for a three-year trust risk series',()=>{
  const reports=historicalFixture.reports.map((report:{year:number;publishedAt:string;pages:Record<string,string[]>})=>({
    entity:'000563',periodEnd:`${report.year}-12-31`,publishedAt:report.publishedAt,
    pages:Object.fromEntries(Object.entries(report.pages).map(([page,lines])=>[page,{text:lines.join('\n'),lines}])),
  })).concat(fixture.document);
  const facts=reports.flatMap((document,index)=>parseCnOtherFinancialFacts(document,{...options,sourceId:`trust-${2023+index}`}));
  for(const year of [2023,2024,2025]) {
    const context=facts.find(f=>f.field==='regulatory.context'&&f.year===year);
    expect(context).toBeDefined();
    expect(JSON.parse(String(context!.value))).toMatchObject({reportYear:year,assetScope:'proprietary_excluding_trust_assets',regime:`issuer-disclosed-trust-capital-requirements:${year}`});
    expect(facts.filter(f=>f.field==='regulatory.actual.trustRiskCoverage'&&f.year===year)).toHaveLength(1);
    expect(facts.filter(f=>f.field==='regulatory.actual.netCapitalEquity'&&f.year===year)).toHaveLength(1);
  }
  expect(facts.filter(f=>f.field==='regulatory.actual.trustRiskCoverage').map(f=>f.value)).toEqual([2.3833,2.4066,2.3507]);
  expect(facts.filter(f=>f.field==='regulatory.actual.netCapitalEquity').map(f=>f.value)).toEqual([0.7513,0.7389,0.6849]);
});

function changePage(page:string,replace:(text:string)=>string) {
  const document=structuredClone(fixture.document);
  const text=replace(document.pages[page].text);
  document.pages[page]={text,lines:text.split('\n')};
  return document;
}

it('retains a disclosed minimum when the actual cell is blank without manufacturing an actual value or binding',()=>{
  const document=changePage('80',t=>t.replace('235.07%','—'));
  const facts=parseCnOtherFinancialFacts(document,options);
  expect(facts.some(f=>f.field==='regulatory.actual.trustRiskCoverage')).toBe(false);
  expect(facts.find(f=>f.field==='regulatory.requirement.trustRiskCoverage')?.value).toBe(1);
  const context=JSON.parse(String(facts.find(f=>f.field==='regulatory.context')!.value));
  expect(context.metrics.trustRiskCoverage).toBeUndefined();
});

it('rejects another issuer’s or a subsidiary’s licence and a licence issued after the year end',()=>{
  for(const replace of [
    (t:string)=>t.replace('股票代码“000563”','股票代码“999999”'),
    (t:string)=>t.replace('公司现持有','本公司的子公司现持有'),
    (t:string)=>t.replace('2025 \t年 \t10 \t月 \t31 \t日颁发','2026 年 10 月 31 日颁发'),
  ]) {
    const document=changePage('112',replace);
    expect(document.pages['112'].text).not.toBe(fixture.document.pages['112'].text);
    const facts=parseCnOtherFinancialFacts(document,options);
    expect(facts.some(f=>f.field==='business.licensedMethod' || f.field==='regulatory.context')).toBe(false);
    expect(facts.find(f=>f.field==='regulatory.actual.trustRiskCoverage')?.value).toBe(2.3507);
  }
});

it('does not bind trust-client, group or foreign issuer tables to the issuer’s proprietary regulatory scope',()=>{
  for(const replace of [
    (t:string)=>t.replace('项 \t目（信托公司）','项 目（信托财产）'),
    (t:string)=>t.replace('项 \t目（信托公司）','项 目（集团合并）'),
    (t:string)=>t.replace('陕西省国际信托股份有限公司','其他信托股份有限公司'),
  ]) {
    const document=changePage('80',replace);
    expect(document.pages['80'].text).not.toBe(fixture.document.pages['80'].text);
    const facts=parseCnOtherFinancialFacts(document,options);
    expect(facts.some(f=>f.field.startsWith('regulatory.'))).toBe(false);
    expect(facts.find(f=>f.field==='business.licensedMethod')?.value).toBe('trust');
  }
});

it('preserves raw capital observations but withholds proprietary context without the continuous explicit trust-asset exclusion',()=>{
  const missingPage=structuredClone(fixture.document);delete missingPage.pages['133'];
  const gap=structuredClone(fixture.document);gap.pages['134']=gap.pages['133'];delete gap.pages['133'];
  const missingAccounting=changePage('132',t=>t.replace('公司将固','某子公司将固'));
  for(const document of [missingPage,gap,missingAccounting,changePage('133',t=>t.replace('损益不列入本财务报表。','损益列入本财务报表。')),changePage('133',t=>t.replace('2025','2024'))]) {
    const facts=parseCnOtherFinancialFacts(document,options);
    expect(facts.some(f=>f.field==='regulatory.context' || f.field==='business.trustAssetSeparation')).toBe(false);
    expect(facts.find(f=>f.field==='business.licensedMethod')?.value).toBe('trust');
    expect(facts.find(f=>f.field==='regulatory.actual.trustRiskCoverage')?.value).toBe(2.3507);
  }
});

it('keeps missing minima unknown and never substitutes a warning column or an adjacent legislative reference',()=>{
  const document=changePage('80',t=>t.replace('≥100%','—'));
  const facts=parseCnOtherFinancialFacts(document,options);
  expect(facts.find(f=>f.field==='regulatory.actual.trustRiskCoverage')?.value).toBe(2.3507);
  expect(facts.some(f=>f.field==='regulatory.requirement.trustRiskCoverage')).toBe(false);
  const context=JSON.parse(String(facts.find(f=>f.field==='regulatory.context')!.value));
  expect(context.metrics.trustRiskCoverage.requirementFactId).toBeUndefined();
  expect(context.regime).not.toContain('2007');
  const warning=changePage('80',t=>t.replace('监管标准','预警标准'));
  expect(parseCnOtherFinancialFacts(warning,options).some(f=>f.field.startsWith('regulatory.'))).toBe(false);
});

it('binds source paths to original page content and generalizes the issuer identity without hardcoded names or tickers',()=>{
  const document=structuredClone(fixture.document);
  document.entity='600999';
  for(const page of Object.values(document.pages) as {text:string;lines:string[]}[]) {
    page.text=page.text.replaceAll('000563','600999').replaceAll('陕西省国际信托股份有限公司','测试信托股份有限公司');
    page.lines=page.text.split('\n');
  }
  const facts=parseCnOtherFinancialFacts(document,options);
  expect(facts.find(f=>f.field==='regulatory.actual.trustRiskCoverage')).toMatchObject({entity:'600999',year:2025,value:2.3507});
  expect(new Set(facts.map(f=>f.id)).size).toBe(facts.length);
  expect(facts.every(f=>f.entity==='600999' && f.year===2025)).toBe(true);
  for(const f of facts) for(const ref of f.evidence) {
    const match=ref.locator.match(/^\/pages\/(\d+)\/(?:lines\/(\d+)|text)$/)!;
    expect(ref.raw).toBe(match[2]===undefined?document.pages[match[1]].text:document.pages[match[1]].lines[Number(match[2])]);
  }
  expect(parseCnOtherFinancialFacts({...document,periodEnd:'2025-06-30'},options)).toEqual([]);
});
