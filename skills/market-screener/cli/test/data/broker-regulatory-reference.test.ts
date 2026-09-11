import { expect,it } from 'vitest';
import fs from 'node:fs/promises';
import { applyBrokerRegulatoryReference, brokerRegulatoryReferenceSourceId, ensureBrokerRegulatoryReferenceSource } from '../../src/cn/sources/financial-reports.js';
import type { CompanyFacts, FinancialFact } from '../../src/shared/financial-model.js';

const document=JSON.parse(await fs.readFile(new URL('../../src/cn/sources/broker-regulations.json',import.meta.url),'utf8'));
const base=(companyId:string):CompanyFacts=>({ticker:companyId,companyId,companyName:companyId,market:'CN',currency:'CNY',asOf:'2026-09-10',latestFiscalYear:2025,basis:'test',method:{state:'unresolved',evidence:[]},checks:{},facts:[]});
const names=['riskCoverage','capitalLeverage','lcr','nsfr'] as const;
function context(company:CompanyFacts,reportYear=2025,position:'closing'|'opening'='closing',regime='CSRC-2024-13') {
  const year=position==='opening'?reportYear-1:reportYear,date=`${year}-12-31`,metrics:Record<string,{definition:string;direction:'minimum';actualFactId:string}>={};
  const facts:FinancialFact[]=[];
  for(const name of names) {
    const id=`${company.companyId}:${reportYear}:${position}:${name}`;
    metrics[name]={definition:document.references[0].metrics[name].definition,direction:'minimum',actualFactId:id};
    facts.push({id,field:`regulatory.actual.${name}`,entity:company.companyId,year,period:{start:date,end:date},publishedAt:'2026-03-01',basis:company.basis,unit:'ratio',state:'observed',value:2,evidence:[{sourceId:'report',locator:`/${id}`,raw:2}]});
  }
  const value=JSON.stringify({subject:company.companyId,scope:'legal_entity',regime,reportYear,position,comparisonBasis:regime,liquidityMetrics:['lcr','nsfr'],metrics});
  facts.push({id:`${company.companyId}:${reportYear}:${position}:context`,field:'regulatory.context',entity:company.companyId,year,period:{start:date,end:date},publishedAt:'2026-03-01',basis:company.basis,unit:'text',state:'observed',value,evidence:[{sourceId:'report',locator:`/${company.companyId}/context`,raw:value}]});
  return facts;
}

it('reuses one developer-reviewed broker reference for closing and restated opening contexts',async()=>{
  const first=base('BROKER-A'),second=base('BROKER-B'),facts=new Map<string,FinancialFact>([...context(first),...context(first,2025,'opening'),...context(second)].map(f=>[f.id,f]));
  const additions=await applyBrokerRegulatoryReference(first,facts,document);
  expect(additions.filter(f=>f.field.startsWith('regulatory.requirement.'))).toHaveLength(8);
  expect(additions.filter(f=>f.field.startsWith('regulatory.requirement.')).every(f=>f.evidence[0]?.sourceId===brokerRegulatoryReferenceSourceId)).toBe(true);
  expect(additions.find(f=>f.field==='regulatory.requirement.riskCoverage'&&f.year===2025)?.value).toBe(1);
  expect(additions.find(f=>f.field==='regulatory.requirement.capitalLeverage'&&f.year===2024)?.value).toBe(.08);
  expect(additions.filter(f=>f.field==='regulatory.context').every(f=>Object.values(JSON.parse(String(f.value)).metrics).every((metric:any)=>metric.requirementFactId))).toBe(true);
  expect(await applyBrokerRegulatoryReference(second,facts,document)).toHaveLength(5);
});

it('does not inject for a foreign subject, unknown regime, pre-reference period, or future period',async()=>{
  const company=base('BROKER-A');
  for(const mutate of [
    (facts:FinancialFact[])=>{const context=facts.at(-1)!;const value=JSON.parse(String(context.value));value.subject='BROKER-B';context.value=JSON.stringify(value);},
    (facts:FinancialFact[])=>{const context=facts.at(-1)!;const value=JSON.parse(String(context.value));value.regime='old-regime';value.comparisonBasis='old-regime';context.value=JSON.stringify(value);},
    (facts:FinancialFact[])=>{const context=facts.at(-1)!;const value=JSON.parse(String(context.value));value.reportYear=2024;context.value=JSON.stringify(value);},
    (facts:FinancialFact[])=>{const context=facts.at(-1)!;const value=JSON.parse(String(context.value));value.reportYear=2027;context.value=JSON.stringify(value);},
  ]) {
    const facts=context(company);mutate(facts);
    expect(await applyBrokerRegulatoryReference(company,new Map(facts.map(f=>[f.id,f])),document)).toEqual([]);
  }
});

it('keeps a disclosed metric requirement and binds every other independently verified metric',()=>{
  const company=base('BROKER-A'),facts=context(company),original=facts.at(-1)!;
  const value=JSON.parse(String(original.value));value.metrics.riskCoverage.requirementFactId='individual-requirement';delete value.metrics.lcr;original.value=JSON.stringify(value);
  const additions=applyBrokerRegulatoryReference(company,new Map(facts.map(f=>[f.id,f])),document);
  expect(additions.filter(f=>f.field.startsWith('regulatory.requirement.')).map(f=>f.field)).toEqual(['regulatory.requirement.capitalLeverage','regulatory.requirement.nsfr']);
  const amended=JSON.parse(String(additions.find(f=>f.field==='regulatory.context')?.value));
  expect(amended.metrics.riskCoverage.requirementFactId).toBe('individual-requirement');
  expect(amended.metrics.lcr).toBeUndefined();
});

it('registers the immutable reference source for archive and offline replay',async()=>{
  const input:any={schemaVersion:1,sources:[],companies:[]};
  await ensureBrokerRegulatoryReferenceSource(input);
  expect(input.sources).toHaveLength(1);
  expect(input.sources[0]).toMatchObject({id:brokerRegulatoryReferenceSourceId,mapping:'regulatory-reference-v1',url:'https://www.csrc.gov.cn/csrc/c106256/c1653957/content.shtml'});
  await ensureBrokerRegulatoryReferenceSource(input);
  expect(input.sources).toHaveLength(1);
});
