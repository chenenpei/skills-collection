import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { parseCnStatementFacts } from '../../src/cn/sources/market-data.js';
import { evaluateCompanies, evaluateCompany } from '../../src/cn/screening.js';
import { loadCnPolicy, type CnPolicy } from '../../src/policy/loader.js';
import type { CompanyFacts, FinancialFact } from '../../src/shared/financial-model.js';

let policy: CnPolicy;
const asOf = '2026-09-10';
const annual = { start: '2025-12-31', end: '2025-12-31' };
const methodCoverage = { start: '2025-01-01', end: '2025-12-31' };

beforeAll(async () => {
  policy = await loadCnPolicy(new URL('../../src/policy/cn-screening.yaml', import.meta.url).pathname);
});

function fact(c: CompanyFacts, field: string, value: number | string, unit = 'CNY', year = 2025): FinancialFact {
  const period = ['price','ordinaryShares'].includes(field) ? { start: '2026-09-09', end: '2026-09-09' } : field==='parentProfit' ? {start:`${year}-01-01`,end:`${year}-12-31`} : {...annual};
  const item: FinancialFact = {
    id: `${c.ticker}:${field}:${year}`, field, entity: c.companyId, year, period,
    publishedAt: year <= 2025 ? '2026-03-01' : '2026-09-09', basis: c.basis, unit,
    state: 'observed', value, evidence: [{ sourceId: 'synthetic', locator: `/${field}`, raw: value }],
  };
  c.facts.push(item);
  return item;
}

function ncavCompany(ticker = 'NCAV', values = { currentAssets: 100, liabilities: 20, minorityEquity: 10, nonordinaryEquity: 5, marketCap: 40 }): CompanyFacts {
  const c: CompanyFacts = {
    ticker, companyId: ticker, companyName: `Synthetic ${ticker}`, market: 'CN', currency: 'CNY', asOf,
    latestFiscalYear: 2025, quoteDate: '2026-09-09', lastCompletedTradingDay: '2026-09-09', basis: 'ncav-test',
    method: { state: 'applies', value: 'nonfinancial', coverage: methodCoverage, evidence: ['review:method'] },
    checks: { quote: { state: 'applies', coverage: { start: asOf, end: asOf }, evidence: ['review:quote'] } }, facts: [],
  };
  fact(c, 'currentAssets', values.currentAssets);
  fact(c, 'liabilities', values.liabilities);
  fact(c, 'minorityEquity', values.minorityEquity);
  fact(c, 'nonordinaryEquity', values.nonordinaryEquity);
  fact(c, 'price', values.marketCap / 10, 'CNY/share', 2026);
  fact(c, 'ordinaryShares', 10, 'shares', 2026);
  const at = '2026-09-09T15:01:00+08:00';
  const structure = { effectiveDate: '2026-01-01', announcedAt: '2026-09-09', totalShares: 10, aShares: 10, bShares: null, restrictedBShares: null, hShares: null, restrictedHShares: null, otherShares: null, preferredShares: null, changeReason: 'synthetic' };
  c.facts.push({ id: `${ticker}:share-structure`, field: 'quote.shareStructure', entity: c.companyId, year: 2026, period: { start: at, end: at }, publishedAt: at, basis: c.basis, unit: 'text', state: 'observed', value: JSON.stringify(structure), evidence: [{ sourceId: 'synthetic', locator: '/share-structure', raw: structure }] });
  return c;
}

function ncav(c: CompanyFacts) {
  return evaluateCompany(c, policy, { strategy: 'ncav' }).strategies!.ncav!;
}

