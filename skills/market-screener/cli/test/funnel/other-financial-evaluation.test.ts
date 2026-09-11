import {beforeAll,expect,it} from 'vitest';
import {evaluateCompany} from '../../src/cn/screening.js';
import {loadCnPolicy,type CnPolicy} from '../../src/policy/loader.js';
import type {CompanyFacts,ConditionResult} from '../../src/shared/financial-model.js';
let policy:CnPolicy;
beforeAll(async()=>{policy=await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml',import.meta.url).pathname);});
function company():CompanyFacts {return {ticker:'TEST',companyId:'test',companyName:'Synthetic regulated entity',market:'CN',currency:'CNY',asOf:'2026-09-10',latestFiscalYear:2025,basis:'source-basis',method:{state:'applies',value:'trust',coverage:{start:'2025-01-01',end:'2025-12-31'},evidence:['license']},checks:{},facts:[]};}
function period(c:CompanyFacts,year=2025) {
 const metrics:Record<string,unknown>={};
 const definitions:Array<[string,string,number,number]>=c.method.value==='futures'?[
  ['futuresRiskCoverage','net-capital/futures-risk-capital-reserve',1.6,1],
  ['netCapital','proprietary-net-capital',100_000_000,36_000_000],
  ['netCapitalEquity','net-capital/proprietary-net-assets',0.6,0.24],
  ['ownLiquidityRatio','own-liquid-assets/own-liquid-liabilities-excluding-client-margins',1.6,1.2],
  ['ownDebtEquity','own-liabilities-excluding-client-equity/proprietary-net-assets',0.8,1.2],
  ['ownSettlementReserve','own-settlement-reserve-excluding-client-margins',3_000_000,2_000_000],
 ]:[['trustRiskCoverage','net-capital/all-trust-company-business-risk-capital',1.6,1],['netCapitalEquity','net-capital/proprietary-net-assets',0.6,0.4]];
 for(const [metric,definition,actual,requirement] of definitions) {
  const ids=['actual','requirement'].map(kind=>`${year}:${kind}:${metric}`);
  for(const [i,id] of ids.entries())c.facts.push({id,field:`regulatory.${i?'requirement':'actual'}.${metric}`,entity:c.companyId,year,period:{start:`${year}-12-31`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit:['netCapital','ownSettlementReserve'].includes(metric)?'CNY':'ratio',state:'observed',value:i?requirement:actual,evidence:[{sourceId:'synthetic',locator:`/${id}`,raw:i?requirement:actual}]});
  metrics[metric]={definition,direction:metric==='ownDebtEquity'?'maximum':'minimum',actualFactId:ids[0],requirementFactId:ids[1],requirementKind:c.method.value==='futures' && !['futuresRiskCoverage','ownSettlementReserve'].includes(metric)?'warning':'regulatory'};
 }
 const value=JSON.stringify({subject:c.companyId,scope:'legal_entity',assetScope:c.method.value==='futures'?'own_funds_excluding_client_assets':'proprietary_excluding_trust_assets',regime:`trust-rule-${year}`,reportYear:year,position:'closing',comparisonBasis:'trust-capital',liquidityMetrics:[],metrics});
 c.facts.push({id:`context:${year}`,field:'regulatory.context',entity:c.companyId,year,period:{start:`${year}-12-31`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit:'text',state:'observed',value,evidence:[{sourceId:'synthetic',locator:`/context/${year}`,raw:value}]});
}
const flatten=(xs:ConditionResult[]):ConditionResult[]=>xs.flatMap(c=>[c,...flatten(c.components??[])]);
it('evaluates trust proprietary-capital thresholds and each original historical requirement without applying ordinary-company cash rules',()=>{
 const c=company();for(const y of [2023,2024,2025])period(c,y);
 let result=evaluateCompany(c,policy,{evaluateAll:true}),conditions=flatten(result.conditions);
 expect(conditions.find(r=>r.id==='F.risk')?.state).toBe('pass');
 expect(conditions.find(r=>r.id==='P2')?.state).toBe('pass');
 expect(result.conditions.some(r=>['N3','N4','N5','N6','N7','N8'].includes(r.id))).toBe(false);
 expect(result.quality).toBe('unknown');
 c.facts.find(f=>f.id==='2025:actual:trustRiskCoverage')!.value=1.49;
 c.facts=c.facts.filter(f=>f.id!=='2025:requirement:trustRiskCoverage');
 result=evaluateCompany(c,policy,{evaluateAll:true});conditions=flatten(result.conditions);
 expect(conditions.find(r=>r.id==='F.risk.trustRiskCoverage.absolute')?.state).toBe('fail');
 expect(conditions.find(r=>r.id==='F.risk.trustRiskCoverage.requirement')?.state).toBe('unknown');
 expect(result.quality).toBe('fail');
 const context=c.facts.find(f=>f.id==='context:2025')!;const payload=JSON.parse(String(context.value));delete payload.assetScope;context.value=JSON.stringify(payload);
 expect(evaluateCompany(c,policy).conditions.find(r=>r.id==='F.risk')).toMatchObject({state:'unknown',reason:'proprietary_regulatory_scope_unresolved'});
});

it('checks futures money amounts and strict warning boundaries using own funds, preserving each year’s source requirements',()=>{
 const c=company();c.method.value='futures';for(const y of [2023,2024,2025])period(c,y);
 const run=()=>flatten(evaluateCompany(c,policy,{evaluateAll:true}).conditions);
 expect(run().find(r=>r.id==='F.risk')?.state).toBe('pass');
 expect(run().find(r=>r.id==='P2')?.state).toBe('pass');
 const debt=c.facts.find(f=>f.id==='2025:actual:ownDebtEquity')!;debt.value=1.2;
 expect(run().find(r=>r.id==='F.risk.ownDebtEquity.requirement')).toMatchObject({state:'fail',threshold:{operator:'<',value:1.2}});
 debt.value=1.199;expect(run().find(r=>r.id==='F.risk.ownDebtEquity.requirement')?.state).toBe('pass');
 const capital=c.facts.find(f=>f.id==='2025:actual:netCapital')!;capital.value=36_000_000;
 expect(run().find(r=>r.id==='F.risk.netCapital.requirement')).toMatchObject({state:'fail',threshold:{operator:'>',value:36_000_000}});
 capital.value=-1;
 expect(run().find(r=>r.id==='F.risk.netCapital.requirement')?.state).toBe('fail');
 capital.value=100_000_000;capital.unit='ratio';
 expect(run().find(r=>r.id==='F.risk.netCapital.requirement')?.state).toBe('unknown');
 capital.unit='CNY';const context=c.facts.find(f=>f.id==='context:2025')!,payload=JSON.parse(String(context.value));payload.metrics.netCapital.requirementKind='regulatory';context.value=JSON.stringify(payload);
 expect(run().find(r=>r.id==='F.risk.netCapital.requirement')?.state).toBe('unknown');
 payload.assetScope='proprietary_excluding_trust_assets';context.value=JSON.stringify(payload);
 expect(run().find(r=>r.id==='F.risk')).toMatchObject({state:'unknown',reason:'proprietary_regulatory_scope_unresolved'});
});


it('uses the C1 absolute trust and futures risk floors without inventing absent regulatory minima',()=>{
 for(const method of ['trust','futures'] as const) {
  const c=company();c.method.value=method;period(c);
  const contextFact=c.facts.find(f=>f.id==='context:2025')!,context=JSON.parse(String(contextFact.value));
  const metrics=method==='trust'?['trustRiskCoverage','netCapitalEquity']:['futuresRiskCoverage'];
  for(const metric of metrics) delete context.metrics[metric].requirementFactId;
  contextFact.value=JSON.stringify(context);
  const run=()=>flatten(evaluateCompany(c,policy,{evaluateAll:true}).conditions);
  expect(run().find(r=>r.id==='F.risk')?.state).toBe('pass');
  const risk=metrics[0];context.metrics[risk].requirementFactId=`2025:requirement:${risk}`;contextFact.value=JSON.stringify(context);
  c.facts.find(f=>f.id===`2025:requirement:${risk}`)!.value=2;
  expect(run().find(r=>r.id===`F.risk.${risk}`)?.state).toBe('fail');
  // A supplied but broken reference is a conflict, not an absent requirement.
  c.facts=c.facts.filter(f=>f.id!==`2025:requirement:${risk}`);
  expect(run().find(r=>r.id===`F.risk.${risk}`)?.state).toBe('unknown');
  if(method==='futures') {
   delete context.metrics.netCapital.requirementFactId;contextFact.value=JSON.stringify(context);
   expect(run().find(r=>r.id==='F.risk.netCapital')?.state).toBe('unknown');
  }
 }
});

function researchCompany(method:'trust'|'futures'):CompanyFacts {
 const c=company();c.method.value=method;period(c);
 // Company-level sourced core facts: no segment inventory or quality-layer
 // historical regulatory evidence is needed by the independent strategy.
 c.checks.earnings={state:'applies',coverage:{start:'2021-01-01',end:'2025-12-31'},evidence:['synthetic-return-basis']};
 for(const year of [2021,2022,2023,2024,2025]) for(const [field,value,unit] of [['parentProfit',100_000_000,'CNY'],['weightedRoe',.09,'ratio']] as const) {
  c.facts.push({id:`${year}:${field}`,field,entity:c.companyId,year,period:{start:`${year}-01-01`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit,state:'observed',value,evidence:[{sourceId:'synthetic',locator:`/${year}/${field}`,raw:value}]});
 }
 return c;
}
it.each(['trust','futures'] as const)('allows independent %s research despite quality failure and missing historical priority risk',method=>{
 const c=researchCompany(method),result=evaluateCompany(c,policy,{strategy:'financial'});
 expect(result.quality).toBe('fail');
 expect(result.strategies?.financial_research).toMatchObject({applicability:'pass',state:'pass'});
 expect(result.strategies?.financial_research?.conditions.map(x=>x.id)).toEqual(['FR.profits','FR.roe5','FR.roe3','F.risk','F.scope']);
 expect(result.strategies?.financial_value).toMatchObject({state:'unknown'});
 expect(result.strategies?.financial_value?.conditions.find(x=>x.id==='FV.P3')?.state).toBe('unknown');
 expect(flatten(result.strategies!.financial_research!.conditions).some(x=>x.id==='P2')).toBe(false);
 const risk=method==='trust'?'trustRiskCoverage':'futuresRiskCoverage';
 c.facts.find(f=>f.id===`2025:actual:${risk}`)!.value=1.49;
 expect(evaluateCompany(c,policy,{strategy:'financial'}).strategies?.financial_research?.state).toBe('fail');
 c.facts=c.facts.filter(f=>f.id!==`2025:actual:${risk}`);
 expect(evaluateCompany(c,policy,{strategy:'financial'}).strategies?.financial_research?.state).toBe('unknown');
});
it.each(['trust','futures'] as const)('does not admit %s without its proprietary asset scope',method=>{
 const c=researchCompany(method),fact=c.facts.find(f=>f.id==='context:2025')!,payload=JSON.parse(String(fact.value));
 delete payload.assetScope;fact.value=JSON.stringify(payload);
 const result=evaluateCompany(c,policy,{strategy:'financial'});
 expect(result.strategies?.financial_research?.state).toBe('unknown');
 expect(result.strategies?.financial_research?.conditions.find(x=>x.id==='F.risk')).toMatchObject({state:'unknown',reason:'proprietary_regulatory_scope_unresolved'});
});
it('keeps financial research unknown when the method is unresolved, even if available earnings are negative',()=>{
 const c=researchCompany('trust');
 c.method={state:'unresolved',evidence:[],reason:'financial_method_unresolved'};
 for(const fact of c.facts.filter(f=>f.field==='parentProfit')) fact.value=-100;
 const result=evaluateCompany(c,policy,{strategy:'financial'});
 expect(result.strategies?.financial_research).toMatchObject({applicability:'unknown',state:'unknown'});
 expect(result.strategies?.financial_research?.conditions).toEqual([expect.objectContaining({id:'FR.method',state:'unknown',reason:'method_pending'})]);
});
