import fs from 'node:fs/promises';
import {parseCnInsuranceFacts} from '../../src/cn/sources/financial-reports.js';
import { beforeAll, expect, it } from 'vitest';
import { evaluateCompany } from '../../src/cn/screening.js';
import { loadCnPolicy, type CnPolicy } from '../../src/policy/loader.js';
import type { CompanyFacts, ConditionResult, FinancialFact } from '../../src/shared/financial-model.js';
let policy:CnPolicy;
beforeAll(async()=>{policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);});
const coverage={start:'2021-01-01',end:'2026-09-09'};
function fact(c:CompanyFacts,field:string,year:number,value:number|string,unit='CNY',subject=c.companyId,instant=false) {
  const f:FinancialFact={id:`${subject}:${field}:${year}`,field,year,entity:subject,period:{start:`${year}-${instant?'12-31':'01-01'}`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit,state:'observed',value,evidence:[{sourceId:'synthetic',locator:`/${subject}/${field}/${year}`,raw:value}]};
  c.facts.push(f);return f.id;
}
function insurer(kind:'pc_insurance'|'life_insurance'|'insurance_group'='pc_insurance') {
  const c:CompanyFacts={ticker:'INS',companyId:'INS',companyName:'Synthetic insurer',market:'CN',currency:'CNY',basis:'CAS25-2023',asOf:'2026-09-09',latestFiscalYear:2025,method:{value:kind,state:'applies',coverage,evidence:['issuer-license']},checks:{earnings:{state:'applies',coverage,evidence:['earnings-basis']}},facts:[]};
  for(const y of [2021,2022,2023,2024,2025]) {const id=fact(c,'parentProfit',y,10);if(y<2023)c.facts.find(f=>f.id===id)!.basis='old-CAS25';}
  for(const y of [2023,2024,2025]) {fact(c,'weightedRoe',y,0.2,'ratio');fact(c,'ordinaryProfit',y,10);context(c,y,kind==='pc_insurance'?'pc':kind==='life_insurance'?'life':'group');}
  return c;
}
function context(c:CompanyFacts,year:number,kind:'pc'|'life'|'group',extra:Record<string,unknown>={}) {
  const accountingBasisFactId=fact(c,'insurance.accountingBasis',year,'CAS25-2023','text');
  return fact(c,'insurance.context',year,JSON.stringify({subject:c.companyId,scope:kind==='group'?'group':'legal_entity',kind,reportYear:year,accountingStandard:'CAS25-2023',accountingBasisFactId,comparisonBasis:'insurance-after-reinsurance',operating:{},...extra}),'text');
}
function changeContext(c:CompanyFacts,year:number,change:(v:any)=>void) {const f=c.facts.find(f=>f.field==='insurance.context'&&f.year===year)!;const v=JSON.parse(String(f.value));change(v);f.value=JSON.stringify(v);f.evidence[0].raw=f.value;}
function results(c:CompanyFacts) {return evaluateCompany(c,policy,{evaluateAll:true});}
function cond(c:CompanyFacts,id:string):ConditionResult {const search=(xs:ConditionResult[]):ConditionResult|undefined=>{for(const x of xs){if(x.id===id)return x;const hit=search(x.components??[]);if(hit)return hit;}};return search(results(c).conditions)!;}
it('uses three comparable insurance return years while retaining five reported profit years across the accounting break',()=>{
  const c=insurer();
  expect(cond(c,'N1').state).toBe('pass');expect(cond(c,'N2').state).toBe('pass');
  expect(cond(c,'N2').factIds).toContain('INS:insurance.accountingBasis:2023');
  expect(cond(c,'N2').formula).toContain('3y');
  expect(results(c).conditions.some(r=>r.id==='N3')).toBe(false);
  c.facts=c.facts.filter(f=>!(f.field==='parentProfit'&&f.year===2021));
  expect(cond(c,'N1').state).toBe('unknown');
  c.facts=c.facts.filter(f=>!(f.field==='insurance.context'&&f.year===2023));
  expect(cond(c,'N2').state).toBe('pass');
});
it('keeps operating and regulatory contexts independent from a comparable accounting return window',()=>{
  const c=insurer();for(const y of [2023,2024,2025])solvency(c,y);
  for(const y of [2023,2024,2025])operating(c,y,{underwritingResult:10,combinedRatio:0.9,combinedRatioDenominator:100});
  for(const y of [2023,2024,2025])changeContext(c,y,v=>{delete v.accountingBasisFactId;});
  expect(cond(c,'N2').state).toBe('pass');expect(cond(c,'P1').state).toBe('pass');
  expect(cond(c,'F.operating').state).toBe('unknown');
  expect(cond(c,'F.risk.INS.coreSolvency').state).toBe('pass');
});
function operating(c:CompanyFacts,year:number,values:Record<string,number>,denominatorDefinition='net-earned-premium') {
  const definitions:Record<string,string>={underwritingResult:'insurance-underwriting-result',combinedRatio:'insurance-combined-cost/defined-denominator',combinedRatioDenominator:'combined-ratio-defined-denominator',serviceResult:'insurance-service-result-after-reinsurance'};
  changeContext(c,year,v=>{v.denominatorDefinition=denominatorDefinition;for(const [metric,value]of Object.entries(values)){v.operating[metric]={factId:fact(c,`insurance.${metric}`,year,value,metric==='combinedRatio'?'ratio':c.currency),definition:definitions[metric]};}});
}
it('weights property insurance cost ratios by the disclosed matching denominator and refuses unlike definitions',()=>{
  const c=insurer();
  operating(c,2023,{underwritingResult:10,combinedRatio:0.9,combinedRatioDenominator:100});
  operating(c,2024,{underwritingResult:10,combinedRatio:1.1,combinedRatioDenominator:900});
  operating(c,2025,{underwritingResult:10,combinedRatio:1,combinedRatioDenominator:100});
  expect(cond(c,'F.operating.INS.combinedRatio')).toMatchObject({state:'fail',value:1.0727272727272728});
  expect(cond(c,'F.operating.INS.underwriting').state).toBe('pass');
  changeContext(c,2024,v=>v.denominatorDefinition='insurance-service-revenue');
  expect(cond(c,'F.operating.INS.combinedRatio').state).toBe('unknown');
});
it('uses life insurance service results without inventing a cost ratio requirement',()=>{
  const c=insurer('life_insurance');
  operating(c,2023,{serviceResult:-3});operating(c,2024,{serviceResult:4});operating(c,2025,{serviceResult:2});
  expect(cond(c,'F.operating').state).toBe('pass');
  c.facts.find(f=>f.field==='insurance.serviceResult'&&f.year===2024)!.value=-1;
  expect(cond(c,'F.operating').state).toBe('fail');
  c.facts=c.facts.filter(f=>!(f.field==='insurance.serviceResult'&&f.year===2024));
  expect(cond(c,'F.operating').state).toBe('unknown');
});
function solvency(c:CompanyFacts,year:number,core=1.3,comprehensive=1.8,grade='B') {
  const metrics:Record<string,unknown>={};
  for(const [name,actual,requirement]of [['coreSolvency',core,0.5],['comprehensiveSolvency',comprehensive,1]] as const) {
    metrics[name]={definition:name==='coreSolvency'?'core-capital/minimum-capital':'actual-capital/minimum-capital',direction:'minimum',actualFactId:fact(c,`regulatory.actual.${name}`,year,actual,'ratio',c.companyId,true),requirementFactId:fact(c,`regulatory.requirement.${name}`,year,requirement,'ratio',c.companyId,true)};
  }
  const id=fact(c,'regulatory.context',year,JSON.stringify({subject:c.companyId,scope:'legal_entity',regime:'C-ROSS-II',reportYear:year,position:'closing',comparisonBasis:'C-ROSS-II',liquidityMetrics:[],metrics}),'text',c.companyId,true);
  const rating=fact(c,'insurance.riskRating',year,grade,'text',c.companyId,true);
  changeContext(c,year,v=>{v.regulatoryContextFactId=id;v.rating={factId:rating,system:'solvency_risk_comprehensive',regime:'C-ROSS-II',quarter:`${year}Q4`};});
}
it('checks insurance solvency against both screening floors and applicable requirements, with the correct risk rating system',()=>{
  const c=insurer();solvency(c,2025);
  expect(cond(c,'F.risk').state).toBe('pass');
  c.facts.find(f=>f.field==='regulatory.requirement.coreSolvency')!.value=1.4;
  expect(cond(c,'F.risk').state).toBe('fail');
  c.facts.find(f=>f.field==='regulatory.requirement.coreSolvency')!.value=0.5;
  changeContext(c,2025,v=>v.rating.system='information_disclosure');
  expect(cond(c,'F.risk').state).toBe('unknown');
  changeContext(c,2025,v=>v.rating.system='solvency_risk_comprehensive');
  c.facts.find(f=>f.field==='insurance.riskRating')!.value='C';
  expect(cond(c,'F.risk').state).toBe('fail');
  expect(results(c).quality).not.toBe('pass');
});
function stress(c:CompanyFacts,scenario:string,coreChange:number,comprehensiveChange:number) {
  changeContext(c,2025,v=>{
    v.stress??={};v.stress[scenario]={};
    for(const [metric,change] of [['coreSolvency',coreChange],['comprehensiveSolvency',comprehensiveChange]] as const) v.stress[scenario][metric]={mode:'percentage_point_change',factId:fact(c,`insurance.stress.${scenario}.${metric}`,2025,change,'percentage_points',c.companyId,true),baseFactId:`${c.companyId}:regulatory.actual.${metric}:2025`};
  });
}
it('does not shorten the insurance return window or combine one-year reports with different accounting bases',()=>{
  const c=insurer();c.facts=c.facts.filter(f=>!(f.field==='weightedRoe'&&f.year===2023));
  expect(cond(c,'N2').state).toBe('unknown');
  fact(c,'weightedRoe',2023,0.2,'ratio');
  changeContext(c,2023,v=>v.accountingStandard='old-CAS25');
  expect(cond(c,'N2').state).toBe('unknown');expect(cond(c,'P1').state).toBe('unknown');
});
it('checks only group capital while retaining unassessed subsidiary disclosures',()=>{
  const c=insurer('insurance_group');for(const y of [2023,2024,2025])solvency(c,y);
  for(const f of c.facts.filter(f=>f.field==='regulatory.context')){const v=JSON.parse(String(f.value));v.scope='regulatory_consolidated';f.value=JSON.stringify(v);}
  const child=insurer('life_insurance');child.companyId='LIFE';for(const f of child.facts){f.entity='LIFE';f.id=`LIFE:${f.id}`;if(f.field==='insurance.context'){const v=JSON.parse(String(f.value));v.subject='LIFE';f.value=JSON.stringify(v);}}
  c.facts.push(...child.facts);
  expect(cond(c,'F.risk.INS').state).toBe('pass');
  expect(cond(c,'F.risk.LIFE')).toBeUndefined();
  expect(cond(c,'F.scope').state).toBe('not_applicable');
  expect(results(c).observations?.some(o=>o.id==='O.subsidiaries')).toBe(true);
  expect(results(c).quality).toBe('unknown');
});
it('excludes a current reliable downgrade even when the annual context names an older favourable rating',()=>{
  const c=insurer();solvency(c,2025);
  const id=fact(c,'insurance.riskRating',2026,'C','text');const f=c.facts.find(f=>f.id===id)!;
  f.period={start:'2026-04-01',end:'2026-06-30'};f.publishedAt='2026-08-01';
  expect(cond(c,'F.risk').state).toBe('fail');
  changeContext(c,2025,v=>{v.rating.factId=id;v.rating.quarter='2026Q2';});
  expect(cond(c,'F.risk').state).toBe('fail');
});
it('marks a missing rating unverified without treating it as a rating pass or blocking proven capital',()=>{
  const c=insurer();solvency(c,2025);
  c.facts=c.facts.filter(f=>f.field!=='insurance.riskRating');
  expect(cond(c,'F.risk.INS.rating')).toMatchObject({state:'not_applicable',reason:'insurance_rating_not_verified'});
  expect(cond(c,'F.risk.INS.rating').factIds).toContain('INS:insurance.context:2025');
  expect(cond(c,'F.risk')).toBeTruthy();
  expect(cond(c,'F.risk').state).toBe('pass');
});
it('evaluates the current rating independently when capital context is missing, but leaves capital unknown',()=>{
  const c=insurer();solvency(c,2025,1.3,1.8,'C');
  c.facts=c.facts.filter(f=>f.field!=='regulatory.context');
  expect(cond(c,'F.risk.INS.capital')).toMatchObject({state:'unknown',reason:'insurance_solvency_context_unresolved:INS:2025'});
  expect(cond(c,'F.risk.INS.rating')).toMatchObject({state:'fail',reason:'solvency_risk_comprehensive_rating'});
  expect(cond(c,'F.risk').state).toBe('fail');
});
it('does not let a malformed or conflicting current rating become a reliable grade',()=>{
  const c=insurer();solvency(c,2025);
  const original=c.facts.find(f=>f.field==='insurance.riskRating')!;
  c.facts.push({...original,id:'conflicting-current-rating',value:'C'});
  expect(cond(c,'F.risk.INS.rating').state).toBe('unknown');
  c.facts=c.facts.filter(f=>f.id!=='conflicting-current-rating');
  original.value='not-a-grade';
  expect(cond(c,'F.risk.INS.rating').state).toBe('unknown');
});
it('merges duplicate identical rating observations, but keeps an adverse rating with an unclear period unresolved',()=>{
  const c=insurer();solvency(c,2025);
  const original=c.facts.find(f=>f.field==='insurance.riskRating')!;
  c.facts.push({...original,id:'duplicate-current-rating'});
  expect(cond(c,'F.risk.INS.rating')).toMatchObject({state:'pass',factIds:expect.arrayContaining([original.id,'duplicate-current-rating'])});
  const id=fact(c,'insurance.riskRating',2026,'C','text'),adverse=c.facts.find(f=>f.id===id)!;
  adverse.period={start:'2026-04-01',end:'2026-07-01'};adverse.publishedAt='2026-08-01';
  expect(cond(c,'F.risk.INS.rating').state).toBe('unknown');
});
it('treats an observed blank grade as missing unless other rating evidence is adverse or conflicting',()=>{
  const c=insurer();solvency(c,2025);
  const rating=c.facts.find(f=>f.field==='insurance.riskRating')!;
  (rating as FinancialFact & {value:undefined}).value=undefined;
  expect(cond(c,'F.risk.INS.rating')).toMatchObject({state:'not_applicable',reason:'insurance_rating_not_verified'});
  rating.value='C';
  const duplicate={...rating,id:'conflicting-grade',value:'B'};c.facts.push(duplicate);
  expect(cond(c,'F.risk.INS.rating').state).toBe('unknown');
});
it('does not apply ratings outside the current as-of boundary and does not require them in historical capital checks',()=>{
  const c=insurer();for(const y of [2023,2024,2025])solvency(c,y);
  c.facts=c.facts.filter(f=>f.field!=='insurance.riskRating'||f.year===2025);
  const future=fact(c,'insurance.riskRating',2026,'C','text');
  const f=c.facts.find(f=>f.id===future)!;f.period={start:'2026-10-01',end:'2026-12-31'};f.publishedAt='2026-09-01';
  expect(cond(c,'F.risk.INS.rating').state).toBe('pass');
  expect(cond(c,'P2.2023.INS.rating')).toBeUndefined();
  expect(cond(c,'P2').state).toBe('pass');
});
it('can qualify an insurer from sufficient required facts without an additional audited-report package gate',()=>{
  const c=insurer();
  for(const y of [2023,2024,2025]) {
    operating(c,y,{underwritingResult:10,combinedRatio:0.9,combinedRatioDenominator:100});
    solvency(c,y);
  }
  const result=evaluateCompany(c,policy);
  expect(result.quality).toBe('unknown');
  expect(result.conditions.find(r=>r.id==='F.methodValidation')?.state).toBe('unknown');
  expect(result.conditions.find(r=>r.id==='P0')?.state).toBe('unknown');
  // No price or stress facts: basic qualification must not imply a research opportunity.
  expect(result.priority).toBe('unknown');
});
it.each([
  ['parentProfit',2021],
  ['weightedRoe',2023],
  ['insurance.accountingBasis',2024],
  ['insurance.serviceResult',2024],
  ['regulatory.actual.coreSolvency',2025],
  ['insurance.riskRating',2025],
] as const)('keeps a sufficient life insurer unqualified when the necessary %s for %s is missing', (field,year)=>{
  const c=insurer('life_insurance');
  for(const y of [2023,2024,2025]) {operating(c,y,{serviceResult:10});solvency(c,y);}
  expect(evaluateCompany(c,policy,{evaluateAll:true}).conditions.filter(r=>r.layer==='quality'&&r.id!=='F.methodValidation').every(r=>['pass','not_applicable'].includes(r.state))).toBe(true);
  c.facts=c.facts.filter(f=>f.field!==field||f.year!==year);
  const result=evaluateCompany(c,policy);
  expect(result.quality).toBe('unknown');
  expect(result.conditions.some(r=>r.layer==='quality'&&r.id!=='F.methodValidation'&&r.state==='unknown')).toBe(true);
  expect(result.conditions.find(r=>r.id==='P0')?.state).toBe('unknown');
});
it('retains conflicting insurance operating evidence while rejecting an independent proven risk failure',()=>{
  const c=insurer('life_insurance');
  for(const y of [2023,2024,2025]) {operating(c,y,{serviceResult:10});solvency(c,y);}
  const original=c.facts.find(f=>f.field==='insurance.serviceResult'&&f.year===2024)!;
  c.facts.push({...original,id:'contradictory-service-result',value:-100});
  expect(evaluateCompany(c,policy).quality).toBe('unknown');
  expect(cond(c,'F.operating').factIds).toContain('contradictory-service-result');
  c.facts.find(f=>f.field==='regulatory.actual.coreSolvency'&&f.year===2025)!.value=0.4;
  expect(evaluateCompany(c,policy).quality).toBe('fail');
  expect(cond(c,'F.operating').state).toBe('unknown');
  expect(cond(c,'F.risk').state).toBe('fail');
});
it('uses sourced annual return bindings together with insurance accounting comparability without a manual earnings review',()=>{
  const c=insurer('life_insurance');delete c.checks.earnings;
  for(const y of [2023,2024,2025]) {
    operating(c,y,{serviceResult:10});solvency(c,y);
    const adjusted=fact(c,'adjustedWeightedRoe',y,0.19,'ratio');
    fact(c,'earnings.returnContext',y,JSON.stringify({accountingStandard:'CAS',shareholderScope:'ordinary',reportYear:y,weightedRoeFactId:`INS:weightedRoe:${y}`,adjustedWeightedRoeFactId:adjusted}),'text');
  }
  expect(evaluateCompany(c,policy,{evaluateAll:true}).conditions.filter(r=>r.layer==='quality'&&r.id!=='F.methodValidation').every(r=>['pass','not_applicable'].includes(r.state))).toBe(true);
  expect(cond(c,'P1').state).toBe('pass');
  expect(cond(c,'N2').factIds).toContain('INS:earnings.returnContext:2023');
  expect(cond(c,'N2').factIds).toContain('INS:insurance.accountingBasis:2023');
  // A separately observed earnings conflict retains precedence over both contexts.
  c.checks.earnings={state:'unresolved',coverage,evidence:['known-earnings-conflict']};
  expect(cond(c,'N2').state).toBe('unknown');expect(cond(c,'P1').state).toBe('unknown');
  delete c.checks.earnings;
  changeContext(c,2023,v=>{delete v.accountingBasisFactId;});
  expect(cond(c,'N2').state).toBe('pass');expect(cond(c,'P1').state).toBe('pass');
});
it('does not combine CAS annual return bindings with an IFRS17 insurance accounting window',()=>{
  const c=insurer('life_insurance');delete c.checks.earnings;
  for(const y of [2023,2024,2025]) {
    operating(c,y,{serviceResult:10});solvency(c,y);
    const adjusted=fact(c,'adjustedWeightedRoe',y,0.19,'ratio');
    fact(c,'earnings.returnContext',y,JSON.stringify({accountingStandard:'CAS',shareholderScope:'ordinary',reportYear:y,weightedRoeFactId:`INS:weightedRoe:${y}`,adjustedWeightedRoeFactId:adjusted}),'text');
    changeContext(c,y,v=>{v.accountingStandard='IFRS17';});
    c.facts.find(f=>f.field==='insurance.accountingBasis'&&f.year===y)!.value='IFRS17';
  }
  expect(cond(c,'N2').state).toBe('unknown');
  expect(cond(c,'P1').state).toBe('unknown');
});

function lifeStatementCompany() {
  const c=insurer('life_insurance');c.facts=c.facts.filter(f=>f.field!=='insurance.context');
  for(const year of [2023,2024,2025]) for(const [field,value] of [['serviceRevenue',100],['serviceExpense',-70],['reinsuranceAllocation',-5],['reinsuranceRecovery',3]] as const) fact(c,`insurance.${field}`,year,value);
  return c;
}
it('derives signed service results with source operands while leaving legal solvency scope unresolved',()=>{
  const c=lifeStatementCompany(),r=results(c);
  expect(cond(c,'N2')).toMatchObject({state:'pass',factIds:expect.arrayContaining(['INS:insurance.accountingBasis:2023','INS:insurance.accountingBasis:2024','INS:insurance.accountingBasis:2025'])});
  expect(cond(c,'P1').factIds).toContain('INS:insurance.accountingBasis:2023');
  expect(cond(c,'P3').factIds).toContain('INS:insurance.accountingBasis:2023');
  expect(cond(c,'F.operating')).toMatchObject({state:'pass'});
  expect(cond(c,'F.operating.INS.serviceTotal')).toMatchObject({value:84});
  expect(r.derivedFacts?.find(f=>f.field==='insurance.serviceResult'&&f.year===2025)).toMatchObject({state:'derived',value:28,derivation:{inputs:expect.arrayContaining(['INS:insurance.serviceRevenue:2025','INS:insurance.reinsuranceRecovery:2025'])}});
  expect(cond(c,'F.risk').state).toBe('unknown');
  expect(r.quality).toBe('unknown');
});
it('does not ignore existing insurance contexts that contradict their annual or comparable basis',()=>{
  for(const change of [
    (c:CompanyFacts)=>changeContext(c,2024,v=>{v.accountingStandard='old-CAS25';}),
    (c:CompanyFacts)=>changeContext(c,2024,v=>{v.comparisonBasis='insurance-before-reinsurance';}),
    (c:CompanyFacts)=>changeContext(c,2024,v=>{v.kind='pc';}),
  ]) {
    const c=insurer('life_insurance');change(c);
    expect(cond(c,'N2')).toMatchObject({state:'unknown',factIds:expect.arrayContaining(['INS:insurance.accountingBasis:2024','INS:insurance.context:2024'])});
    expect(cond(c,'P1').state).toBe('unknown');
    expect(cond(c,'P3').state).toBe('unknown');
  }
});
it('does not bypass a conflicting context, missing operand, unlike accounting basis or unsigned expense',()=>{
  for(const change of [
    (c:CompanyFacts)=>{fact(c,'insurance.context',2024,'invalid','text');},
    (c:CompanyFacts)=>{c.facts=c.facts.filter(f=>f.field!=='insurance.reinsuranceRecovery'||f.year!==2024);},
    (c:CompanyFacts)=>{c.facts.find(f=>f.field==='insurance.accountingBasis'&&f.year===2024)!.value='old-CAS25';},
    (c:CompanyFacts)=>{c.facts.find(f=>f.field==='insurance.serviceExpense'&&f.year===2024)!.value=70;},
    (c:CompanyFacts)=>{c.facts.find(f=>f.field==='insurance.reinsuranceRecovery'&&f.year===2024)!.evidence[0].sourceId='unrelated';},
    (c:CompanyFacts)=>{fact(c,'insurance.serviceResult',2024,999);},
    (c:CompanyFacts)=>{c.facts.find(f=>f.field==='insurance.reinsuranceRecovery'&&f.year===2024)!.value=-3;},
  ]) {const c=lifeStatementCompany();change(c);expect(cond(c,'F.operating').state).toBe('unknown');}
  const c=lifeStatementCompany();c.method.value='insurance_group';expect(cond(c,'F.operating').state).toBe('not_applicable');
});

it('retains an undated adverse observation instead of treating malformed dates as future data',()=>{
  for(const field of ['periodEnd','publishedAt']) {
    const c=insurer('life_insurance');solvency(c,2025);
    const id=fact(c,'insurance.riskRating',2024,'C','text',c.companyId,true);
    const bad=c.facts.find(f=>f.id===id)!;
    if(field==='periodEnd')bad.period.end='unknown';else bad.publishedAt='unknown';
    expect(cond(c,'F.risk.INS.rating')).toMatchObject({state:'unknown',factIds:expect.arrayContaining([id])});
  }
});

function financialResult(c:CompanyFacts,methods:Array<'bank'|'broker'|'pc_insurance'|'life_insurance'|'insurance_group'>) {
  const financial={...policy.strategies!.financial,methods};
  return evaluateCompany(c,{...policy,strategies:{financial}},{strategy:'financial'});
}
function strategyCondition(c:CompanyFacts,id:string,methods:Array<'bank'|'broker'|'pc_insurance'|'life_insurance'|'insurance_group'>):ConditionResult {
  const search=(xs:ConditionResult[]):ConditionResult|undefined=>{for(const x of xs){if(x.id===id)return x;const hit=search(x.components??[]);if(hit)return hit;}};
  return search(financialResult(c,methods).strategies!.financial_research!.conditions)!;
}
it('evaluates the independent PC rule from latest operating facts, not the retained three-year quality rule',()=>{
  const c=insurer();
  operating(c,2023,{underwritingResult:-100,combinedRatio:1.2,combinedRatioDenominator:100});
  operating(c,2024,{underwritingResult:-100,combinedRatio:1.2,combinedRatioDenominator:100});
  operating(c,2025,{underwritingResult:10,combinedRatio:.9,combinedRatioDenominator:100});
  solvency(c,2025);
  expect(results(c).quality).toBe('fail');
  const r=financialResult(c,['pc_insurance']);
  expect(r.strategies!.financial_research).toMatchObject({state:'pass'});
  expect(strategyCondition(c,'F.operating.INS.combinedRatio',['pc_insurance']).state).toBe('pass');
  expect(r.strategies!.financial_value).toMatchObject({state:'unknown'}); // price is deliberately absent
  expect(r.strategies!.financial_value!.conditions.find(x=>x.id==='FV.P3')!.formula).toContain('comparable insurance 3y');
});
it('requires the direct insurer subject and its own latest legal capital',()=>{
  const c=insurer('life_insurance');operating(c,2025,{serviceResult:10});solvency(c,2025);
  expect(financialResult(c,['life_insurance']).strategies!.financial_research!.state).toBe('pass');
  changeContext(c,2025,v=>v.subject='OTHER');
  expect(strategyCondition(c,'F.risk.INS.capital',['life_insurance']).reason).toBe('insurance_solvency_context_unresolved:INS:2025');
  changeContext(c,2025,v=>v.subject='INS');
  c.facts=c.facts.filter(f=>f.field!=='regulatory.context');
  expect(strategyCondition(c,'F.risk.INS.capital',['life_insurance']).reason).toBe('insurance_solvency_context_unresolved:INS:2025');
});
it('uses a derived latest life service result without turning missing capital context into an operating gap',()=>{
  const c=lifeStatementCompany(),r=financialResult(c,['life_insurance']);
  expect(r.strategies!.financial_research).toMatchObject({state:'unknown'});
  expect(strategyCondition(c,'F.operating.INS.serviceResult',['life_insurance'])).toMatchObject({state:'pass',value:28});
  expect(strategyCondition(c,'F.risk.INS.capital',['life_insurance']).reason).toBe('insurance_solvency_context_unresolved:INS:2025');
});
it('keeps statement-derived life service proof when a valid capital context has no operating binding',()=>{
  const c=lifeStatementCompany();context(c,2025,'life');solvency(c,2025);
  expect(financialResult(c,['life_insurance']).strategies!.financial_research!.state).toBe('pass');
  expect(strategyCondition(c,'F.operating.INS.serviceResult',['life_insurance'])).toMatchObject({state:'pass',value:28});
});
function addSuppliedLifeChild(c:CompanyFacts,grade='C') {
  const child=insurer('life_insurance');solvency(child,2025,1.3,1.8,grade);
  const ids=new Map(child.facts.map(f=>[f.id,`LIFE:${f.id}`]));
  child.companyId='LIFE';
  for(const f of child.facts) {
    f.entity='LIFE';f.id=ids.get(f.id)!;
    if(f.field.endsWith('.context')) {
      const v=JSON.parse(String(f.value));v.subject='LIFE';
      f.value=JSON.stringify(v,(key,value)=>typeof value==='string'&&(key==='factId'||key.endsWith('FactId'))?ids.get(value)??value:value);
      f.evidence[0].raw=f.value;
    }
  }
  c.facts.push(...child.facts);
  return child;
}
it('uses a complete regulated group scope without making every subsidiary an inventory gate',()=>{
  const c=insurer('insurance_group');solvency(c,2025);
  const reg=c.facts.find(f=>f.field==='regulatory.context')!;
  const v=JSON.parse(String(reg.value));v.scope='regulatory_consolidated';reg.value=JSON.stringify(v);reg.evidence[0].raw=reg.value;
  expect(results(c).quality).toBe('unknown');
  const r=financialResult(c,['insurance_group']);
  expect(r.strategies!.financial_research).toMatchObject({state:'pass'});
  expect(strategyCondition(c,'F.scope.group',['insurance_group']).state).toBe('pass');
  v.scope='legal_entity';reg.value=JSON.stringify(v);reg.evidence[0].raw=reg.value;
  expect(strategyCondition(c,'F.risk.INS.capital',['insurance_group']).state).toBe('unknown');
});
it.each(['C','conflicting','below-buffer'] as const)('does not equate subsidiary observations with proven group risk (%s)',scenario=>{
 const c=insurer('insurance_group');solvency(c,2025);
 const reg=c.facts.find(f=>f.field==='regulatory.context')!,v=JSON.parse(String(reg.value));v.scope='regulatory_consolidated';reg.value=JSON.stringify(v);
 const before=financialResult(c,['insurance_group']);
 const child=addSuppliedLifeChild(c,scenario==='C'?'C':'B');
 if(scenario==='conflicting') {const rating=child.facts.find(f=>f.field==='insurance.riskRating'&&f.year===2025)!;c.facts.push({...rating,id:'conflicting-rating',value:'C'});}
 if(scenario==='below-buffer') c.facts.find(f=>f.entity==='LIFE'&&f.field==='regulatory.actual.coreSolvency')!.value=.8;
 const after=financialResult(c,['insurance_group']);
 expect(after.strategies?.financial_research?.state).toBe('pass');
 expect(after.quality).toBe(before.quality);
 expect(after.observations?.find(o=>o.id==='O.subsidiaries')?.factIds.length).toBeGreaterThan(0);
 c.checks.capital={state:'unresolved',evidence:['sourced-material-group-capital-conflict'],reason:'material_subsidiary_risk_invalidates_group_capital'};
 const blocked=financialResult(c,['insurance_group']);
 expect(blocked.strategies?.financial_research?.state).toBe('unknown');
 expect(blocked.strategies!.financial_research!.conditions.find(x=>x.id==='F.risk')?.components?.[0].reason).toBe('known_company_capital_scope_conflict');
});
it('keeps insurance methods disabled until a policy copy explicitly enables them',()=>{
  const c=insurer();operating(c,2025,{underwritingResult:10,combinedRatio:.9,combinedRatioDenominator:100});solvency(c,2025);
  const financial={...policy.strategies!.financial,methods:['bank','broker'] as const};
  expect(evaluateCompany(c,{...policy,strategies:{financial}},{strategy:'financial',evaluateAll:true}).strategies!.financial_research).toMatchObject({applicability:'unknown',state:'unknown'});
});

it('keeps invalid and conflicting optional child contexts out of group qualification',()=>{
  const c=insurer('insurance_group');solvency(c,2025);
  const reg=c.facts.find(f=>f.field==='regulatory.context')!,v=JSON.parse(String(reg.value));v.scope='regulatory_consolidated';reg.value=JSON.stringify(v);reg.evidence[0].raw=reg.value;
  const child={subject:'CHILD',scope:'legal_entity',kind:'life',reportYear:2025,accountingStandard:'CAS25-2023',comparisonBasis:'CAS25-2023',operating:{}};
  const id=fact(c,'insurance.context',2025,JSON.stringify(child),'text','CHILD');
  expect(financialResult(c,['insurance_group']).strategies!.financial_research!.state).toBe('pass');
  c.facts.find(f=>f.id===id)!.value='invalid context';
  expect(financialResult(c,['insurance_group']).strategies!.financial_research!.state).toBe('pass');
  c.facts.find(f=>f.id===id)!.value=JSON.stringify(child);
  c.facts.push({...c.facts.find(f=>f.id===id)!,id:'CHILD:conflicting-context',value:JSON.stringify({...child,scope:'group'})});
  expect(financialResult(c,['insurance_group']).strategies!.financial_research!.state).toBe('pass');
});

it('uses actual direct insurer capital independently, with frozen floors and disclosed stricter requirements',async()=>{
  const document=JSON.parse(await fs.readFile(new URL('../fixtures/insurance-direct-capital-pages.json',import.meta.url),'utf8'));
  const c=lifeStatementCompany();document.entity=c.companyId;
  c.facts.push(...parseCnInsuranceFacts(document,{sourceId:'actual-life-capital',basis:c.basis}));
  expect(strategyCondition(c,'F.risk.INS.coreSolvency',['life_insurance'])).toMatchObject({state:'pass'});
  expect(strategyCondition(c,'F.risk.INS.comprehensiveSolvency',['life_insurance'])).toMatchObject({state:'pass'});
  expect(strategyCondition(c,'F.operating.INS.serviceResult',['life_insurance'])).toMatchObject({state:'pass',value:28});
  const reg=c.facts.find(f=>f.field==='regulatory.context'&&f.year===2025)!;
  const v=JSON.parse(String(reg.value));
  v.metrics.coreSolvency.requirementFactId=fact(c,'regulatory.requirement.coreSolvency',2025,1.4,'ratio',c.companyId,true);reg.value=JSON.stringify(v);
  expect(strategyCondition(c,'F.risk.INS.coreSolvency',['life_insurance']).state).toBe('fail');
  c.facts.find(f=>f.id===v.metrics.coreSolvency.requirementFactId)!.state='conflicting';
  expect(strategyCondition(c,'F.risk.INS.coreSolvency',['life_insurance']).state).toBe('unknown');
  delete v.metrics.coreSolvency.requirementFactId;reg.value=JSON.stringify(v);
  context(c,2025,'life',{subject:'OTHER'});
  expect(strategyCondition(c,'F.risk.INS.capital',['life_insurance']).state).toBe('unknown');
});