describe('independent NCAV evaluation', () => {
  it('uses the reported formula and the inclusive two-thirds market-cap boundary', () => {
    const c = ncavCompany('BOUNDARY', { currentAssets: 100, liabilities: 20, minorityEquity: 10, nonordinaryEquity: 5, marketCap: 65 * 2 / 3 });
    const result = ncav(c);
    expect(result).toMatchObject({ id: 'ncav', applicability: 'pass', state: 'pass', signal: { name: 'ncav_to_market_cap' } });
    expect(result.signal?.value).toBeCloseTo(1.5,12);
    expect(result.conditions).toMatchObject([
      { id: 'NCAV.assets', state: 'pass', value: 65, formula: 'CA - L - max(NCI,0) - reported other equity tools' },
      { id: 'NCAV.discount', state: 'pass', formula: `${policy.strategies!.ncav!.marketCapRatio} * NCAV_reported - same-rights ordinary market cap` },
    ]);

    const tooExpensive = ncavCompany('FAIL', { currentAssets: 100, liabilities: 20, minorityEquity: 10, nonordinaryEquity: 5, marketCap: 44 });
    expect(ncav(tooExpensive)).toMatchObject({ state: 'fail' });
    expect(ncav(tooExpensive).conditions.find(x => x.id === 'NCAV.discount')).toMatchObject({ state: 'fail' });
  });

  it('never treats an omitted equity operand as zero: its one-sided NCAV result can only fail or remain unknown', () => {
    const upperBoundFailure = ncavCompany('UPPER-FAIL', { currentAssets: 10, liabilities: 20, minorityEquity: 0, nonordinaryEquity: 0, marketCap: 40 });
    upperBoundFailure.facts = upperBoundFailure.facts.filter(f => f.field !== 'nonordinaryEquity');
    expect(ncav(upperBoundFailure)).toMatchObject({ state: 'fail' });
    expect(ncav(upperBoundFailure).conditions.find(x => x.id === 'NCAV.assets')).toMatchObject({ state: 'fail', proof: 'bound', bounds: { upper: -10 } });

    const unresolvedUpperBound = ncavCompany('UPPER-UNKNOWN');
    unresolvedUpperBound.facts = unresolvedUpperBound.facts.filter(f => f.field !== 'nonordinaryEquity');
    expect(ncav(unresolvedUpperBound)).toMatchObject({ state: 'unknown' });
    expect(ncav(unresolvedUpperBound).conditions.find(x => x.id === 'NCAV.assets')).toMatchObject({ state: 'unknown', proof: 'bound' });
  });

  it('does not add back negative minority equity, and subtracts reported other equity only once', () => {
    const c = ncavCompany('NEGATIVE-NCI', { currentAssets: 100, liabilities: 20, minorityEquity: -10, nonordinaryEquity: 5, marketCap: 40 });
    expect(ncav(c).conditions.find(x => x.id === 'NCAV.assets')).toMatchObject({ state: 'pass', value: 75 });

    fact(c, 'preferredEquity', 6);
    expect(ncav(c)).toMatchObject({ state: 'unknown' });
    expect(ncav(c).conditions.find(x => x.id === 'NCAV.assets')).toMatchObject({ reason: 'ncav_equity_total_conflict' });
  });

  it.each([
    ['wrong amount unit', (c: CompanyFacts) => { c.facts.find(f => f.field === 'currentAssets')!.unit = 'USD'; }],
    ['wrong annual period', (c: CompanyFacts) => { c.facts.find(f => f.field === 'liabilities')!.period.end = '2025-12-30'; }],
    ['future publication', (c: CompanyFacts) => { c.facts.find(f => f.field === 'minorityEquity')!.publishedAt = '2027-01-01'; }],
    ['stale annual financials', (c: CompanyFacts) => { c.asOf = '2028-01-01'; }],
  ])('keeps NCAV unresolved for %s', (_name, mutate) => {
    const c = ncavCompany();
    mutate(c);
    expect(ncav(c)).toMatchObject({ state: 'unknown' });
  });

  it('marks financial methods not applicable, mixed routing unresolved, and incomplete collection not evaluated', () => {
    const financial = ncavCompany();
    financial.method.value = 'bank';
    expect(ncav(financial)).toMatchObject({ applicability: 'not_applicable', state: 'not_applicable' });

    const mixed = ncavCompany();
    mixed.method.value = 'mixed';
    expect(ncav(mixed)).toMatchObject({ applicability: 'unknown', state: 'unknown' });
    expect(ncav(mixed).conditions[0]).toMatchObject({ id: 'NCAV.method', reason: 'method_pending' });

    const pending = ncavCompany();
    pending.collection = { state: 'pending', requests: 0, errors: [] };
    expect(ncav(pending)).toMatchObject({ applicability: 'unknown', state: 'not_evaluated' });
  });

  it.each(['银行', '证券', '保险'])('excludes a reliably reported %s statement family without requiring further financial-method routing', (family) => {
    const c = ncavCompany(`FAMILY-${family}`);
    c.method = { state: 'unresolved', evidence: [], reason: 'bank_or_nonbank_credit_entity_unresolved' };
    c.facts.push({ id: `${c.ticker}:statement-family`, field: 'statementFamily', entity: c.companyId, year: 2025, period: {...annual}, publishedAt: '2026-03-01', basis: c.basis, unit: 'text', state: 'observed', value: family, evidence: [{ sourceId: 'annual-balance', locator: '/data/0/ORG_TYPE', raw: family }] });
    expect(ncav(c)).toMatchObject({ applicability: 'not_applicable', state: 'not_applicable' });
  });

  it('does not require cash, capital, or segment reviews, but blocks a sourced NCAV-core conflict', () => {
    const independent = ncavCompany();
    expect(independent.checks.cash).toBeUndefined();
    expect(independent.checks.capital).toBeUndefined();
    expect(independent.facts.some(f => f.field.startsWith('business.'))).toBe(false);
    expect(ncav(independent)).toMatchObject({ state: 'pass' });

    independent.checks.ncav = { state: 'unresolved', coverage: methodCoverage, evidence: ['review:ncav-conflict'] };
    expect(ncav(independent)).toMatchObject({ state: 'unknown' });
    expect(ncav(independent).conditions[0]).toMatchObject({ id: 'NCAV.assets', reason: 'ncav_core_conflict', factIds: expect.arrayContaining(['review:ncav-conflict']) });
  });

  it('can pass NCAV even where the retained quality funnel is known to fail', () => {
    const c = ncavCompany();
    for (const year of [2021, 2022, 2023, 2024, 2025]) fact(c, 'parentProfit', -1, 'CNY', year);
    const result = evaluateCompany(c, policy, { strategy: 'ncav' });
    expect(result.quality).toBe('fail');
    expect(result.strategies?.ncav).toMatchObject({ state: 'pass' });
  });

  it('keeps per-strategy qualification sets separate while the all-strategy union de-duplicates the displayed company', () => {
    const first = ncavCompany('NCAV-A');
    const duplicate = ncavCompany('NCAV-B', { currentAssets: 120, liabilities: 20, minorityEquity: 0, nonordinaryEquity: 0, marketCap: 40 });
    duplicate.companyId = first.companyId;
    for (const f of duplicate.facts) f.entity = duplicate.companyId;
    const { results, summary } = evaluateCompanies([first, duplicate], policy, 30, { strategy: 'all' });
    expect(results.map(r => r.strategies?.ncav?.state)).toEqual(['pass', 'pass']);
    expect(summary.strategies?.ncav).toMatchObject({ qualified: ['CN:NCAV-B', 'CN:NCAV-A'], displayed: ['CN:NCAV-B', 'CN:NCAV-A'] });
    expect(summary.researchCandidates).toEqual([]);
    expect(summary.backupCandidates).toEqual(['CN:NCAV-B']);
    expect(summary.displayed).toEqual(['CN:NCAV-B']);
  });

  it('maps captured EastMoney NCAV operands without treating null reported OET as zero', async () => {
    const fixture = JSON.parse(await fs.readFile(new URL('../fixtures/ncav-balance-rows.json', import.meta.url), 'utf8'));
    for (const raw of fixture.statements) {
      const ticker = raw.ticker;
      const parsed = parseCnStatementFacts(raw, { sourceId: `balance-${ticker}`, entity: ticker, basis: 'raw-v1', kind: 'balance' });
      const year = 2025;
      const value = (field: string) => parsed.find(f => f.field === field && f.year === year)!;
      const ca = value('currentAssets'), liabilities = value('liabilities'), nci = value('minorityEquity'), tools = value('nonordinaryEquity');
      expect(ca).toMatchObject({ state: 'observed', unit: 'CNY', evidence: [{ sourceId: `balance-${ticker}`, locator: expect.stringMatching(/TOTAL_CURRENT_ASSETS$/) }] });
      expect(liabilities).toMatchObject({ state: 'observed', unit: 'CNY' });
      expect(nci).toMatchObject({ state: 'observed', unit: 'CNY' });
      expect(tools).toMatchObject({ state: 'missing', evidence: [{ raw: null }] });
      const upper = Number(ca.value) - Number(liabilities.value) - Math.max(Number(nci.value), 0);
      expect(upper).toBeGreaterThan(0);

      const c = ncavCompany(ticker);
      c.companyId = ticker; c.basis = 'raw-v1';
      c.facts = [...parsed, ...c.facts.filter(f => ['price', 'ordinaryShares', 'quote.shareStructure'].includes(f.field)).map(f => ({ ...f, entity: ticker, basis: c.basis }))];
      expect(ncav(c)).not.toMatchObject({ state: 'pass' });
      expect(ncav(c).conditions.find(x => x.id === 'NCAV.assets')).toMatchObject({ state: 'unknown', proof: 'bound' });
    }
  });
});

it('rejects NCAV using a nonpositive asset upper bound while preserving unresolved ownership claims', () => {
  const c = ncavCompany('ANOMALY', { currentAssets: 10, liabilities: 20, minorityEquity: 0, nonordinaryEquity: -3, marketCap: 40 });
  expect(ncav(c).conditions[0]).toMatchObject({ state: 'fail', proof: 'bound', reason: 'ncav_nonpositive_asset_upper_bound', bounds: { upper: -10 }, missing: ['ncav_equity_unresolved'] });
  expect(ncav(c).conditions[0].value).toBeUndefined();
  expect(c.facts.find(f => f.field === 'nonordinaryEquity')?.value).toBe(-3);
  const positive = structuredClone(c);
  positive.facts.find(f => f.field === 'currentAssets')!.value = 100;
  expect(ncav(positive).state).toBe('unknown');
  const conflict = structuredClone(c);
  fact(conflict, 'currentAssets', 100);
  expect(ncav(conflict).state).toBe('unknown');
  c.checks.ncav = { state: 'unresolved', evidence: ['core-accounting-conflict'] };
  expect(ncav(c).state).toBe('unknown');
});
