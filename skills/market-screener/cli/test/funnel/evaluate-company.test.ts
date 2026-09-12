import { beforeAll, describe, expect, it as vitestIt } from "vitest";
import fs from "node:fs/promises";
import { parseCnStatementFacts, parseCnRecentFinancialFacts } from "../../src/cn/sources/market-data.js";
import { parseCnDisclosureFacts } from "../../src/cn/sources/annual-reports.js";
import { createEvaluationAccumulator, evaluateCompany,evaluateCompanies, recentFinancialChanges } from "../../src/cn/screening.js";
import { loadCnPolicy, type CnPolicy } from "../../src/policy/loader.js";
import { latestDisclosedFiscalYear, type CompanyEvaluation, type CompanyFacts, type FinancialFact } from "../../src/shared/financial-model.js";

const coverage={start:'2010-01-01',end:'2026-09-09'};
let policy: CnPolicy;
const it=vitestIt;
const c1It=vitestIt;
beforeAll(async () => { policy = await loadCnPolicy(new URL("../../src/policy/cn-screening.yaml", import.meta.url).pathname); });

function evaluation(overrides: Partial<CompanyEvaluation> = {}): CompanyEvaluation {
  return {
    ticker: 'TEST', companyId: 'test', companyName: 'Synthetic company', market: 'CN',
    method: {state: 'applies', value: 'nonfinancial', evidence: []}, quality: 'pass', research:'pass', priority: 'fail',
    conditions: [], policyVersion: 'synthetic', ...overrides,
  };
}

it('summarizes completed evaluations incrementally without retaining evaluation payloads', () => {
  const items=[
    evaluation({ticker:'B',companyId:'b',priority:'pass',conditions:[{id:'P3',layer:'priority',state:'pass',reason:'threshold',factIds:[],missing:[],value:2}],identity:{exchange:'SSE',board:'main',listedAt:'2000-01-01',state:'listed',industryLabels:['A','A'],sourceId:'x',locator:'/',observedAt:'2026-09-09'}}),
    evaluation({ticker:'A',companyId:'a',priority:'pass',conditions:[{id:'P3',layer:'priority',state:'pass',reason:'threshold',factIds:[],missing:[],value:2}],identity:{exchange:'SSE',board:'main',listedAt:'2000-01-01',state:'listed',industryLabels:['A'],sourceId:'x',locator:'/',observedAt:'2026-09-09'}}),
    evaluation({ticker:'C',companyId:'c',quality:'fail',research:'fail',priority:'unknown',conditions:[{id:'N1',layer:'quality',state:'unknown',reason:'missing_proof',factIds:[],missing:['source_gap','source_gap']}]}),
    evaluation({ticker:'D',companyId:'d',quality:'unknown',research:'unknown',priority:'unknown',method:{state:'unresolved',evidence:[]},conditions:[{id:'N1',layer:'quality',state:'unknown',reason:'method_pending',factIds:[],missing:['method_pending']}]}),
  ];
  const once=createEvaluationAccumulator(1); items.forEach(item=>once.accept(item));
  const batched=createEvaluationAccumulator(1); items.slice(0,2).forEach(item=>batched.accept(item)); items.slice(2).forEach(item=>batched.accept(item));
  expect(batched.finish()).toEqual(once.finish());
  expect(once.finish()).toEqual(once.finish());
  expect(once.finish()).toMatchObject({qualityPool:['CN:B','CN:A'],researchCandidates:['CN:A','CN:B'],researchDisplayed:['CN:A'],researchCount:2,researchDisplayCount:1,opportunities:['CN:A','CN:B'],displayed:['CN:A'],displayCount:1,terminalCounts:{priority_pass:2,quality_fail:1,quality_unknown:1}});
  expect(once.finish().coverage.byIndustry.A).toMatchObject({input:2,displayed:1});
  expect(once.finish().unknownReasons).toMatchObject({source_gap:1,method_pending:1});
  const zero=createEvaluationAccumulator(0); items.forEach(item=>zero.accept(item));
  expect(zero.finish()).toMatchObject({opportunities:['CN:A','CN:B'],displayed:[],displayCount:0});
});

it('ranks research by reliable price values, retains unknowns last and caps only display', () => {
  const items=[
    evaluation({ticker:'Z',conditions:[{id:'P3',layer:'priority',state:'fail',reason:'threshold',factIds:[],missing:[],value:.07}]}),
    evaluation({ticker:'B',priority:'unknown',conditions:[{id:'P3',layer:'priority',state:'unknown',reason:'unresolved',factIds:[],missing:['quote'],value:99}]}),
    evaluation({ticker:'A',priority:'unknown'}),
    evaluation({ticker:'Y',conditions:[{id:'P3',layer:'priority',state:'fail',reason:'threshold',factIds:[],missing:[],value:.07}]}),
  ];
  const small=createEvaluationAccumulator(2),large=createEvaluationAccumulator(30);
  items.forEach(item=>{small.accept(item);large.accept(item);});
  expect(small.finish()).toMatchObject({researchCount:4,researchCandidates:['CN:Y','CN:Z','CN:A','CN:B'],researchDisplayed:['CN:Y','CN:Z'],opportunityCount:0});
  expect(large.finish().researchCandidates).toEqual(small.finish().researchCandidates);
  expect(large.finish().researchDisplayCount).toBe(4);
});

// Synthetic source facts: explicitly not a golden list of real company winners.
function company(profits: Array<number | null>): CompanyFacts {
  const facts: FinancialFact[] = profits.flatMap((value, i) => value === null ? [] : [{
    id: `pni-${2021 + i}`, field: "parentProfit", entity: "test", year: 2021 + i,
    period: { start: `${2021 + i}-01-01`, end: `${2021 + i}-12-31` },
    publishedAt: "2026-03-01", basis: "comparable", unit: "CNY", state: "observed", value,
    evidence: [{ sourceId: "synthetic", locator: `profits[${i}]`, raw: value }],
  }]);
  return {
    ticker: "TEST", companyId: "test", companyName: "Synthetic company", market: "CN", currency: "CNY",
    latestFiscalYear: 2025, basis: "comparable", asOf: "2026-09-09",
    method: { value: "nonfinancial", state: "applies", coverage, evidence: ["business"] },
    checks: { earnings:{state:"applies", coverage,evidence:["business"]}, cash: {state:"applies", coverage,evidence:["business"]}, cycle: { state: "not_applicable", coverage, evidence: ["business"] } }, facts,
  };
}

function condition(input: CompanyFacts, id: string) {
  return evaluateCompany(input, policy).conditions.find(c => c.id === id)!;
}

function reportedReturnCompany():CompanyFacts {
 const c=company([10,10,10,10,10]);c.checks={};
 add(c,'weightedRoe',[.20,.20,.20,.20,.20],'ratio');
 add(c,'adjustedWeightedRoe',[.18,.18,.18,.18,.18],'ratio');
 for(const year of [2021,2022,2023,2024,2025]) {
  const roe=c.facts.find(f=>f.field==='weightedRoe'&&f.year===year)!;
  const adjusted=c.facts.find(f=>f.field==='adjustedWeightedRoe'&&f.year===year)!;
  c.facts.push({...roe,id:`return-context:${year}`,field:'earnings.returnContext',unit:'text',value:JSON.stringify({accountingStandard:'CAS',shareholderScope:'ordinary',reportYear:year,weightedRoeFactId:roe.id,adjustedWeightedRoeFactId:adjusted.id})});
 }
 return c;
}
it('evaluates reported ordinary returns from annual source bindings without approving unrelated earnings or cash scopes',()=>{
 const c=reportedReturnCompany();
 const result=evaluateCompany(c,policy,{evaluateAll:true});
 expect(result.conditions.find(r=>r.id==='N2')).toMatchObject({state:'pass',reason:'annual_reported_return_basis'});
 expect(result.conditions.find(r=>r.id==='N2')?.factIds).toContain('return-context:2021');
 expect(result.conditions.find(r=>r.id==='N3')?.state).toBe('unknown');
 expect(result.conditions.find(r=>r.id==='P3')?.state).toBe('unknown');
 expect(c.checks.earnings).toBeUndefined();
 c.facts.find(f=>f.field==='adjustedWeightedRoe'&&f.year===2021)!.value=.05;
 c.facts.find(f=>f.field==='adjustedWeightedRoe'&&f.year===2022)!.value=.05;
 c.facts.find(f=>f.field==='adjustedWeightedRoe'&&f.year===2023)!.value=.05;
 expect(condition(c,'N2').state).toBe('fail');
});

it('does not erase a known unbridged return restatement with matching annual metric labels',()=>{
 const c=reportedReturnCompany(),original=c.facts.find(f=>f.id==='return-context:2022')!;
 c.facts.push({...original,id:'restatement:2022',field:'earnings.restatementContext',value:JSON.stringify({reportYear:2023,restatedYear:2022,scope:'consolidated',method:'retrospective',metrics:{retainedEarnings:{adjustmentFactId:'equity-adjustment'}}})});
 expect(condition(c,'N2')).toMatchObject({state:'unknown'});
 expect(condition(c,'N2').missing).toContain('reported_return_restatement_unbridged:2022');
 expect(condition(c,'N2').factIds).toContain('restatement:2022');
});

it('proves return failure from three correctly scoped low years without requiring the other two bindings',()=>{
 const c=reportedReturnCompany();
 for(const f of c.facts.filter(f=>f.field==='adjustedWeightedRoe'&&f.year<=2023))f.value=.03+(f.year-2021)*.02;
 c.facts=c.facts.filter(f=>!['return-context:2024','return-context:2025'].includes(f.id));
 const result=condition(c,'N2');
 expect(result.state).toBe('fail');
 expect(result.components?.find(r=>r.id==='N2.median')).toMatchObject({state:'fail',proof:'bound'});
 expect(result.missing).toContain('reported_return_basis_unresolved:2024');
 c.facts.find(f=>f.field==='adjustedWeightedRoe'&&f.year===2023)!.value=.12;
 expect(condition(c,'N2').state).toBe('unknown');
});

it.each([
 ['missing annual binding',(c:CompanyFacts)=>{c.facts=c.facts.filter(f=>f.id!=='return-context:2022');}],
 ['future annual binding',(c:CompanyFacts)=>{c.facts.find(f=>f.id==='return-context:2022')!.publishedAt='2027-01-01';}],
 ['other accounting basis',(c:CompanyFacts)=>{const f=c.facts.find(f=>f.id==='return-context:2022')!;f.value=JSON.stringify({...JSON.parse(String(f.value)),accountingStandard:'IFRS'});}],
 ['wrong bound metric',(c:CompanyFacts)=>{const f=c.facts.find(f=>f.id==='return-context:2022')!;f.value=JSON.stringify({...JSON.parse(String(f.value)),weightedRoeFactId:'pni-2022'});}],
 ['explicit scope conflict',(c:CompanyFacts)=>{c.checks.earnings={state:'unresolved',evidence:['conflicting-source'],reason:'conflicting_scope_evidence'};}],
] as const)('keeps the return condition unknown for %s',(_name,mutate)=>{
 const c=reportedReturnCompany();mutate(c);expect(condition(c,'N2').state).toBe('unknown');
});

