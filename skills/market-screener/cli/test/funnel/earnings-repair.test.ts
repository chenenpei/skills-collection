import { beforeAll, expect, it } from 'vitest';
import { evaluateCompany, createEvaluationAccumulator } from '../../src/cn/screening.js';
import { loadCnPolicy, type CnPolicy } from '../../src/policy/loader.js';
import { parseCnStatementFacts } from '../../src/cn/sources/market-data.js';
import type { CompanyFacts } from '../../src/shared/financial-model.js';
let policy: CnPolicy;
beforeAll(async () => { policy = await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml', import.meta.url).pathname); });
function company(): CompanyFacts {
  const c: CompanyFacts = { ticker: '600001', companyId: '600001', companyName: 'Synthetic repair', market: 'CN', currency: 'CNY',
    asOf: '2026-09-11T12:00:00Z', quoteDate: '2026-09-11', lastCompletedTradingDay: '2026-09-11', latestFiscalYear: 2025, basis: 'test',
    method: { state: 'applies', value: 'nonfinancial', evidence: ['synthetic'], coverage: { start: '2019-01-01', end: '2025-12-31' } }, checks: {}, facts: [] };
  const rows = Array.from({ length: 7 }, (_, i) => ({ SECURITY_CODE: c.ticker, REPORT_TYPE: '年报', REPORT_DATE: `${2019+i}-12-31`, NOTICE_DATE: '2026-03-01', CURRENCY: 'CNY', ORG_TYPE: '通用', PARENTNETPROFIT: 10, KCFJCXSYJLR: 10, ROEJQ: 2, ROEKCJQ: 2, EPSJB: 1, EPSKCJB: 1 }));
  c.facts = parseCnStatementFacts({ data: rows }, { sourceId: 'synthetic', entity: c.companyId, basis: c.basis, kind: 'indicators', sourceUrl: 'https://example.test/indicators' });
  const add = (field: string, value: number | string, unit: string, date: string) => c.facts.push({ id: field, field, value, unit, year: Number(date.slice(0,4)), entity: c.companyId, basis: c.basis, state: 'observed', period: field.startsWith('quote.') ? { start: '2026-09-11T08:00:00Z', end: '2026-09-11T08:00:00Z' } : { start: date, end: date }, publishedAt: '2026-09-11T08:00:00Z', evidence: [{ sourceId: 'synthetic', locator: field, raw: value }] });
  for (const [field,value] of Object.entries({ parentEquity: 100, equity: 100, currentAssets: 50, liabilities: 60, minorityEquity: 0, nonordinaryEquity: 0 })) add(field,value,'CNY','2025-12-31');
  add('price',7,'CNY/share','2026-09-11'); add('ordinaryShares',10,'shares','2026-09-11');
  add('quote.shareStructure',JSON.stringify({ effectiveDate: '2024-12-01', announcedAt: '2024-12-01', totalShares: 10, aShares: 10, bShares: null, restrictedBShares: null, hShares: null, restrictedHShares: null, otherShares: null, preferredShares: null, changeReason: '上市' }),'text','2026-09-11');
  return c;
}
const repair = (c: CompanyFacts) => evaluateCompany(c,policy,{strategy:'all'}).strategies!.earnings_repair!;
it('admits seven-year earnings repair despite low quality and a failed NCAV, with a reproducible price boundary', () => {
 const c=company(), r=evaluateCompany(c,policy,{strategy:'all'});
 expect(r.quality).toBe('fail'); expect(r.strategies!.ncav!.state).toBe('fail'); expect(r.strategies!.earnings_repair!.state).toBe('pass');
 expect(repair(c).signal?.value).toBeCloseTo(.1);
 expect(repair(c).conditions.find(x=>x.id==='ER.history')?.calculations).toHaveLength(7);
 c.facts.find(f=>f.field==='price')!.value=8.75; expect(repair(c).state).toBe('pass');
 c.facts.find(f=>f.field==='price')!.value=8.751; expect(repair(c).state).toBe('fail');
});
it.each(['missing year','missing adjusted profit','quote date','ownership conflict','stale annual','future method'])('keeps %s unknown instead of inventing a passing value', kind => {
 const c=company();
 if(kind==='missing year') c.facts=c.facts.filter(f=>f.year!==2019);
 if(kind==='missing adjusted profit') c.facts=c.facts.filter(f=>!(f.field==='reportedAdjustedParentProfit'&&f.year===2025));
 if(kind==='quote date') c.quoteDate='2026-09-10';
 if(kind==='ownership conflict') c.checks.earnings={state:'unresolved',evidence:['conflict']};
 if(kind==='stale annual') c.asOf='2027-07-01';
 if(kind==='future method') c.method.coverage!.start='2026-01-01';
 expect(repair(c).state).toBe('unknown');
});
it('permits two historical loss years, rejects three and never capitalizes only a peak year', () => {
 const c=company();
 for(const f of c.facts) if(['parentProfit','reportedAdjustedParentProfit','casOrdinaryBasicEps','casAdjustedOrdinaryBasicEps'].includes(f.field)&&f.year<=2020) f.value=-1;
 expect(repair(c).state).toBe('pass');
 for(const f of c.facts) if(['parentProfit','reportedAdjustedParentProfit','casOrdinaryBasicEps','casAdjustedOrdinaryBasicEps'].includes(f.field)&&f.year===2021) f.value=-1;
 expect(repair(c).state).toBe('fail');
 const peak=company(); for(const f of peak.facts) if(['parentProfit','reportedAdjustedParentProfit'].includes(f.field)&&f.year===2025) f.value=1000;
 expect(repair(peak).signal?.value).toBeCloseTo(.1);
});
it('does not apply nonfinancial repair to finance or silently resolve an unknown route', () => {
 const c=company(); c.method.value='bank'; expect(repair(c).state).toBe('not_applicable');
 c.method.state='unresolved'; expect(repair(c).state).toBe('unknown');
});
it('retains all strategy hits while NCAV consumes only one shared backup seat', () => {
 const c=company(); c.facts.find(f=>f.field==='currentAssets')!.value=200;
 const r=evaluateCompany(c,policy,{strategy:'all'}); expect(r.strategies!.ncav!.state).toBe('pass'); expect(r.strategies!.earnings_repair!.state).toBe('pass');
 const a=createEvaluationAccumulator(30,'all',1);a.accept(r);const s=a.finish();
 expect(s.backupDisplayed).toEqual(['CN:600001']);expect(s.candidateQueue[0].backupStrategy).toBe('ncav');
 expect(s.strategies!.earnings_repair!.qualified).toEqual(['CN:600001']);
});

it.each(['alternate basis','future period'])('ignores %s operands when selecting a valid quote year', kind => {
 const c=company();
 for(const field of ['price','ordinaryShares']) {
  const f=c.facts.find(f=>f.field===field)!;
  c.facts.push({...f,id:`irrelevant:${field}`,year:2027,period:{start:'2027-01-01',end:'2027-01-01'},
   ...(kind==='alternate basis'?{basis:'another basis',period:{start:'2026-09-11T01:00:00Z',end:'2026-09-11T01:00:00Z'}}:{})});
 }
 expect(repair(c).state).toBe('pass');
 expect(repair(c).signal?.value).toBeCloseTo(.1);
});
it('excludes a known nonstandard audit without requiring an audit opinion for every candidate', () => {
 const c=company();expect(repair(c).state).toBe('pass');
 const f=c.facts.find(f=>f.field==='parentEquity')!;
 c.facts.push({...f,id:'audit',field:'auditOpinion',unit:'text',value:'qualified'});
 expect(repair(c).state).toBe('fail');
});