it.each(['current','old','invalid','conflicting','incomplete-amounts'] as const)('keeps nonfinancial qualification independent of auxiliary segments: %s',scenario=>{
 const c=completeCompany(),before=evaluateCompany(c,policy);
 const year=scenario==='old'?2024:2025;
 const value=scenario==='invalid'?'broken':JSON.stringify({scope:'reported_segments',declaredCount:2,rows:[{name:'product A'},{name:'product B'}],totals:{}});
 const f:FinancialFact={id:'segments',field:'business.segments',entity:c.companyId,year,period:{start:`${year}-01-01`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit:'text',state:'observed',value,evidence:[{sourceId:'synthetic',locator:'/segments',raw:value}]};
 c.facts.push(f);
 if(scenario==='conflicting')c.facts.push({...f,id:'other-segments',value:'conflicting'});
 if(scenario==='incomplete-amounts')c.facts.push({...f,id:'segment-revenue',field:'business.segmentRevenue',unit:'CNY',value:100});
 const after=evaluateCompany(c,policy);
 expect(before.quality).toBe('pass');expect(after.quality).toBe(before.quality);expect(after.research).toBe(before.research);expect(after.priority).toBe(before.priority);
 expect(after.conditions).toEqual(before.conditions);
 expect(after.observations?.[0]).toMatchObject({state:'not_evaluated',factIds:['segments'],missing:[]});
 // A core cash-scope conflict remains material even with ordinary segment labels.
 c.checks.cash={state:'unresolved',evidence:['sourced-core-cash-conflict'],reason:'customer_cash_in_consolidated_operating_cash'};
 expect(condition(c,'N3').state).toBe('unknown');
});

describe("evidence-based company evaluation", () => {
  it('exempts an insurance group from direct operating proof while retaining its separate return and capital gaps',()=>{
    const c=company([10,10,10,10,10]);
    c.method={state:'applies',value:'insurance_group',coverage,evidence:['group-route']};
    const result=evaluateCompany(c,policy,{strategy:'financial'});
    const financial=result.strategies?.financial_research;
    expect(financial?.conditions.find(r=>r.id==='F.operating')).toMatchObject({state:'not_applicable',reason:'group_operating_not_required'});
    expect(financial?.conditions.find(r=>r.id==='FR.roe')?.state).toBe('unknown');
    expect(financial?.conditions.find(r=>r.id==='F.risk')?.state).toBe('unknown');
  });
  it('does not apply priority methods to unresolved routing even when diagnostic evaluation is requested',()=>{
    const c=company([10,10,10,10,10]);
    c.method={state:'unresolved',evidence:[],reason:'business_scope_required'};
    const result=evaluateCompany(c,policy,{evaluateAll:true});
    expect(result.quality).toBe('unknown');expect(result.priority).toBe('unknown');
    for(const id of ['P1','P2','P3']) expect(result.conditions.find(r=>r.id===id)).toMatchObject({state:'unknown',reason:'method_pending'});
  });
  it('uses agreeing observations together and keeps conflicting restatements unresolved',()=>{
    const c=company([10,10,10,10,10]);
    c.facts.push({...c.facts[0],id:'other-source-2021',publishedAt:'2026-08-01',evidence:[{sourceId:'other',locator:'/profit',raw:10}]});
    expect(condition(c,'N1').state).toBe('pass');
    expect(condition(c,'N1').factIds).toContain('other-source-2021');
    c.facts.at(-1)!.value=-100;
    expect(condition(c,'N1').state).toBe('unknown');
    expect(condition(c,'N1').missing).toContain('parentProfit:2021:conflict');
  });
  it("keeps missing profitability unknown, but proves failure when missing years cannot rescue it", () => {
    expect(condition(company([10, 10, 10, null, null]), "N1").state).toBe("unknown");
    const failed = condition(company([10, -10, -10, null, null]), "N1");
    expect(failed.state).toBe("fail");
    expect(failed.factIds).toEqual(["pni-2021", "pni-2022", "pni-2023"]);
    expect(failed.proof).toBe("bound");
    expect(failed.missing).toContain("parentProfit:2024");
  });
});

function add(c: CompanyFacts, field: string, values: Array<number | null>, unit = c.currency, start = 2021) {
  for (const [i,value] of values.entries()) if (value !== null) c.facts.push({
    id: `${field}-${start+i}`, field, entity: c.companyId, year: start+i,
    period: {start:`${start+i}-01-01`,end:`${start+i}-12-31`}, publishedAt:"2026-03-01", basis:c.basis,
    unit, state:"observed", value, evidence:[{sourceId:"synthetic",locator:`${field}[${i}]`,raw:value}],
  });
  return c;
}

function absence(c:CompanyFacts,field:string,year:number,annual=false) {
  c.facts.push({id:`${field}-${year}`,field,entity:c.companyId,year,period:{start:`${year}-${annual?'01-01':'12-31'}`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit:'boolean',state:'observed',value:true,evidence:[{sourceId:'synthetic',locator:`/${field}/${year}`,raw:true}]});
}

it("uses the lower reported ROE, fixed years and a sound median bound", () => {
  const c = company([10,10,10,10,10]);
  add(c, "weightedRoe", [null,null,0.10,0.11,0.119], "ratio");
  add(c, "adjustedWeightedRoe", [null,null,0.09,0.10,0.11], "ratio");
  expect(condition(c,"N2").state).toBe("fail");
  c.method.state = "unresolved";
  expect(condition(c,"N2").state).toBe("unknown");
  c.method.state = "applies";
  c.facts.find(f => f.id === "adjustedWeightedRoe-2025")!.publishedAt = "2027-01-01";
  expect(condition(c,"N2").state).toBe("fail"); // reported ROE itself is an upper bound on min(ROEs)
});

it("keeps missing capex out of FCF and uses consolidated net profit in cash conversion", () => {
  const c = company([5,5,5,5,5]);
  add(c,"netProfit",[10,10,10,10,10]);
  add(c,"operatingCashFlow",[7,7,7,7,7]);
  expect(condition(c,"N3").state).toBe("fail");
  expect(condition(c,"N4").state).toBe("unknown");
  expect(condition(c,"N4").missing).toContain("capex:2025");
});

function completeCompany() {
  const c = company([10,10,10,10,10]);
  for (const key of ['financing','interest','capital','earnings','quote']) c.checks[key]={state:'applies', coverage,evidence:[`${key}-scope`]};
  const fields: Record<string,number> = { netProfit:10, operatingCashFlow:12,capex:2, revenue:40,cost:10,businessTax:1,sellingExpense:2,adminExpense:2,researchExpense:1,assetImpairment:0,creditImpairment:0,interestExpense:1,profitBeforeTax:14,ordinaryProfit:10,adjustedOrdinaryProfit:10,reportedAdjustedParentProfit:10 };
  for (const [field,value] of Object.entries(fields)) add(c,field,Array(5).fill(value));
  for (const field of ['weightedRoe','adjustedWeightedRoe']) add(c,field,Array(5).fill(0.20),'ratio');
  add(c,'equity',Array(6).fill(50),c.currency,2020);
  add(c,'ordinaryEquity',[50],c.currency,2025);
  add(c,'parentEquity',[50],c.currency,2025);
  for(const field of ['shortBorrowings','longBorrowings','bondsPayable','shortBondsPayable','leaseLiabilities','currentNoncurrentLiabilities']) add(c,field,[1],c.currency,2025);
  add(c,'bookDebt',Array(6).fill(5),c.currency,2020);
  add(c,'debt',[5],c.currency,2025);
  add(c,'availableCash',[8],c.currency,2025);
  add(c,'price',[8],`${c.currency}/share`,2026);
  add(c,'ordinaryShares',[10],'shares',2026);
  for (const f of c.facts.filter(f=>f.year===2026)) { f.period={start:'2026-09-08',end:'2026-09-08'}; f.publishedAt='2026-09-08'; }
  c.quoteDate='2026-09-08'; c.lastCompletedTradingDay='2026-09-08';
  return c;
}

function c1Company() {
  return completeCompany();
}

c1It('uses fixed reported debt without cash netting or a complete-financing proof',()=>{
  const c=c1Company();delete c.checks.financing;
  const evaluated=evaluateCompany(c,policy);
  expect(evaluated.derivedFacts?.find(f=>f.field==='reportedDebt')).toMatchObject({value:6,derivation:{algorithm:'D_reported-v1:sum(shortBorrowings,longBorrowings,bondsPayable,shortBondsPayable,leaseLiabilities,currentNoncurrentLiabilities)'}});
  expect(evaluated.derivedFacts?.find(f=>f.field==='reportedDebt')?.derivation?.inputs).toHaveLength(6);
  expect(evaluated.conditions.find(r=>r.id==='N5')).toMatchObject({state:'pass'});
  expect(condition(c,'N5').components?.find(r=>r.id==='N5.leverage')).toMatchObject({value:.12,formula:'D_reported / consolidated equity'});
  expect(condition(c,'N6').components?.find(r=>r.id==='N6.coverage')).toMatchObject({value:.5,formula:'D_reported/mean(OCF,3y)'});
  c.facts.find(f=>f.field==='currentNoncurrentLiabilities')!.value=60;
  expect(condition(c,'N5').state).toBe('fail');
});

c1It('keeps a fixed reported debt column unknown unless its zero is explicitly sourced',()=>{
  const c=c1Company();c.facts=c.facts.filter(f=>f.field!=='shortBondsPayable');
  expect(condition(c,'N5').state).toBe('unknown');
  absence(c,'shortBondsPayableAbsentAtYearEnd',2025);
  expect(condition(c,'N5').state).toBe('pass');
});

c1It('uses a same-row consolidated liability only as a conservative bound for incomplete nonfinancial debt',()=>{
 const bound=(c:CompanyFacts,value:number)=>{
  for(const field of ['shortBorrowings','longBorrowings','bondsPayable','shortBondsPayable','leaseLiabilities','currentNoncurrentLiabilities']) for(const fact of c.facts.filter(f=>f.field===field&&f.year===2025)) fact.evidence=[{sourceId:'balance',locator:`/data/0/${field}`,raw:fact.value!}];
  add(c,'liabilities',[value],c.currency,2025);
  const liability=c.facts.find(f=>f.field==='liabilities'&&f.year===2025)!;
  liability.period={start:'2025-12-31',end:'2025-12-31'};liability.evidence=[{sourceId:'balance',locator:'/data/0/TOTAL_LIABILITIES',raw:value}];
  c.facts.push({id:'balance-context',field:'balance.consolidatedContext',entity:c.companyId,year:2025,period:{start:'2025-12-31',end:'2025-12-31'},publishedAt:'2026-03-01',basis:c.basis,unit:'text',state:'observed',value:JSON.stringify({contract:'eastmoney_annual_consolidated_balance_v1',row:'/data/0'}),evidence:[{sourceId:'balance',locator:'/data/0/REPORT_DATE',raw:'2025-12-31'}]});
 };
 const c=c1Company();delete c.checks.financing;c.facts=c.facts.filter(f=>f.field!=='shortBondsPayable');bound(c,10);
 expect(condition(c,'N5')).toMatchObject({state:'pass',proof:'bound'});expect(condition(c,'N6')).toMatchObject({state:'pass',proof:'bound'});
 const corroborated=structuredClone(c);
 corroborated.facts.push(...c.facts.filter(f=>f.evidence.some(e=>e.sourceId==='balance')).map(f=>({...structuredClone(f),id:`copy:${f.id}`,evidence:f.evidence.map(e=>({...e,sourceId:'balance-copy'}))})));
 expect(condition(corroborated,'N5')).toMatchObject({state:'pass',proof:'bound'});
 expect(condition(corroborated,'N6')).toMatchObject({state:'pass',proof:'bound'});
 const contradicted=structuredClone(corroborated);contradicted.facts.find(f=>f.id.startsWith('copy:')&&f.field==='shortBorrowings')!.value=9;
 expect(condition(contradicted,'N5').state).toBe('unknown');
 const noContract=structuredClone(c);noContract.facts=noContract.facts.filter(f=>f.field!=='balance.consolidatedContext');expect(condition(noContract,'N5').state).toBe('unknown');
 const tooHigh=structuredClone(c);tooHigh.facts.find(f=>f.field==='liabilities')!.value=100;tooHigh.facts.find(f=>f.field==='liabilities')!.evidence[0]!.raw=100;expect(condition(tooHigh,'N5').state).toBe('unknown');
 const conflict=structuredClone(c);conflict.facts.find(f=>f.field==='shortBorrowings')!.value=20;expect(condition(conflict,'N5')).toMatchObject({state:'unknown',missing:expect.arrayContaining(['reported_debt_liability_bound_conflict'])});
 const wrongRow=structuredClone(c);wrongRow.facts.find(f=>f.field==='shortBorrowings')!.evidence[0]!.locator='/data/1/shortBorrowings';expect(condition(wrongRow,'N5').state).toBe('unknown');
 const negative=structuredClone(c);negative.facts.find(f=>f.field==='shortBorrowings')!.value=-1;expect(condition(negative,'N5').state).toBe('unknown');
 const wrongUnit=structuredClone(c);wrongUnit.facts.find(f=>f.field==='shortBorrowings')!.unit='USD';expect(condition(wrongUnit,'N5').state).toBe('unknown');
 const financing=structuredClone(c);financing.checks.financing={state:'unresolved',evidence:['known-conflict']};expect(condition(financing,'N5').state).toBe('unknown');
 for(const mutate of [
  (f:CompanyFacts['facts'][number])=>{f.value=-1;},
  (f:CompanyFacts['facts'][number])=>{f.unit='USD';},
  (f:CompanyFacts['facts'][number])=>{f.entity='another-company';},
  (f:CompanyFacts['facts'][number])=>{f.basis='parent-only';},
  (f:CompanyFacts['facts'][number])=>{f.period.end='2024-12-31';},
  (f:CompanyFacts['facts'][number])=>{f.state='conflicting';delete f.value;},
 ]) {
  const invalid=structuredClone(c);mutate(invalid.facts.find(f=>f.field==='liabilities')!);
  expect(condition(invalid,'N5').state).toBe('unknown');expect(condition(invalid,'N6').state).toBe('unknown');
 }
 const conflictingDebt=structuredClone(c),debtFact=conflictingDebt.facts.find(f=>f.field==='shortBorrowings')!;
 conflictingDebt.facts.push({...structuredClone(debtFact),id:'contradictory-borrowing',value:9});
 expect(condition(conflictingDebt,'N5').state).toBe('unknown');
 const reliableComplete=c1Company();delete reliableComplete.checks.financing;bound(reliableComplete,100);
 expect(condition(reliableComplete,'N5').components?.find(r=>r.id==='N5.leverage')).toMatchObject({state:'pass',proof:'exact'});
 const complete=c1Company();delete complete.checks.financing;bound(complete,1);expect(condition(complete,'N5')).toMatchObject({state:'unknown',missing:expect.arrayContaining(['reported_debt_liability_bound_conflict'])});
});

c1It('fails negative FCF directly and adjusts P3 only for a known special claim',()=>{
  const c=c1Company();for(const f of c.facts.filter(f=>f.field==='capex')) f.value=20;
  expect(condition(c,'N4')).toMatchObject({state:'fail',reason:'threshold'});
  for(const f of c.facts.filter(f=>f.field==='capex')) f.value=2;
  c.facts=c.facts.filter(f=>!['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field));
  add(c,'nonordinaryProfitAllocation',[3],c.currency,2025);
  add(c,'adjustedNonordinaryProfitAllocation',[3],c.currency,2025);
  const result=evaluateCompany(c,policy,{evaluateAll:true});
  expect(result.conditions.find(r=>r.id==='P1')?.state).toBe('pass');
  expect(result.conditions.find(r=>r.id==='P3')?.value).toBeCloseTo(.06125);
});

c1It('keeps financial leasing visibly unvalidated until its dedicated real-source evidence is complete',()=>{
  const c=c1Company();c.method.value='financial_lease';
  const result=evaluateCompany(c,policy,{evaluateAll:true});
  expect(result.conditions.find(r=>r.id==='F.methodValidation')).toMatchObject({state:'unknown',reason:'financial_method_not_supported'});
  expect(result.quality).toBe('unknown');
  expect(result.conditions.find(r=>r.id==='P0')?.state).toBe('unknown');
  expect(result.priority).not.toBe('pass');
});

c1It('uses data gaps rather than a development gate for validated bank and broker methods',()=>{
  for(const method of ['bank','broker'] as const) {
    const c=c1Company();c.method.value=method;
    const result=evaluateCompany(c,policy,{evaluateAll:true});
    expect(result.conditions.some(r=>r.id==='F.methodValidation')).toBe(false);
    expect(result.conditions.find(r=>r.id==='F.risk')?.state).toBe('unknown');
    expect(result.quality).toBe('unknown');
    expect(result.priority).not.toBe('pass');
  }
});

c1It('does not let an identified preferred equity claim disappear from P3',()=>{
  const c=c1Company();
  c.facts=c.facts.filter(f=>!['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field));
  add(c,'preferredEquity',[5],c.currency,2020);
  expect(condition(c,'P3')).toMatchObject({state:'unknown',missing:expect.arrayContaining(['reported_earnings_claim_unresolved'])});
  add(c,'ordinaryProfit',Array(5).fill(10));add(c,'adjustedOrdinaryProfit',Array(5).fill(10));
  expect(condition(c,'P3').state).toBe('pass');
});

c1It('keeps an aggregate other-equity balance visible without inventing a profit allocation',()=>{
  const c=c1Company();
  c.facts=c.facts.filter(f=>!['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field));
  const baseline=evaluateCompany(c,policy);
  add(c,'nonordinaryEquity',[5],c.currency,2020);
  const result=evaluateCompany(c,policy),price=result.conditions.find(r=>r.id==='P3')!;
  expect(result.research).toBe(baseline.research);
  expect(price).toMatchObject({state:'pass',value:baseline.conditions.find(r=>r.id==='P3')!.value});
  expect(price.factIds).toContain('nonordinaryEquity-2020');
  add(c,'perpetualEquity',[2],c.currency,2020);
  expect(condition(c,'P3').state).toBe('unknown');
  expect(evaluateCompany(c,policy).research).toBe(baseline.research);
});

c1It('does not infer a cash scope failure from an industry label alone',()=>{
  const c=c1Company();delete c.checks.cash;
  const source=c.facts[0]!;
  c.facts.push({...source,id:'bank-label',field:'industryClassification',unit:'text',value:'银行'});
  expect(condition(c,'N3').state).toBe('pass');
});

c1It('keeps a known legacy financing classification visible as a report-debt conflict',()=>{
  const c=c1Company(),source=c.facts.find(f=>f.field==='shortBorrowings')!;
  c.facts.push({...source,id:'legacy-financing',field:'classification.otherFinancingLiabilities',unit:'text',value:JSON.stringify({state:'components',components:['otherPayables']})});
  expect(condition(c,'N5')).toMatchObject({state:'unknown'});
  expect(condition(c,'N5').missing).toContain('reported_financing_scope_conflict');
});

it('values A/H ordinary shares from a fresh reconciled structure without a manual quote approval',()=>{
  const c=completeCompany();delete c.checks.quote;
  const structure={effectiveDate:'2026-05-01',announcedAt:'2026-04-28',totalShares:10,aShares:8,bShares:null,restrictedBShares:null,hShares:2,restrictedHShares:null,otherShares:null,preferredShares:null,changeReason:'H股上市'};
  const at='2026-09-08T08:00:00Z';
  c.facts.push({id:'share-structure',field:'quote.shareStructure',entity:c.companyId,basis:c.basis,year:2026,period:{start:at,end:at},publishedAt:at,unit:'text',state:'observed',value:JSON.stringify(structure),evidence:[{sourceId:'synthetic-structure',locator:'/result/data/0/TOTAL_SHARES',raw:10}]});
  expect(condition(c,'P3')).toMatchObject({state:'pass',value:0.0875,reason:'reported_ordinary_share_structure'});
  expect(condition(c,'P3').factIds).toContain('share-structure');
  expect(c.checks.quote).toBeUndefined();
  for(const change of [{aShares:7},{aShares:9},{totalShares:11},{otherShares:1},{effectiveDate:'2026-09-09'}]) {
    const invalid=structuredClone(c);invalid.facts.find(f=>f.id==='share-structure')!.value=JSON.stringify({...structure,...change});
    expect(condition(invalid,'P3').state).toBe('unknown');
  }
  const stale=structuredClone(c);stale.facts.find(f=>f.id==='share-structure')!.publishedAt='2026-09-07';
  expect(condition(stale,'P3').state).toBe('unknown');
  const disputed=structuredClone(c);disputed.checks.quote={state:'unresolved',coverage,evidence:['known-rights-conflict'],reason:'nonproportional_profit_rights'};
  expect(condition(disputed,'P3').state).toBe('unknown');
  const reviewed=structuredClone(c);reviewed.checks.quote={state:'applies',coverage,evidence:['reviewed-quote']};
  reviewed.facts.find(f=>f.id==='share-structure')!.value=JSON.stringify({...structure,totalShares:11});
  expect(condition(reviewed,'P3').state).toBe('unknown');
});

it('keeps conflicting same-day quote and structural share counts unresolved',()=>{
  const c=completeCompany();
  const shares=c.facts.find(f=>f.field==='ordinaryShares')!;
  c.facts.push({...shares,id:'same-day-f84-conflict',value:11,evidence:[{sourceId:'synthetic-f84',locator:'/data/f84',raw:11}]});
  expect(condition(c,'P3')).toMatchObject({state:'unknown',missing:expect.arrayContaining(['ordinaryShares:2026:conflict'])});
});

function sevenYearCompany() {
  const c=completeCompany();
  for(const year of [2019,2020]) for(const f of c.facts.filter(f=>f.year===2021)) {
    if(c.facts.some(existing=>existing.field===f.field && existing.year===year)) continue;
    c.facts.push({...f,id:`${f.field}-${year}`,year,period:{start:f.period.start.replace('2021',String(year)),end:f.period.end.replace('2021',String(year))}});
  }
  add(c,'equity',[50],c.currency,2018);add(c,'bookDebt',[5],c.currency,2018);
  return c;
}

it('rejects excessive reported borrowings without requiring every remaining debt role to be classified',()=>{
  const c=completeCompany();delete c.checks.financing;
  c.facts=c.facts.filter(f=>!['shortBorrowings','longBorrowings','bondsPayable','shortBondsPayable','leaseLiabilities','currentNoncurrentLiabilities'].includes(f.field));
  add(c,'shortBorrowings',[60],c.currency,2025); // Already exceeds the 50 consolidated equity; missing debt cannot reduce it.
  const n5=condition(c,'N5');
  expect(n5).toMatchObject({state:'fail'});
  expect(n5.components?.find(r=>r.id==='N5.leverage')).toMatchObject({state:'fail',bounds:{lower:1.2}});
  expect(n5.missing).toContain('longBorrowings:2025');
  const low=structuredClone(c);low.facts.find(f=>f.field==='shortBorrowings')!.value=5;
  expect(condition(low,'N5').state).toBe('unknown');
  const scoped=structuredClone(c);scoped.checks.financing={state:'unresolved',evidence:['mismatched-scope'],reason:'known_scope_conflict'};
  expect(condition(scoped,'N5').state).toBe('unknown');
});

it('qualifies both windows without inventing a cycle classification',()=>{
  const c=sevenYearCompany();delete c.checks.cycle;
  const result=evaluateCompany(c,policy,{strategy:'financial'});
  expect(result.conditions.find(r=>r.id==='cycle')).toMatchObject({state:'pass',reason:'cycle_applicability_independent_bound',proof:'bound'});
  expect(result.quality).toBe('pass');expect(result.priority).toBe('pass');
  expect(c.checks.cycle).toBeUndefined();
  expect(result.conditions.find(r=>r.id==='P1')?.factIds).toContain('parentProfit-2019');
});

it('uses annual API return bindings and separately observed ordinary profit for priority earnings',()=>{
  const c=sevenYearCompany();delete c.checks.cycle;delete c.checks.earnings;
  for(const year of [2019,2020,2021,2022,2023,2024,2025]) {
    const roe=c.facts.find(f=>f.field==='weightedRoe'&&f.year===year)!;
    const adjusted=c.facts.find(f=>f.field==='adjustedWeightedRoe'&&f.year===year)!;
    c.facts.push({...roe,id:`context-${year}`,field:'earnings.returnContext',unit:'text',value:JSON.stringify({accountingStandard:'CAS',shareholderScope:'ordinary',reportYear:year,weightedRoeFactId:roe.id,adjustedWeightedRoeFactId:adjusted.id})});
  }
  expect(condition(c,'cycle').state).toBe('pass');
  expect(condition(c,'P1').state).toBe('pass');
  expect(condition(c,'P3')).toMatchObject({state:'pass',value:0.0875});
  expect(condition(c,'P3').factIds).toContain('context-2019');
  const missingProfit=structuredClone(c);
  missingProfit.facts=missingProfit.facts.filter(f=>!(f.field==='reportedAdjustedParentProfit'&&f.year===2025));
  expect(condition(missingProfit,'P1').state).toBe('unknown');
  expect(condition(missingProfit,'P3').state).toBe('pass'); // Direct ordinary amount remains available for P3.
  const restated=structuredClone(c),context=restated.facts.find(f=>f.id==='context-2022')!;
  restated.facts.push({...context,id:'restated-2022',field:'earnings.restatementContext',value:'known unbridged restatement'});
  const restatedResult=evaluateCompany(restated,policy,{evaluateAll:true});
  for(const id of ['P1','P3']) {
    expect(restatedResult.conditions.find(r=>r.id===id)?.state).toBe('unknown');
    expect(restatedResult.conditions.find(r=>r.id===id)?.factIds).toContain('restated-2022');
  }
  const missingQuoteScope=structuredClone(c);delete missingQuoteScope.checks.quote;
  expect(condition(missingQuoteScope,'P1').state).toBe('pass');
  expect(condition(missingQuoteScope,'P3')).toMatchObject({state:'unknown',reason:'scope_unresolved:quote',missing:expect.arrayContaining(['share_structure_missing_or_stale'])});
  missingQuoteScope.facts=missingQuoteScope.facts.filter(f=>f.field!=='ordinaryShares');
  expect(condition(missingQuoteScope,'P3').missing).toEqual(expect.arrayContaining(['share_structure_missing_or_stale','ordinaryShares:2026']));
  c.checks.earnings={state:'unresolved',evidence:['known-conflict'],reason:'restatement_not_bridged'};
  expect(condition(c,'cycle').state).toBe('unknown');
  const disputed=evaluateCompany(c,policy,{evaluateAll:true});
  expect(disputed.conditions.find(r=>r.id==='P1')?.state).toBe('unknown');
  expect(disputed.conditions.find(r=>r.id==='P3')?.state).toBe('unknown');
});

it('does not reject an unclassified cycle on seven-year failure or waive missing history',()=>{
  const c=sevenYearCompany();delete c.checks.cycle;
  for(const f of c.facts.filter(f=>f.field==='parentProfit'&&f.year<=2021)) f.value=-1;
  expect(condition(c,'N1').state).toBe('pass');
  expect(condition(c,'cycle')).toMatchObject({state:'unknown',reason:'cycle_scope_unresolved'});
  c.checks.cycle={state:'applies',coverage,evidence:['cycle-proof']};
  expect(condition(c,'cycle').state).toBe('fail');
  const short=completeCompany();delete short.checks.cycle;
  expect(condition(short,'cycle').state).toBe('unknown');
});

it.each(['return'] as const)('keeps priority unknown when the %s windows disagree in either direction',metric=>{
  for(const lowYears of [[2021,2022,2023],[2019,2020,2021,2022]]) {
    const c=sevenYearCompany();delete c.checks.cycle;
    if(metric==='capital') {c.checks.capitalAdjustments={state:'applies',coverage,evidence:['adjustments-proof']};add(c,'nonoperatingAssets',Array(8).fill(0),c.currency,2018);}
    for(const f of c.facts.filter(f=>lowYears.includes(f.year))) {
      if(metric==='return' && ['weightedRoe','adjustedWeightedRoe'].includes(f.field)) f.value=.13;
      if(metric==='capital' && f.field==='revenue') f.value=24;
    }
    expect(evaluateCompany(c,policy).quality).toBe('pass');
    expect(condition(c,'P1')).toMatchObject({state:'unknown',reason:'cycle_scope_unresolved'});
    const branchStates=condition(c,'P1').components!.map(r=>r.state).sort();
    expect(branchStates).toEqual(['fail','pass']);
    expect(evaluateCompany(c,policy).priority).toBe('unknown');
  }
});

it('bounds the price signal across both cycle windows instead of choosing the higher profit reference',()=>{
  const c=sevenYearCompany();delete c.checks.cycle;
  for(const f of c.facts.filter(f=>['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field)&&f.year<=2022)) f.value=2;
  const price=condition(c,'P3');
  expect(price.state).toBe('unknown');
  expect(price.bounds?.lower).toBeCloseTo(.0175);expect(price.bounds?.upper).toBeCloseTo(.0875);
  c.facts.find(f=>f.field==='price')!.value=1;
  expect(condition(c,'P3').state).toBe('pass');
  c.facts.find(f=>f.field==='price')!.value=20;
  expect(condition(c,'P3').state).toBe('fail');
});

it('ranks a qualified bounded price signal by its conservative lower yield',()=>{
  const bounded=sevenYearCompany();delete bounded.checks.cycle;
  bounded.ticker='BOUNDED';bounded.facts.find(f=>f.field==='price')!.value=1;
  for(const f of bounded.facts.filter(f=>['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field)&&f.year<=2022)) f.value=2;
  const ordinary=completeCompany();ordinary.ticker='EXACT';
  const results=[evaluateCompany(ordinary,policy),evaluateCompany(bounded,policy)];
  expect(results.map(r=>r.priority)).toEqual(['pass','pass']);
  const acc=createEvaluationAccumulator(1);results.forEach(r=>acc.accept(r));
  expect(acc.finish().displayed).toEqual(['CN:BOUNDED']); // 14% lower bound exceeds the other's exact 8.75%.
});

it("produces a qualified opportunity and changes only priority when price rises", () => {
  const c=completeCompany();
  expect(evaluateCompany(c,policy)).toMatchObject({quality:'pass',priority:'pass'});
  expect(condition(c,'P3').value).toBeCloseTo(0.0875,10);
  c.facts.find(f=>f.field==='price')!.value=12;
  expect(evaluateCompany(c,policy)).toMatchObject({quality:'pass',research:'pass',priority:'fail'});
  expect(condition(c,'P3').value).toBeCloseTo(0.058333333333,10);
});

it('keeps a verified prior-year closing session valid across the New Year holiday',()=>{
  const c=completeCompany();c.asOf='2027-01-01';
  c.checks.quote.coverage={start:c.asOf,end:c.asOf};
  c.quoteDate='2026-12-31';c.lastCompletedTradingDay=c.quoteDate;
  for(const f of c.facts.filter(f=>['price','ordinaryShares'].includes(f.field))) {
    f.period={start:'2026-12-31',end:'2026-12-31'};f.publishedAt='2026-12-31';
  }
  expect(evaluateCompany(c,policy)).toMatchObject({quality:'pass',priority:'pass'});
});

it('applies the display limit after finding every opportunity, with no backfill from price failures',()=>{
  const companies=[8,7,100].map((price,i)=>{
    const c=completeCompany();c.ticker=`TEST-${i}`;c.companyId=c.ticker;
    for(const f of c.facts) f.entity=c.companyId;
    c.facts.find(f=>f.field==='price')!.value=price;
    return c;
  });
  const limited=evaluateCompanies(companies,policy,1);
  const larger=evaluateCompanies(companies,policy,30);
  expect(limited.results).toEqual(larger.results);
  expect(limited.summary.opportunities).toEqual(['CN:TEST-1','CN:TEST-0']);
  expect(larger.summary.opportunities).toEqual(limited.summary.opportunities);
  expect(limited.summary.displayed).toEqual(['CN:TEST-1']);
  expect(larger.summary.displayCount).toBe(2);
  expect(larger.summary.qualityCount).toBe(3);
});

it.each(['negative capex','negative reported debt','quarter in annual window','stale quote','nonpositive equity'])('rejects an invalid proof: %s', kind => {
  const c=completeCompany();
  if(kind==='negative capex') for(const f of c.facts.filter(f=>f.field==='capex')) f.value=-200;
  if(kind==='negative reported debt') for(const f of c.facts.filter(f=>f.field==='shortBorrowings')) f.value=-49;
  if(kind==='quarter in annual window') for(const f of c.facts.filter(f=>f.year<=2025)) f.period={start:`${f.year}-07-01`,end:`${f.year}-09-30`};
  if(kind==='stale quote') {c.quoteDate='2026-01-08';c.facts.find(f=>f.field==='price')!.period.end=c.quoteDate;}
  if(kind==='nonpositive equity') c.facts.find(f=>f.field==='parentEquity')!.value=-5;
  expect(evaluateCompany(c,policy).priority).not.toBe('pass');
  if(kind==='nonpositive equity') expect(condition(c,'N5').state).toBe('fail');
});

it('propagates unbridged cash to debt coverage but keeps independent cycle return failures',()=>{
  const c=completeCompany();
  c.checks.cash={state:'unresolved',evidence:[],reason:'unverified_finance_subsidiary_bridge'};
 expect(condition(c,'N3').state).toBe('pass');expect(condition(c,'N4').state).toBe('pass');
 c.checks.cash.evidence=['sourced_material_cash_conflict'];
  c.checks.cycle={state:'applies', coverage,evidence:['business']};
  c.facts.find(f=>f.field==='debt')!.value=45;
  c.facts.find(f=>f.field==='availableCash')!.value=0;
  expect(condition(c,'N6').state).toBe('unknown');
  for(const f of c.facts.filter(f=>f.field==='weightedRoe')) f.value=0.01;
  expect(condition(c,'cycle').state).toBe('fail');
});

it('applies earnings comparability to the cycle ROE condition without hiding independent profit failures',()=>{
  const c=completeCompany();c.checks.cycle={state:'applies', coverage,evidence:['cycle-scope']};
  c.checks.earnings={state:'unresolved',evidence:[],reason:'restatement_not_bridged'};
  for(const f of c.facts.filter(f=>f.field==='weightedRoe')) f.value=.01;
  expect(condition(c,'cycle').state).toBe('unknown');
  for(const f of c.facts.filter(f=>f.field==='parentProfit' && f.year>=2023)) f.value=-10;
  expect(condition(c,'cycle').state).toBe('fail');
});

it('does not accept contradictory observations of a reported borrowing component',()=>{
  const c=completeCompany();
  add(c,'shortBorrowings',[55],c.currency,2025);
  c.facts.find(f=>f.field==='shortBorrowings')!.period.start='2025-12-31';
  expect(condition(c,'N5').state).toBe('unknown');
  expect(condition(c,'N5').missing).toContain('shortBorrowings:2025:conflict');
});

it('does not manufacture a seven-year window from five available years',()=>{
  const c=completeCompany();c.checks.cycle={state:'applies', coverage,evidence:['business']};
  expect(condition(c,'cycle').state).toBe('unknown');
  expect(evaluateCompany(c,policy).quality).toBe('unknown');
});

it('does not sum two observations of the same reported debt component',()=>{
  const c=completeCompany();
  const debt=c.facts.find(f=>f.field==='shortBorrowings')!;
  c.facts.push({...debt,id:'confirmed-debt',evidence:[{sourceId:'other-statement',locator:'/shortBorrowings',raw:1}]});
  expect(condition(c,'N5').components?.find(r=>r.id==='N5.leverage')?.value).toBe(.12);
  expect(evaluateCompany(c,policy).derivedFacts?.find(f=>f.field==='reportedDebt')?.derivation?.inputs).toContain('confirmed-debt');
});

it('repairs a missing provider field with a verified observation without erasing actual conflicts',()=>{
  const c=completeCompany();
  const capex=c.facts.find(f=>f.field==='capex')!;
  c.facts.push({...capex,id:'empty-provider-cell',state:'missing',value:undefined,reason:'source_field_missing',evidence:[]});
  expect(evaluateCompany(c,policy).priority).toBe('pass');
  c.facts.push({...capex,id:'different-source',value:200});
  expect(condition(c,'N4').state).toBe('unknown');
});

it('proves excessive leverage from a non-overlapping borrowing lower bound without inventing complete debt',()=>{
  const c=completeCompany();c.facts=c.facts.filter(f=>!['shortBorrowings','longBorrowings','bondsPayable','shortBondsPayable','leaseLiabilities','currentNoncurrentLiabilities'].includes(f.field));
  add(c,'shortBorrowings',[40],c.currency,2025);add(c,'longBorrowings',[8],c.currency,2025);
  add(c,'leaseLiabilities',[1],c.currency,2025);add(c,'currentBorrowings',[4],c.currency,2025);add(c,'currentLeaseLiabilities',[2],c.currency,2025);
  add(c,'currentNoncurrentLiabilities',[6],c.currency,2025); // Parent aggregate, never added to its children.
  const proof=condition(c,'N5').components!.find(r=>r.id==='N5.leverage')!;
  expect(proof).toMatchObject({state:'fail',proof:'bound',bounds:{lower:1.1}});
  expect(proof.factIds).toContain('currentNoncurrentLiabilities-2025');
  expect(proof.factIds).not.toContain('currentBorrowings-2025');
  expect(evaluateCompany(c,policy).derivedFacts?.some(f=>f.field==='debt')).toBe(false);
  c.checks.financing.state='unresolved';expect(condition(c,'N5').state).toBe('unknown');
});

it('does not apply a latest-year cash scope review to historical cash conditions',()=>{
  const c=completeCompany();
  c.checks.cash.coverage={start:'2025-01-01',end:'2025-12-31'};
  c.checks.capital.coverage={start:'2021-01-01',end:'2025-12-31'};
  expect(condition(c,'N3').state).toBe('unknown');
  expect(condition(c,'N2').state).toBe('pass');
  c.checks.financing.coverage={start:'2025-12-31',end:'2025-12-31'};
  expect(condition(c,'N5').state).toBe('pass'); // A year-end leverage test needs that instant only.
});

it('does not let another financing balance conceal a contradicted current financing classification',()=>{
  const c=completeCompany();c.facts=c.facts.filter(f=>!['bookDebt','debt'].includes(f.field));
  for(const [field,value] of Object.entries({shortBorrowings:0,longBorrowings:0,bondsPayable:0,leaseLiabilities:0,currentBorrowings:100,otherPayables:200})) {
    add(c,field,[value],c.currency,2025);c.facts.find(f=>f.field===field)!.period.start='2025-12-31';
  }
  c.facts.find(f=>f.field==='equity' && f.year===2025)!.value=250;
  for(const field of ['currentFinancingLiabilities','financingNotesPayable','noncurrentFinancingPayables','otherFinancingLiabilities','additionalFinancing']) {
    const components=field==='otherFinancingLiabilities'?['otherPayables']:[];
    c.facts.push({id:`assignment:${field}`,field:`classification.${field}`,entity:c.companyId,year:2025,period:{start:'2025-12-31',end:'2025-12-31'},publishedAt:'2026-03-01',basis:c.basis,unit:'text',state:'observed',value:JSON.stringify({state:components.length?'components':'absent',components}),evidence:[{sourceId:'synthetic',locator:`/${field}`,raw:'synthetic role classification'}]});
  }
  const result=evaluateCompany(c,policy);
  expect(result.derivedFacts?.some(f=>f.field==='currentFinancingLiabilities' || f.field==='debt')).toBe(false);
  expect(result.conditions.find(f=>f.id==='N5')?.state).not.toBe('pass');
});

it('requires the main method record to cover the evaluated report endpoint',()=>{
  const c=completeCompany();c.method.coverage={start:'2018-01-01',end:'2018-12-31'};
  expect(condition(c,'N1').reason).toBe('method_pending');
  delete c.method.coverage;
  expect(evaluateCompany(c,policy).quality).toBe('unknown');
});

it('reports failed companies with unresolved conditions separately and preserves industry coverage',()=>{
  const failed=company([-10,-10,-10,-10,-10]);
  failed.identity={exchange:'SSE',board:'主板',listedAt:'2000-01-01',state:'listed',industryLabels:['C 制造业'],sourceId:'synthetic',locator:'/0',observedAt:'2026-09-09'};
  const unknown=company([null,null,null,null,null]);unknown.ticker='OTHER';unknown.companyId='other';unknown.method={state:'unresolved',evidence:[]};
  const {summary}=evaluateCompanies([failed,unknown],policy);
  expect(summary.terminalCounts).toEqual({quality_fail:1,quality_unknown:1});
  expect(summary.coverage.byIndustry['C 制造业']).toMatchObject({input:1,qualityKnown:1,qualityFailedWithUnknown:1});
  expect(summary.coverage.byIndustry.unlabeled).toMatchObject({input:1,qualityKnown:0});
  expect(summary.coverage.byMethod.nonfinancial).toMatchObject({input:1});
  expect(summary.coverage.byMethod.unresolved).toMatchObject({input:1});
  expect(summary.unknownReasons.method_pending).toBe(1);
});

it('routes bank returns through reported ROE and leaves credit evidence unknown without imposing corporate cash tests',()=>{
  const c=company([10,10,10,10,10]);
  c.method.value='bank';
  add(c,'weightedRoe',[.16,.16,.16,.16,.16],'ratio');
  add(c,'adjustedWeightedRoe',[.01,.01,.01,.01,.01],'ratio');
  add(c,'operatingCashFlow',[-10,-10,-10,-10,-10]);
  const r=evaluateCompany(c,policy);
  expect(r.conditions.find(x=>x.id==='N2')?.state).toBe('pass');
  expect(r.conditions.some(x=>['N3','N4','N5','N6','N7','N8'].includes(x.id))).toBe(false);
  expect(r.conditions.find(x=>x.id==='F.risk')?.state).toBe('unknown');
  expect(r.quality).toBe('unknown');
});

function regulatedCompany(method:'bank'|'broker'|'financial_lease'='bank') {
  const c=company([10,10,10,10,10]);c.method.value=method;
  c.checks.financialBusiness={state:'applies',coverage,evidence:['business-scope']};
  add(c,'weightedRoe',[.16,.16,.16,.16,.16],'ratio');
  return c;
}
it.each(['bank','broker'] as const)('can qualify a validated %s while incomplete historical capital keeps priority unknown',method=>{
  const c=regulatedCompany(method);
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  if(method==='broker') regulatoryPeriod(c,2025,'opening');
  // Preserve the latest and broker's same-report comparable opening. Only
  // older original year-end capital observations are absent.
  c.facts=c.facts.filter(f=>!/^reg:202[34]:closing:(cet1|totalCapital|riskCoverage|capitalLeverage):actual$/.test(f.id));
  const result=evaluateCompany(c,policy,{evaluateAll:true});
  expect(result.conditions.find(r=>r.id==='F.risk')?.state).toBe('pass');
  expect(result.quality).toBe('pass');
  expect(result.conditions.find(r=>r.id==='P2')?.state).toBe('unknown');
  expect(result.priority).not.toBe('pass');
});
it('evaluates bank financial research independently of the retained quality threshold and keeps a missing price local to value',()=>{
  const c=regulatedCompany('bank');
  // 9% meets the frozen financial 8% rule but deliberately fails the quality N2 condition's
  // 12% threshold, proving the old quality early exit does not decide it.
  for(const roe of c.facts.filter(f=>f.field==='weightedRoe')) roe.value=.09;
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  const result=evaluateCompany(c,policy,{strategy:'financial'});
  expect(result.quality).toBe('fail');
  expect(result.strategies?.financial_research).toMatchObject({state:'pass'});
  expect(result.strategies?.financial_value).toMatchObject({state:'unknown'});
  const accumulator=createEvaluationAccumulator(30,'financial'); accumulator.accept(result);
  const selected=accumulator.finish();
  expect(selected).toMatchObject({strategy:'financial',researchCandidates:['CN:TEST'],opportunities:[]});
});
it('rejects financial research when the latest reported PNI is nonpositive even with four profitable years',()=>{
  const c=regulatedCompany('bank');
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  c.facts.find(f=>f.id==='pni-2025')!.value=-1;
  const research=evaluateCompany(c,policy,{strategy:'financial'}).strategies?.financial_research;
  expect(research).toMatchObject({state:'fail'});
  expect(research?.conditions.find(c=>c.id==='FR.profits')).toMatchObject({state:'fail'});
  expect(research?.conditions.find(c=>c.id==='FR.profits')?.components?.find(c=>c.id==='FR.profits.positive')).toMatchObject({state:'pass'});
  expect(research?.conditions.find(c=>c.id==='FR.profits')?.components?.find(c=>c.id==='FR.profits.latest')).toMatchObject({state:'fail'});
});
it.each([
  ['missing', (c:CompanyFacts)=>{}],
  ['conflicting', (c:CompanyFacts)=>{const roe=c.facts.find(f=>f.field==='weightedRoe'&&f.year===2025)!;c.facts.push({...roe,id:'conflicting-roe-2025',value:.04});}],
] as const)('retains %s annual ROE proof as an unknown financial-research condition',(_name,mutate)=>{
  const c=regulatedCompany('bank');
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  delete c.checks.earnings;
  mutate(c);
  const research=evaluateCompany(c,policy,{strategy:'financial'}).strategies?.financial_research;
  expect(research).toMatchObject({state:'unknown'});
  expect(research?.conditions.find(c=>c.id==='FR.roe5')).toMatchObject({state:'unknown'});
  expect(research?.conditions.find(c=>c.id==='FR.roe3')).toMatchObject({state:'unknown'});
  expect(research?.conditions.flatMap(c=>[c,...(c.components??[])]).flatMap(c=>c.missing)).toContain('reported_return_basis_unresolved:2025');
});
function regulatoryPeriod(c:CompanyFacts,reportYear:number,position:'closing'|'opening'='closing',changes:Record<string,number>={}) {
  const year=position==='closing'?reportYear:reportYear-1;
  const defaults:Record<string,[number,number,string,'minimum'|'maximum']>={
    loanNpl:[.01,.05,'nonperforming-loans/gross-loans','maximum'],
    loanProvisionCoverage:[2,1.5,'loan-loss-provisions/nonperforming-loans','minimum'],
    leaseNpl:[.01,.05,'nonperforming-finance-lease-assets/gross-finance-lease-assets','maximum'],
    leaseProvisionCoverage:[2,1.5,'lease-loss-provisions/nonperforming-finance-lease-assets','minimum'],
    cet1:[.12,.08,'core-tier-1-capital/risk-weighted-assets','minimum'],
    tier1:[.13,.09,'tier-1-capital/risk-weighted-assets','minimum'],
    totalCapital:[.15,.11,'total-capital/risk-weighted-assets','minimum'],
    riskCoverage:[2,1,'net-capital/total-risk-capital-reserve','minimum'],
    capitalLeverage:[.12,.08,'core-net-capital/total-on-and-off-balance-assets','minimum'],
    lcr:[1.3,1,'high-quality-liquid-assets/net-cash-outflows-30d','minimum'],
    nsfr:[1.2,1,'available-stable-funding/required-stable-funding','minimum'],
    liquidityRatio:[.33,.30,'liquid-assets/liquid-liabilities','minimum'],
  };
  const metrics:Record<string,{definition:string;direction:string;actualFactId:string;requirementFactId:string}>={};
  for(const [metric,[actual,requirement,definition,direction]] of Object.entries(defaults)) {
    const ids=['actual','requirement'].map(kind=>`reg:${reportYear}:${position}:${metric}:${kind}`);
    for(const [i,id] of ids.entries()) c.facts.push({id,field:`regulatory.${i===0?'actual':'requirement'}.${metric}`,entity:c.companyId,year,period:{start:`${year}-12-31`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit:'ratio',state:'observed',value:i===0?changes[metric]??actual:requirement,evidence:[{sourceId:'synthetic-regulatory',locator:`/${id}`,raw:i===0?changes[metric]??actual:requirement}]});
    metrics[metric]={definition,direction,actualFactId:ids[0],requirementFactId:ids[1]};
  }
  const payload={subject:c.companyId,scope:'regulatory_consolidated',regime:`regime-${reportYear}`,reportYear,position,comparisonBasis:'credit-ratio-v1',liquidityMetrics:c.method.value==='financial_lease'?['liquidityRatio']:['lcr','nsfr'],metrics};
  const value=JSON.stringify(payload);
  c.facts.push({id:`context:${reportYear}:${position}`,field:'regulatory.context',entity:c.companyId,year,period:{start:`${year}-12-31`,end:`${year}-12-31`},publishedAt:'2026-03-01',basis:c.basis,unit:'text',state:'observed',value,evidence:[{sourceId:'synthetic-regulatory',locator:`/context/${reportYear}/${position}`,raw:value}]});
}

it('evaluates bank credit and capital with sourced requirements and percentage-point margins',()=>{
  const c=regulatedCompany();
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  expect(condition(c,'F.risk').state).toBe('pass');
  const total=c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:actual')!;
  total.value=.129; // 12.9% exceeds 11% by only 1.9 percentage points.
  expect(condition(c,'F.risk').state).toBe('fail');
  total.value=.13;
  expect(condition(c,'F.risk').state).toBe('pass');
  c.facts=c.facts.filter(f=>f.id!=='reg:2025:closing:totalCapital:requirement');
  expect(condition(c,'F.risk').state).toBe('unknown');
  const unresolvedCapital=condition(c,'F.risk').components?.find(r=>r.id==='F.risk.totalCapital')?.components?.find(r=>r.id.endsWith('.requirement'));
  expect(unresolvedCapital).toMatchObject({state:'unknown',value:.13,factIds:expect.arrayContaining(['reg:2025:closing:totalCapital:actual'])});
});

it('uses finance-lease asset credit, all three capital tiers and its actual minimum liquidity regime',()=>{
  const c=regulatedCompany('financial_lease');
  add(c,'operatingCashFlow',[-20,-20,-20,-20,-20]);
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  expect(condition(c,'F.risk').state).toBe('pass');
  c.facts.find(f=>f.id==='reg:2025:closing:tier1:actual')!.value=.109;
  expect(condition(c,'F.risk').state).toBe('fail');
  c.facts.find(f=>f.id==='reg:2025:closing:tier1:actual')!.value=.13;
  c.facts.find(f=>f.id==='reg:2025:closing:liquidityRatio:actual')!.value=.329;
  expect(condition(c,'F.risk').state).toBe('fail');
  c.facts.find(f=>f.id==='reg:2025:closing:liquidityRatio:actual')!.value=.33;
  expect(condition(c,'F.risk').state).toBe('pass');
  c.facts=c.facts.filter(f=>f.id!=='reg:2025:closing:leaseNpl:actual');
  expect(condition(c,'F.risk').state).toBe('unknown'); // bank NPL still exists but is a different asset definition.
});

it('checks broker closing and comparable opening requirements without substituting the prior report version',()=>{
  const c=regulatedCompany('broker');
  regulatoryPeriod(c,2025);regulatoryPeriod(c,2024);
  expect(condition(c,'F.risk').state).toBe('unknown');
  regulatoryPeriod(c,2025,'opening',{capitalLeverage:.095}); // 1.2 x 8% = 9.6%, not a two-point margin.
  expect(condition(c,'F.risk').state).toBe('fail');
  c.facts.find(f=>f.id==='reg:2025:opening:capitalLeverage:actual')!.value=.096;
  expect(condition(c,'F.risk').state).toBe('pass');
  const context=c.facts.find(f=>f.id==='context:2025:opening')!;
  const payload=JSON.parse(String(context.value));payload.comparisonBasis='old-incomparable-definition';context.value=JSON.stringify(payload);
  expect(condition(c,'F.risk').state).toBe('unknown');
});

it('uses three year-end financial risk observations for priority without requiring FCF or recursively extending credit history',()=>{
  const c=regulatedCompany('financial_lease');
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  add(c,'ordinaryProfit',[10,10,10,10,10]);
  c.checks.financialEarnings={state:'applies',coverage,evidence:['investment-income-composition']};
  c.checks.quote={state:'applies',coverage,evidence:['share-rights']};
  add(c,'price',[8],'CNY/share',2026);add(c,'ordinaryShares',[10],'shares',2026);
  for(const f of c.facts.filter(f=>f.year===2026)) {f.period={start:'2026-09-08',end:'2026-09-08'};f.publishedAt='2026-09-08';}
  c.quoteDate='2026-09-08';c.lastCompletedTradingDay='2026-09-08';
  const expanded=evaluateCompany(c,policy,{evaluateAll:true});
  expect(expanded.quality).toBe('unknown'); // Diagnostic conditions execute, but this method awaits ticket03 validation.
  for(const id of ['P1','P2','P3']) expect(expanded.conditions.find(x=>x.id===id)?.state).toBe('pass');
  c.facts.find(f=>f.id==='reg:2023:closing:liquidityRatio:actual')!.value=.32;
  const result=evaluateCompany(c,policy,{evaluateAll:true});
  expect(result.quality).toBe('unknown');
  expect(result.priority).toBe('fail');
  expect(result.conditions.find(x=>x.id==='P2')?.state).toBe('fail');
  c.facts=c.facts.filter(f=>f.id!=='reg:2023:closing:liquidityRatio:actual');
  expect(evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(x=>x.id==='P2')?.state).toBe('unknown');
});

it('does not invent a numeric credit requirement when source evidence explicitly establishes no applicable numeric limit',()=>{
  const c=regulatedCompany();for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  const requirement=c.facts.find(f=>f.id==='reg:2025:closing:loanNpl:requirement')!;
  requirement.state='not_applicable';requirement.unit='text';delete requirement.value;requirement.reason='no_applicable_numeric_requirement';
  expect(condition(c,'F.risk').state).toBe('pass');
  const capital=c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:requirement')!;
  capital.state='not_applicable';capital.unit='text';delete capital.value;capital.reason='no_applicable_numeric_requirement';
  expect(condition(c,'F.risk').state).toBe('unknown'); // A capital margin requires its actual applicable minimum.
});

it('uses C-1 financial candidate thresholds without a requirement, but honors a disclosed stricter one',()=>{
  const c=regulatedCompany();for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  for(const metric of ['loanNpl','loanProvisionCoverage','lcr','nsfr']) {
    c.facts=c.facts.filter(f=>!f.id.includes(`:${metric}:requirement`));
    for(const context of c.facts.filter(f=>f.field==='regulatory.context')) {
      const value=JSON.parse(String(context.value));delete value.metrics[metric].requirementFactId;context.value=JSON.stringify(value);
    }
  }
  expect(condition(c,'F.risk').state).toBe('pass');
  const nplContext=c.facts.find(f=>f.id==='context:2025:closing')!;
  const context=JSON.parse(String(nplContext.value));
  const actual=c.facts.find(f=>f.id==='reg:2025:closing:loanNpl:actual')!;
  const requirement={...actual,id:'stricter-loan-npl-requirement',field:'regulatory.requirement.loanNpl',value:.015,evidence:[{sourceId:'synthetic-regulatory',locator:'/stricter-loan-npl-requirement',raw:.015}]};
  c.facts.push(requirement);context.metrics.loanNpl.requirementFactId=requirement.id;nplContext.value=JSON.stringify(context);
  actual.value=.018;
  expect(condition(c,'F.risk').state).toBe('fail');
});

it('evaluates lease credit and broker risk-coverage candidate thresholds without requirement facts',()=>{
  const lease=regulatedCompany('financial_lease');for(const year of [2023,2024,2025]) regulatoryPeriod(lease,year);
  for(const metric of ['leaseNpl','leaseProvisionCoverage']) {
    lease.facts=lease.facts.filter(f=>!f.id.includes(`:${metric}:requirement`));
    for(const context of lease.facts.filter(f=>f.field==='regulatory.context')) {
      const value=JSON.parse(String(context.value));delete value.metrics[metric].requirementFactId;context.value=JSON.stringify(value);
    }
  }
  expect(condition(lease,'F.risk').state).toBe('pass');
  const broker=regulatedCompany('broker');regulatoryPeriod(broker,2025);regulatoryPeriod(broker,2025,'opening');
  broker.facts=broker.facts.filter(f=>!f.id.includes(':riskCoverage:requirement'));
  for(const context of broker.facts.filter(f=>f.field==='regulatory.context')) {
    const value=JSON.parse(String(context.value));delete value.metrics.riskCoverage.requirementFactId;context.value=JSON.stringify(value);
  }
  expect(condition(broker,'F.risk').state).toBe('pass');
});

it('keeps optional candidate facts unknown when their binding is invalid and relative rules when requirements are missing',()=>{
  const c=regulatedCompany();for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  const context=c.facts.find(f=>f.id==='context:2025:closing')!;
  const value=JSON.parse(String(context.value));delete value.metrics.loanNpl.requirementFactId;value.metrics.loanNpl.definition='wrong-definition';context.value=JSON.stringify(value);
  expect(condition(c,'F.risk').components?.find(r=>r.id==='F.risk.loanNpl')?.state).toBe('unknown');
  value.metrics.loanNpl.definition='nonperforming-loans/gross-loans';context.value=JSON.stringify(value);
  c.facts=c.facts.filter(f=>f.id!=='reg:2025:closing:totalCapital:requirement');
  expect(condition(c,'F.risk').components?.find(r=>r.id==='F.risk.totalCapital')?.state).toBe('unknown');
});

it('checks each historical regulatory minimum under its own regime without requiring one calculation basis across years',()=>{
  const c=regulatedCompany('financial_lease');
  for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  const prior=c.facts.find(f=>f.id==='context:2023:closing')!;
  const context=JSON.parse(String(prior.value));context.regime='prior-disclosed-regime';context.comparisonBasis='prior-definition-basis';prior.value=JSON.stringify(context);
  const result=evaluateCompany(c,policy,{evaluateAll:true});
  expect(result.conditions.find(r=>r.id==='P2')?.state).toBe('pass');
  // A trend still needs comparability; passing annual margins does not manufacture it.
  expect(result.conditions.find(r=>r.id==='F.risk')?.components?.find(r=>r.id.endsWith('.nplTrend'))?.state).toBe('unknown');
});

it('compares the stated half-percentage-point credit trend without treating floating-point noise as deterioration',()=>{
  const c=regulatedCompany();
  regulatoryPeriod(c,2023,'closing',{loanNpl:.015});
  regulatoryPeriod(c,2024,'closing',{loanNpl:.018});
  regulatoryPeriod(c,2025,'closing',{loanNpl:.020});
  expect(condition(c,'F.risk').state).toBe('pass');
  c.facts.find(f=>f.id==='reg:2023:closing:loanNpl:actual')!.value=.0149;
  expect(condition(c,'F.risk').state).toBe('fail');
});

it('does not require an exhaustive subsidiary inventory and retains concrete regulatory failures',()=>{
  const c=regulatedCompany();for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  expect(condition(c,'F.risk').state).toBe('pass');
  expect(condition(c,'F.scope')).toMatchObject({state:'not_applicable',reason:'company_level_method_scope'});
  c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:actual')!.value=.12;
  expect(evaluateCompany(c,policy).quality).toBe('fail');
  c.checks.financialBusiness={state:'unresolved',evidence:[]};
  expect(condition(c,'F.risk').state).toBe('fail');
});

it.each([
  ['unknown requirement', (c:CompanyFacts)=>{c.facts=c.facts.filter(f=>f.id!=='reg:2025:closing:totalCapital:requirement');}],
  ['future actual', (c:CompanyFacts)=>{c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:actual')!.publishedAt='2027-01-01';}],
  ['other legal entity', (c:CompanyFacts)=>{c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:actual')!.entity='subsidiary';}],
  ['interim ratio', (c:CompanyFacts)=>{c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:actual')!.period.end='2025-09-30';}],
  ['missing source reference', (c:CompanyFacts)=>{c.facts.find(f=>f.id==='reg:2025:closing:totalCapital:actual')!.evidence=[];}],
  ['inverted direction', (c:CompanyFacts)=>{const f=c.facts.find(f=>f.id==='context:2025:closing')!;const v=JSON.parse(String(f.value));v.metrics.totalCapital.direction='maximum';f.value=JSON.stringify(v);}],
  ['different metric definition', (c:CompanyFacts)=>{const f=c.facts.find(f=>f.id==='context:2025:closing')!;const v=JSON.parse(String(f.value));v.metrics.totalCapital.definition='capital/assets';f.value=JSON.stringify(v);}],
  ['conflicting current report', (c:CompanyFacts)=>{const f=c.facts.find(f=>f.id==='context:2025:closing')!;const v=JSON.parse(String(f.value));v.regime='conflicting-regime';c.facts.push({...f,id:'other-context',value:JSON.stringify(v)});}],
])('does not admit a bank regulatory ratio with %s',(_name,mutate)=>{
  const c=regulatedCompany();for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  mutate(c);
  expect(condition(c,'F.risk').state).toBe('unknown');
});

it('does not waive all lease liquidity tests or invert an upper limit into a minimum-times-buffer rule',()=>{
  const c=regulatedCompany('financial_lease');for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  const f=c.facts.find(f=>f.id==='context:2025:closing')!;const value=JSON.parse(String(f.value));
  value.metrics.liquidityRatio.direction='maximum';f.value=JSON.stringify(value);
  expect(condition(c,'F.risk').state).toBe('unknown');
  value.liquidityMetrics=[];f.value=JSON.stringify(value);
  expect(condition(c,'F.risk').state).toBe('unknown');
  expect(condition(c,'F.risk').components?.find(r=>r.id==='F.risk.totalCapital')?.state).toBe('pass');
});

it('requires positive aggregate reported earnings for financial companies as well as four profitable years',()=>{
  const c=regulatedCompany();
  c.facts.find(f=>f.id==='pni-2025')!.value=-100;
  expect(condition(c,'N1').state).toBe('fail'); // Four positive years cannot offset a negative five-year total.
  c.method.value='nonfinancial';
  expect(condition(c,'N1').state).toBe('fail');
});


it('uses reported consolidated cash amounts unless a specific cash-scope problem is recorded',()=>{
 const c=company([10,10,10,10,10]);delete c.checks.cash;
 add(c,'netProfit',[10,10,10,10,10]);add(c,'operatingCashFlow',[12,12,12,12,12]);add(c,'capex',[2,2,2,2,2]);
 expect(condition(c,'N3').state).toBe('pass');expect(condition(c,'N4').state).toBe('pass');
 c.facts.push({...c.facts[0],id:'industry',field:'industryClassification',unit:'text',value:'K 房地产业'});
 expect(condition(c,'N3').state).toBe('pass');
 c.facts=c.facts.filter(f=>f.id!=='industry');
 c.checks.cash={state:'unresolved',evidence:[],reason:'unverified_finance_subsidiary_bridge'};
 expect(condition(c,'N3').state).toBe('pass');expect(condition(c,'N4').state).toBe('pass');
 c.checks.cash.evidence=['sourced_material_cash_conflict'];
 expect(condition(c,'N3').state).toBe('unknown');expect(condition(c,'N4').state).toBe('unknown');
 delete c.checks.cash;c.facts=c.facts.filter(f=>!(f.field==='operatingCashFlow'&&f.year===2023));
 expect(condition(c,'N3').state).toBe('unknown');
});
function soleLeaseSegmentCompany():CompanyFacts {
 const c=company([10,10,10,10,10]);c.method.value='financial_lease';
 const add=(field:string,value:unknown,instant=false)=>c.facts.push({id:field,field,entity:c.companyId,year:2025,period:{start:`2025-${instant?'12-31':'01-01'}`,end:'2025-12-31'},publishedAt:'2026-03-01',basis:c.basis,unit:'text',state:'observed',value:JSON.stringify(value),evidence:[{sourceId:'synthetic',locator:`/${field}`,raw:JSON.stringify(value)}]});
 add('business.segments',{scope:'reported_segments',declaredCount:1,rows:[{name:'租赁业务',definition:'在报告期内，本集团专注于租赁业务，因此只有一个经营分部，无需编制分部信息。'}],totals:{}});
 add('regulatory.context',{subject:c.companyId,scope:'regulatory_consolidated',regime:'NFRA-2023-4',reportYear:2025,position:'closing',comparisonBasis:'NFRA-2023-4',liquidityMetrics:[],metrics:{}},true);
 return c;
}
it.each(['financial_lease','bank'] as const)('does not require another business proof for a routed %s company',method=>{
 const c=soleLeaseSegmentCompany();c.method.value=method;
 expect(condition(c,'F.scope')).toMatchObject({state:'not_applicable',reason:'company_level_method_scope',missing:[]});
 expect(condition(c,'F.risk').state).toBe('unknown');
 expect(evaluateCompany(c,policy).observations?.[0].factIds).toContain('business.segments');
});

it.each(['legal-entity-only','missing-regulatory-scope','conflicting-regulatory-scope'])(
 'keeps activity coverage separate from unresolved numeric risk for %s',scenario=>{
 const c=soleLeaseSegmentCompany(),f=c.facts.find(f=>f.field==='regulatory.context')!,reg=JSON.parse(String(f.value));
 if(scenario==='legal-entity-only') f.value=JSON.stringify({...reg,scope:'legal_entity'});
 if(scenario==='missing-regulatory-scope') c.facts=c.facts.filter(x=>x!==f);
 if(scenario==='conflicting-regulatory-scope') c.facts.push({...f,id:'conflicting-regulatory',value:JSON.stringify({...reg,scope:'legal_entity'})});
 expect(condition(c,'F.scope').state).toBe('not_applicable');
 expect(condition(c,'F.risk').state).toBe('unknown');
 expect(evaluateCompany(c,policy).quality).toBe('unknown');
});

async function reportedBankSegmentCompany():Promise<CompanyFacts> {
 const reports=JSON.parse(await fs.readFile(new URL('../fixtures/business-segment-lines.json',import.meta.url),'utf8'));
 const c=company([10,10,10,10,10]);c.method.value='bank';
 const document={...reports[0].document,entity:c.companyId};
 c.facts.push(...parseCnDisclosureFacts(document,{sourceId:'reported-bank-segments',basis:c.basis}));
 return c;
}
it('keeps real reported banking segments as observations without inventing absent core risk data',async()=>{
 const c=await reportedBankSegmentCompany();
 expect(condition(c,'F.scope')).toMatchObject({state:'not_applicable',reason:'company_level_method_scope'});
 expect(evaluateCompany(c,policy).observations?.length).toBeGreaterThan(0);
 expect(condition(c,'F.risk').state).toBe('unknown');
});

it.each(['financial_lease','life_insurance','mixed',undefined] as const)('always reports financial strategy states for pending method %s on the normal path',method=>{
 const c=completeCompany();c.method={state:method?'applies':'unresolved',value:method,evidence:['route'],coverage};
 const r=evaluateCompany(c,policy,{strategy:'financial'});
 expect(r.strategies?.financial_research?.state).toBe('unknown');
 expect(r.strategies?.financial_value?.state).toBe('unknown');
});

it('distinguishes an unsupported routed financial method from missing bank evidence',()=>{
 const c=completeCompany();c.method={state:'applies',value:'financial_lease',evidence:['route'],coverage};
 const result=evaluateCompany(c,policy,{strategy:'all'});
 expect(result.strategies?.financial_research).toMatchObject({state:'unknown',conditions:[{id:'FR.method',reason:'financial_method_not_supported',factIds:['route']}]});
 expect(result.strategies?.ncav?.state).toBe('not_applicable');
 c.method.value='bank';
 const bank=evaluateCompany(c,policy,{strategy:'financial'});
 expect(bank.strategies?.financial_research?.conditions.some(c=>c.reason==='financial_method_not_supported')).toBe(false);
 expect(bank.strategies?.financial_research?.state).toBe('unknown');
});

function positiveEpsCompany():CompanyFacts {
 const c=completeCompany();
 c.facts=c.facts.filter(f=>!['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field));
 add(c,'casOrdinaryBasicEps',Array(5).fill(.20),`${c.currency}/share`);
 add(c,'casAdjustedOrdinaryBasicEps',Array(5).fill(.18),`${c.currency}/share`);
 return c;
}
it('preserves an ordinary amount conflict instead of bypassing it through positive EPS',()=>{
 const c=positiveEpsCompany();add(c,'ordinaryProfit',Array(5).fill(10));
 const f=c.facts.find(f=>f.id==='ordinaryProfit-2025')!;c.facts.push({...f,id:'profit-conflict',value:-10});
 expect(condition(c,'P1').state).toBe('pass');
 expect(condition(c,'P3').state).toBe('unknown');
});
it('identifies opposite signs between reported EPS and a directly sourced ordinary profit',()=>{
 const c=positiveEpsCompany();add(c,'ordinaryProfit',Array(5).fill(10));
 c.facts.find(f=>f.id==='casOrdinaryBasicEps-2025')!.value=-.20;
 expect(condition(c,'P1').state).toBe('pass');
 expect(condition(c,'P3').state).toBe('unknown');
});
it('does not discard a known positive ordinary amount just because EPS rounds to zero',()=>{
 const c=completeCompany();add(c,'casOrdinaryBasicEps',Array(5).fill(0),`${c.currency}/share`);
 expect(condition(c,'P1').state).toBe('pass');
});


it('does not let auxiliary financing absences or explicit zero balances block reported debt',()=>{
 const c=completeCompany(),source=c.facts.find(f=>f.field==='shortBorrowings')!;
 c.facts.push({...source,id:'absent-other',field:'classification.otherFinancingLiabilities',unit:'text',value:JSON.stringify({state:'absent',components:[]})});
 add(c,'additionalFinancing',[0],c.currency,2025);
 expect(condition(c,'N5').state).toBe('pass');
 c.facts.pop();c.facts.find(f=>f.id==='absent-other')!.value=JSON.stringify({state:'components',components:['otherPayables']});
 add(c,'otherPayables',[0],c.currency,2025);
 expect(condition(c,'N5').state).toBe('pass');
 c.facts.find(f=>f.field==='otherPayables')!.value=10;
 expect(condition(c,'N5').state).toBe('unknown');
});

it('requires a consistent adjustment of both reported earnings operands when a distribution is known',()=>{
 const c=completeCompany();c.facts=c.facts.filter(f=>!['ordinaryProfit','adjustedOrdinaryProfit'].includes(f.field));
 add(c,'nonordinaryProfitAllocation',[3],c.currency,2025);
 expect(condition(c,'P1').state).toBe('pass');
 expect(condition(c,'P3').state).toBe('unknown');
 add(c,'adjustedNonordinaryProfitAllocation',[3],c.currency,2025);
 expect(condition(c,'P3').value).toBeCloseTo(.06125);
 add(c,'ordinaryProfit',[8],c.currency,2025);
 expect(condition(c,'P3').state).toBe('unknown');
});


it('uses validated reported bank credit ratios without inventing a capital or liquidity scope',()=>{
 const c=c1Company();c.method.value='bank';
 const rows=[2023,2024,2025].map((year,i)=>({SECURITY_CODE:c.companyId,ORG_TYPE:'银行',REPORT_TYPE:'年报',REPORT_DATE:`${year}-12-31`,NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',NONPERLOAN:[.7,.8,.9][i],BLDKBBL:200}));
 c.facts.push(...parseCnStatementFacts({data:rows},{sourceId:'bank-api',entity:c.companyId,basis:c.basis,kind:'indicators'}).filter(f=>f.field.startsWith('reportedFinancial.')));
 const risk=()=>evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')!;
 expect(risk()).toMatchObject({state:'unknown',components:expect.arrayContaining([
  expect.objectContaining({id:'F.risk.loanNpl',state:'pass'}),
  expect.objectContaining({id:'F.risk.loanProvisionCoverage',state:'pass',value:2}),
  expect.objectContaining({id:'F.risk.nplTrend',state:'pass'}),
  expect.objectContaining({id:'F.risk.capital',state:'unknown'}),
  expect.objectContaining({id:'F.risk.liquidity',state:'unknown'}),
 ])});
 expect(risk().components?.find(r=>r.id==='F.risk.loanNpl')?.value).toBeCloseTo(.009);
 expect(c.facts.some(f=>f.field==='regulatory.context')).toBe(false);
 // Adding a capital/liquidity disclosure must not erase the usable API credit
 // observations or make their unchanged history depend on capital-rule versions.
 regulatoryPeriod(c,2025);
 const context=c.facts.find(f=>f.id==='context:2025:closing')!,payload=JSON.parse(String(context.value));
 delete payload.metrics.loanNpl;delete payload.metrics.loanProvisionCoverage;context.value=JSON.stringify(payload);
 expect(risk().components?.find(r=>r.id==='F.risk.loanNpl')?.state).toBe('pass');
 expect(risk().components?.find(r=>r.id==='F.risk.nplTrend')?.state).toBe('pass');
 c.facts.find(f=>f.field==='reportedFinancial.loanNpl'&&f.year===2025)!.value=.03;
 expect(risk()).toMatchObject({state:'fail',components:expect.arrayContaining([expect.objectContaining({id:'F.risk.loanNpl',state:'fail'})])});
});

it('evaluates disclosed bank LCR and NSFR separately from a capital context without bypassing bindings',()=>{
 const c=c1Company();c.method.value='bank';
 const lines=['监管指标 监管标准 2025 年 12 月 31 日 2024 年 12 月 31 日 2023 年 12 月 31 日',
  '流动性覆盖率(%) ≥100 144.79 190.00 244.48',
  '3、净稳定资金比例','项目 2025 年 12 月 31 日 2025 年 9 月 30 日',
  '可用的稳定资金 1,837,491 1,840,521','所需的稳定资金 1,780,594 1,728,861','净稳定资金比例 103.20% 106.46%'];
 const document={entity:c.companyId,publishedAt:'2026-03-01',periodEnd:'2025-12-31',pages:{'10':{lines,text:lines.join('\n')}}};
 c.facts.push(...parseCnDisclosureFacts(document,{sourceId:'ningbo-2025',basis:c.basis}));
 const risk=()=>evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')!;
 expect(risk().components).toEqual(expect.arrayContaining([
  expect.objectContaining({id:'F.risk.lcr',state:'pass'}),
  expect.objectContaining({id:'F.risk.nsfr',state:'fail',value:1.032}),
 ]));
 const p2=evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='P2')!;
 expect(p2.components?.find(r=>r.id==='P2.2023')?.components).toEqual(expect.arrayContaining([
  expect.objectContaining({id:'P2.2023.lcr',state:'pass',value:2.4448}),
  expect.objectContaining({id:'P2.2023.nsfr',state:'unknown'}),
 ]));
 // A separately disclosed capital context neither adopts these liquidity facts
 // nor changes their conclusion when it has no liquidity bindings.
 regulatoryPeriod(c,2025);
 const contextFact=c.facts.find(f=>f.id==='context:2025:closing')!,context=JSON.parse(String(contextFact.value));
 delete context.metrics.lcr;delete context.metrics.nsfr;context.liquidityMetrics=[];contextFact.value=JSON.stringify(context);
 expect(risk().components).toEqual(expect.arrayContaining([
  expect.objectContaining({id:'F.risk.lcr',state:'pass'}),
  expect.objectContaining({id:'F.risk.nsfr',state:'fail',value:1.032}),
 ]));
 // A malformed binding is relevant evidence and therefore cannot be bypassed
 // by the otherwise usable report value.
 context.metrics.lcr={definition:'high-quality-liquid-assets/net-cash-outflows-30d',direction:'minimum',actualFactId:'missing-bound-lcr'};contextFact.value=JSON.stringify(context);
 expect(risk().components?.find(r=>r.id==='F.risk.lcr')).toMatchObject({state:'unknown'});
});

it('honors stricter and rejects malformed reported bank liquidity requirements independently',()=>{
 const c=c1Company();c.method.value='bank';
 const lines=['监管指标 监管标准 2025 年 12 月 31 日 2024 年 12 月 31 日 2023 年 12 月 31 日',
  '流动性覆盖率(%) ≥100 144.79 190.00 244.48',
  '3、净稳定资金比例','项目 2025 年 12 月 31 日 2025 年 9 月 30 日',
  '可用的稳定资金 1,837,491 1,840,521','所需的稳定资金 1,780,594 1,728,861','净稳定资金比例 120.00% 106.46%'];
 const document={entity:c.companyId,publishedAt:'2026-03-01',periodEnd:'2025-12-31',pages:{'10':{lines,text:lines.join('\n')}}};
 c.facts.push(...parseCnDisclosureFacts(document,{sourceId:'bank-report',basis:c.basis}));
 const risk=()=>evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')!;
 const requirement=c.facts.find(f=>f.field==='reportedFinancial.requirement.lcr')!;
 requirement.value=1.5;
 expect(risk().components?.find(r=>r.id==='F.risk.lcr')).toMatchObject({state:'fail',components:expect.arrayContaining([expect.objectContaining({id:'F.risk.lcr.requirement',state:'fail'})])});
 requirement.reason='direction:maximum';
 expect(risk().components?.find(r=>r.id==='F.risk.lcr')).toMatchObject({state:'unknown',components:expect.arrayContaining([expect.objectContaining({id:'F.risk.lcr.requirement',state:'unknown'})])});
});

it('keeps missing, invalid and conflicting reported credit history unknown and rejects another method',()=>{
 const c=c1Company();c.method.value='bank';
 const row={SECURITY_CODE:c.companyId,ORG_TYPE:'银行',REPORT_TYPE:'年报',REPORT_DATE:'2025-12-31',NOTICE_DATE:'2026-03-01',CURRENCY:'CNY',NONPERLOAN:.9,BLDKBBL:200};
 const parsed=parseCnStatementFacts({data:[row]},{sourceId:'bank-api',entity:c.companyId,basis:c.basis,kind:'indicators'}).filter(f=>f.field.startsWith('reportedFinancial.'));
 c.facts.push(...parsed);
 const risk=()=>evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')!;
 expect(risk().components?.find(r=>r.id==='F.risk.nplTrend')?.state).toBe('unknown');
 const npl=c.facts.find(f=>f.field==='reportedFinancial.loanNpl')!;
 c.facts.push({...npl,id:'conflicting-npl',value:.03});
 expect(risk().components?.find(r=>r.id==='F.risk.loanNpl')?.state).toBe('unknown');
 c.facts=c.facts.filter(f=>f.id!=='conflicting-npl');npl.value=-.01;
 expect(risk().components?.find(r=>r.id==='F.risk.loanNpl')?.state).toBe('unknown');
 c.method.value='financial_lease';expect(risk().components?.find(r=>r.id==='F.risk.leaseNpl')?.state).toBe('unknown');
 expect(risk().components?.some(r=>r.id==='F.risk.loanNpl')).toBe(false);
});


it('does not expand bank or lease P2 into historical credit floors beyond the base credit window',()=>{
 for(const method of ['bank','financial_lease'] as const) {
  const c=regulatedCompany(method);for(const year of [2023,2024,2025]) regulatoryPeriod(c,year);
  const provision=method==='bank'?'loanProvisionCoverage':'leaseProvisionCoverage';
  for(const year of [2023,2024]) c.facts=c.facts.filter(f=>f.id!==`reg:${year}:closing:${provision}:actual`);
  const result=evaluateCompany(c,policy,{evaluateAll:true});
  expect(result.conditions.find(r=>r.id==='F.risk')?.state).toBe('pass');
  expect(result.conditions.find(r=>r.id==='P2')?.state).toBe('pass');
  c.facts=c.facts.filter(f=>f.id!==`reg:2025:closing:${provision}:actual`);
  expect(evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')?.state).toBe('unknown');
 }
});


it('uses already supported lease report credit observations independently of capital and keeps bound conflicts',()=>{
 const c=c1Company();c.method.value='financial_lease';
 const lines=['2025 年末 2024 年末 本期末比上年同期末增减 2023 年末','融资租赁资产质量指标',
  '不良融资租赁资产率（%） 0.88 0.91 减少 0.03 个百分点 0.91',
  '拨备覆盖率（%） 421.22 430.27 减少 9.05 个百分点 448.39'];
 const document={entity:c.companyId,publishedAt:'2026-03-01',periodEnd:'2025-12-31',pages:{'14':{lines,text:lines.join('\n')}}};
 c.facts.push(...parseCnDisclosureFacts(document,{sourceId:'lease-report',basis:c.basis}));
 const risk=()=>evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')!;
 expect(risk().components?.find(r=>r.id==='F.risk.leaseNpl')).toMatchObject({state:'pass',value:.0088});
 expect(risk().components?.find(r=>r.id==='F.risk.leaseProvisionCoverage')).toMatchObject({state:'pass'});
 expect(risk().components?.find(r=>r.id==='F.risk.nplTrend')).toMatchObject({state:'pass',factIds:expect.arrayContaining([expect.stringContaining(':2024:')])});
 expect(risk().components?.find(r=>r.id==='F.risk.nplTrend')?.value).toBeCloseTo(-.0003);
 expect(risk().state).toBe('unknown'); // Capital/liquidity remain necessary.
 regulatoryPeriod(c,2025);
 const fact=c.facts.find(f=>f.id==='context:2025:closing')!,context=JSON.parse(String(fact.value));
 delete context.metrics.leaseNpl;delete context.metrics.leaseProvisionCoverage;fact.value=JSON.stringify(context);
 expect(risk().components?.find(r=>r.id==='F.risk.leaseNpl')?.state).toBe('pass');
 context.metrics.leaseNpl={definition:'nonperforming-finance-lease-assets/gross-finance-lease-assets',direction:'maximum',actualFactId:'missing-bound-value'};fact.value=JSON.stringify(context);
 expect(risk().components?.find(r=>r.id==='F.risk.leaseNpl')?.state).toBe('unknown');
 c.facts.push({...fact,id:'conflicting-context',value:JSON.stringify({...context,scope:'legal_entity'})});
 expect(risk().state).toBe('unknown');expect(risk().components).toBeUndefined();
});

it('honors disclosed stricter credit requirements without needing a capital regime',()=>{
 const c=c1Company();c.method.value='bank';
 const lines=['监管指标 监管标准 2025 年 12 月 31 日 2024 年 12 月 31 日 2023 年 12 月 31 日',
  '不良贷款比率(%) ≤0.5 0.76 0.76 0.76','拨备覆盖率(%) ≥400 373.16 389.35 461.04'];
 const document={entity:c.companyId,publishedAt:'2026-03-01',periodEnd:'2025-12-31',pages:{'1':{lines,text:lines.join('\n')}}};
 c.facts.push(...parseCnDisclosureFacts(document,{sourceId:'bank-report',basis:c.basis}));
 const risk=()=>evaluateCompany(c,policy,{evaluateAll:true}).conditions.find(r=>r.id==='F.risk')!;
 expect(risk().components?.find(r=>r.id==='F.risk.loanNpl')?.state).toBe('fail');
 expect(risk().components?.find(r=>r.id==='F.risk.loanProvisionCoverage')?.state).toBe('fail');
 const req=c.facts.find(f=>f.field==='reportedFinancial.requirement.loanNpl')!;req.reason='direction:minimum';
 expect(risk().components?.find(r=>r.id==='F.risk.loanNpl')?.state).toBe('unknown');
});


it.each(['unresolved','stale'] as const)('uses final guarded conditions for research aggregation: %s',scenario=>{
 const c=completeCompany();
 // An apparent failure must not survive a method or freshness guard.
 for(const f of c.facts)if(f.field==='adjustedWeightedRoe')f.value=.01;
 if(scenario==='unresolved')c.method={state:'unresolved',evidence:[]};
 else c.asOf='2030-01-01';
 for(const options of [{evaluateAll:true},{strategy:'financial' as const}]) {
  const result=evaluateCompany(c,policy,options);
  expect(result).toMatchObject({quality:'unknown',research:'unknown',priority:'unknown'});
  expect(result.conditions.find(r=>r.id==='P0')?.state).toBe('unknown');
  expect(result.conditions.filter(r=>['P1','P2'].includes(r.id)).every(r=>r.state===('evaluateAll' in options?'unknown':'not_evaluated'))).toBe(true);
 }
});

it.each(['pending','interrupted'] as const)('preserves an explicit unprocessed financial state: %s',state=>{
 const c=completeCompany();c.method={...c.method,value:'bank'};
 c.collection={state,requests:0,errors:[]};
 const result=evaluateCompany(c,policy,{strategy:'financial'});
 expect(result.strategies?.financial_research).toMatchObject({state:'not_evaluated',applicability:'unknown'});
 expect(result.strategies?.financial_value?.state).toBe('not_evaluated');
 expect(result.conditions).toEqual([]);
 const summary=evaluateCompanies([c],policy,30,{strategy:'financial'}).summary;
 expect(summary.coverage.byMethod.bank.researchKnown).toBe(0);
});

it('does not emit unselected financial strategies on quality early exit',()=>{
 const c=company([-10,-10,-10,-10,-10]);
 expect(evaluateCompany(c,policy,{strategy:'quality'}).strategies).toBeUndefined();
});

it.each(['unknown','fail'] as const)('preserves nonfinancial quality %s and downstream early stops in all mode',state=>{
 const c=c1Company();
 if(state==='unknown') c.facts=c.facts.filter(f=>f.field!=='operatingCashFlow');
 else for(const f of c.facts) if(f.field==='parentProfit') f.value=-1;
 for(const f of c.facts) if(f.field==='weightedRoe'||f.field==='adjustedWeightedRoe') f.value=.13;
 const quality=evaluateCompany(c,policy,{strategy:'quality'});
 const all=evaluateCompany(c,policy,{strategy:'all'});
 expect(quality.quality).toBe(state);
 expect(all.conditions).toEqual(quality.conditions);
 expect([all.quality,all.research,all.priority]).toEqual([quality.quality,quality.research,quality.priority]);
 expect(all.conditions.find(c=>c.id==='P1')?.state).toBe('not_evaluated');
 expect(all.strategies?.financial_research?.state).toBe('not_applicable');
 expect(all.strategies?.ncav).toBeDefined();
});

it.each([
  [8.75, 'undervalued'],
  [10, 'normal'],
  [14, 'normal'],
  [20, 'expensive'],
] as const)('classifies research price %s as %s without cancelling research qualification', (price, band) => {
  const c = completeCompany();
  c.facts.find(f => f.field === 'price')!.value = price;
  const p = structuredClone(policy); p.priority.normalEarningsYield = .05;
  const r = evaluateCompany(c, p, {strategy: 'all'});
  expect(r.research).toBe('pass');
  expect(r.researchRanking).toMatchObject({priceBand: band, priceCondition: 'P3', normalYield: .05, lowPriceYield: .08});
  expect(r.researchRanking?.earningsYield).toBeCloseTo(.7 / price, 12);
});

it('keeps a missing or unverified price unknown even for a qualified company', () => {
  const c = completeCompany();
  c.lastCompletedTradingDay = '2026-09-07';
  const r = evaluateCompany(c, policy, {strategy: 'all'});
  expect(r.research).toBe('pass');
  expect(r.researchRanking).toMatchObject({priceBand: 'unknown'});
  expect(r.researchRanking?.earningsYield).toBeUndefined();
});

it('orders the main list by price class, then sustained return, then price within that class', () => {
  const rows = [
    ['A', 'unknown', .50, undefined],
    ['B', 'expensive', .40, .03],
    ['C', 'normal', .20, .06],
    ['D', 'normal', .25, .05],
    ['E', 'normal', .25, .07],
    ['Z', 'undervalued', .18, .09],
  ] as const;
  const acc = createEvaluationAccumulator(4, 'all', 5);
  for (const [ticker, priceBand, returnMedian, earningsYield] of rows)
    acc.accept(evaluation({ticker, companyId: ticker, priority: priceBand === 'undervalued' ? 'pass' : 'fail',
      researchRanking: {priceBand, returnMedian, earningsYield, priceCondition: 'P3', returnCondition: 'P1.return', normalYield: .05, lowPriceYield: .08}}));
  const result = acc.finish();
  expect(result.researchCandidates).toEqual(['CN:Z','CN:E','CN:D','CN:C','CN:B','CN:A']);
  expect(result.displayed).toEqual(['CN:Z','CN:E','CN:D','CN:C']);
  expect(result.candidateQueue.find(r => r.id === 'CN:A')).toMatchObject({displayed:false, reason:'main_limit', ranking:{priceBand:'unknown'}});
});

// Interim amounts stay outside annual thresholds, including adverse or unavailable observations.
function recentRows(current: number | null = 80, prior = 100) {
  return { result: { pages: 1, data: [2026, 2025].map((year, i) => ({
    SECURITY_CODE: 'test', ORG_TYPE: '通用', CURRENCY: 'CNY', REPORT_TYPE: '中报',
    REPORT_DATE: `${year}-06-30`, NOTICE_DATE: '2026-08-20', UPDATE_DATE: '2026-08-20',
    TOTALOPERATEREVE: i ? prior : current, PARENTNETPROFIT: i ? 10 : 12,
    KCFJCXSYJLR: i ? 10 : 8, NETCASH_OPERATE_PK: i ? prior : current,
  })) } };
}
function withRecent(body = recentRows()) {
  const c = completeCompany();
  c.facts.push(...parseCnRecentFinancialFacts(body, {sourceId:'interim', entity:c.companyId, basis:c.basis}));
  return c;
}
it('reports comparable interim amounts and profit divergence without changing any strategy or ordering', () => {
  const baseline = completeCompany(), c = withRecent();
  const before = evaluateCompanies([baseline], policy, 30, {strategy:'all'});
  const after = evaluateCompanies([c], policy, 30, {strategy:'all'});
  expect(after.summary).toEqual(before.summary);
  const r = evaluateCompany(c, policy, {strategy:'all'}), b = evaluateCompany(baseline, policy, {strategy:'all'});
  const {recentFinancials: _, ...rest} = r, {recentFinancials: __, ...original} = b;
  expect(rest).toEqual(original);
  expect(r.recentFinancials).toMatchObject({state:'complete',period:{start:'2026-01-01',end:'2026-06-30'},priorPeriod:{start:'2025-01-01',end:'2025-06-30'}});
  expect(r.recentFinancials?.metrics[0]).toMatchObject({current:80,prior:100,change:-20,yoy:-.2,factIds:expect.arrayContaining(['interim:0:recent.revenue','interim:1:recent.revenue'])});
  expect(r.recentFinancials?.hints).toContain('parent_profit_up_adjusted_profit_down');
  expect(b.recentFinancials).toMatchObject({state:'missing',metrics:[],hints:[]});
  c.method = {state:'applies',value:'bank',evidence:[]};
  expect(evaluateCompany(c,policy,{strategy:'all'}).recentFinancials).toBeUndefined();
});
it.each([0,-100])('does not emit an ordinary percentage when the comparison base is %s', prior => {
  const m = recentFinancialChanges(withRecent(recentRows(-120,prior))).metrics[0];
  expect(m).toMatchObject({state:'complete',current:-120,prior,change:-120-prior,yoyReason:'nonpositive_prior'});
  expect(m.yoy).toBeUndefined();
});
it('retains missing, stale and conflicting interim evidence rather than falling back to a favourable period', () => {
  expect(recentFinancialChanges(withRecent(recentRows(null)))).toMatchObject({state:'missing'});
  const c=withRecent(); c.asOf='2026-11-01';
  expect(recentFinancialChanges(c)).toMatchObject({state:'stale',reason:'latest_expected_report_unavailable'});
  c.asOf='2026-09-09';
  const old=c.facts.find(f=>f.id==='interim:0:recent.revenue')!;
  c.facts.push({...old,id:'contradiction',value:81});
  expect(recentFinancialChanges(c).metrics[0]).toMatchObject({state:'conflicting'});
  expect(recentFinancialChanges(c).metrics[0].yoy).toBeUndefined();
  c.facts.at(-1)!.publishedAt='2026-09-01';
  expect(recentFinancialChanges(c).metrics[0]).toMatchObject({state:'complete',current:81});
  c.facts.at(-1)!.publishedAt='2026-10-01';
  expect(recentFinancialChanges(c).metrics[0]).toMatchObject({state:'complete',current:80});
});
it('requires the same cumulative period and valid issuer/currency metadata', () => {
  const c=withRecent();
  c.facts=c.facts.filter(f=>f.period.end!=='2025-06-30');
  expect(recentFinancialChanges(c).metrics.every(m=>m.state==='missing')).toBe(true);
  const body=recentRows();body.result.data[0].CURRENCY='USD';
  expect(recentFinancialChanges(withRecent(body)).state).toBe('conflicting');
  body.result.data[0].SECURITY_CODE='other';
  expect(()=>withRecent(body)).toThrow(/entity/);
  const wrong=recentRows();wrong.result.data[0].REPORT_TYPE='一季报';
  expect(()=>withRecent(wrong)).toThrow(/period/);
  expect(parseCnStatementFacts(recentRows(),{sourceId:'annual',entity:'test',basis:'test',kind:'indicators'})).toEqual([]);
});

it('does not advance the annual screening window using an auxiliary annual row', () => {
 const c=withRecent();c.asOf='2027-04-01';
 const example=c.facts.find(f=>f.field==='recent.parentProfit')!;
 c.facts.push({...example,id:'next-year-recent',year:2026,period:{start:'2026-01-01',end:'2026-12-31'},publishedAt:'2027-03-01'});
 expect(latestDisclosedFiscalYear(c)).toBe(2025);
});
