import { beforeAll, expect, it } from "vitest";
import { evaluateCompany, createEvaluationAccumulator } from "../../src/cn/screening.js";
import { parseCnStatementFacts } from "../../src/cn/sources/market-data.js";
import { loadCnPolicy, type CnPolicy } from "../../src/policy/loader.js";
import type {
  CompanyFacts,
  CompanyEvaluation,
  FinancialFact,
} from "../../src/shared/financial-model.js";
let policy: CnPolicy;
beforeAll(async () => {
  policy = await loadCnPolicy(
    new URL("../../src/policy/cn-screening.yaml", import.meta.url).pathname,
  );
});
const structure = {
  effectiveDate: "2024-12-01",
  announcedAt: "2024-12-01",
  totalShares: 100,
  aShares: 100,
  bShares: null,
  restrictedBShares: null,
  hShares: null,
  restrictedHShares: null,
  otherShares: null,
  preferredShares: null,
  changeReason: "上市",
};
function company(): CompanyFacts {
  const c: CompanyFacts = {
    ticker: "600001",
    companyId: "600001",
    companyName: "Synthetic financial lead",
    market: "CN",
    currency: "CNY",
    asOf: "2026-09-11T08:00:00Z",
    latestFiscalYear: 2025,
    quoteDate: "2026-09-11",
    lastCompletedTradingDay: "2026-09-11",
    basis: "test",
    method: {
      state: "applies",
      value: "financial_lease",
      evidence: ["profile"],
      coverage: { start: "2025-01-01", end: "2025-12-31" },
    },
    checks: {},
    facts: [],
  };
  c.facts = parseCnStatementFacts(
    {
      data: [2025, 2024, 2023].map((y) => ({
        SECURITY_CODE: c.companyId,
        REPORT_DATE: `${y}-12-31`,
        REPORT_TYPE: "年报",
        NOTICE_DATE: `${y + 1}-03-01`,
        CURRENCY: "CNY",
        ORG_TYPE: "银行",
        EPSJB: 2,
        BPS: 10,
        PARENTNETPROFIT: 200,
      })),
    },
    {
      sourceId: "annual",
      entity: c.companyId,
      basis: c.basis,
      kind: "indicators",
    },
  );
  add(c, "price", 7.5, "CNY/share");
  add(c, "ordinaryShares", 100, "shares");
  add(c, "quote.shareStructure", JSON.stringify(structure), "text");
  return c;
}
function add(c: CompanyFacts, field: string, value: number | string, unit = "CNY"): FinancialFact {
  const quote = field === "price" || field === "ordinaryShares" || field.startsWith("quote.");
  const at = "2026-09-11T07:01:00Z";
  const f: FinancialFact = {
    id: `${field}:${c.facts.length}`,
    field,
    entity: c.companyId,
    basis: c.basis,
    year: quote ? 2026 : 2025,
    period: field.startsWith("quote.")
      ? { start: at, end: at }
      : quote
        ? { start: "2026-09-11", end: "2026-09-11" }
        : {
            start:
              field === "ordinaryProfit" || field === "nonordinaryProfitAllocation"
                ? "2025-01-01"
                : "2025-12-31",
            end: "2025-12-31",
          },
    publishedAt: quote ? at : "2026-03-01",
    unit,
    state: "observed",
    value,
    evidence: [{ sourceId: "synthetic", locator: `/${field}`, raw: value }],
  };
  c.facts.push(f);
  return f;
}
const evaluate = (c: CompanyFacts) => evaluateCompany(c, policy, { strategy: "all" });
const lead = (c: CompanyFacts) => evaluate(c).strategies!.financial_discount!;
it("admits a reliable 0.75 PB research lead independently of the unsupported leasing risk strategy", () => {
  const c = company(),
    r = evaluate(c);
  expect(r.strategies!.financial_research!.state).toBe("unknown");
  expect(r.strategies!.financial_discount).toMatchObject({
    state: "pass",
    applicability: "pass",
  });
  expect(lead(c).conditions.find((x) => x.id === "FD.pb")).toMatchObject({
    value: 0.75,
    threshold: { operator: "<=", value: 1 },
  });
  c.facts.find((f) => f.field === "price")!.value = 10;
  expect(lead(c).state).toBe("pass");
  c.facts.find((f) => f.field === "price")!.value = 10.001;
  expect(lead(c).state).toBe("fail");
});
it("keeps the independent PE <= 10 condition when the book discount qualifies", () => {
  const c = company();
  c.facts.find((f) => f.field === "casOrdinaryBasicEps" && f.year === 2025)!.value = 7.5 / 10;
  expect(lead(c).state).toBe("pass");
  c.facts.find((f) => f.field === "casOrdinaryBasicEps" && f.year === 2025)!.value = 0.74;
  expect(lead(c).conditions.find((x) => x.id === "FD.earningsYield")?.state).toBe("fail");
});
it.each([
  "reportedOrdinaryBps",
  "casOrdinaryBasicEps",
  "parentProfit",
  "price",
  "quote.shareStructure",
])("does not qualify with missing %s", (field) => {
  const c = company();
  c.facts = c.facts.filter((f) => f.field !== field);
  expect(lead(c).state).toBe("unknown");
});
it("does not request price before the numeric prerequisites are known", () => {
  const c = company();
  c.facts = c.facts.filter((f) => f.field !== "reportedOrdinaryBps");
  expect(lead(c).conditions.some((x) => x.id === "FD.quote")).toBe(false);
  c.facts.push(...company().facts.filter((f) => f.field === "reportedOrdinaryBps"));
  c.facts = c.facts.filter((f) => f.field !== "price");
  expect(lead(c).conditions.some((x) => x.id === "FD.quote")).toBe(true);
});
it.each([
  [
    "negative tools",
    (c: CompanyFacts) => {
      add(c, "nonordinaryEquity", -1);
    },
  ],
  [
    "conflicting BPS",
    (c: CompanyFacts) => {
      add(c, "reportedOrdinaryBps", 20, "CNY/share");
    },
  ],
  [
    "ownership conflict",
    (c: CompanyFacts) => {
      add(c, "ordinaryProfit", -1);
    },
  ],
  [
    "known capital conflict",
    (c: CompanyFacts) => {
      c.checks.capital = { state: "unresolved", evidence: ["scope"] };
    },
  ],
  [
    "wrong BPS currency",
    (c: CompanyFacts) => {
      c.facts.find((f) => f.field === "reportedOrdinaryBps" && f.year === 2025)!.unit = "USD/share";
    },
  ],
  [
    "future BPS",
    (c: CompanyFacts) => {
      c.facts.find((f) => f.field === "reportedOrdinaryBps" && f.year === 2025)!.publishedAt =
        "2027-01-01";
    },
  ],
  [
    "wrong close date",
    (c: CompanyFacts) => {
      c.quoteDate = "2026-09-10";
    },
  ],
  [
    "unreconciled shares",
    (c: CompanyFacts) => {
      c.facts.find((f) => f.field === "quote.shareStructure")!.value = JSON.stringify({
        ...structure,
        aShares: 90,
      });
    },
  ],
])("retains unknown for %s", (_name, mutate) => {
  const c = company();
  mutate(c);
  expect(lead(c).state).toBe("unknown");
});
it("excludes a known nonstandard audit but does not require an audit to discover a lead", () => {
  const c = company();
  expect(lead(c).state).toBe("pass");
  add(c, "auditOpinion", "qualified", "text");
  expect(lead(c).state).toBe("fail");
});
it("allows coarse financial identity without claiming a specialist route, and rejects conflicting identity", () => {
  const c = company();
  c.method = { state: "unresolved", evidence: [] };
  expect(lead(c).state).toBe("pass");
  c.method.reason = "conflicting_primary_business_evidence";
  expect(lead(c).state).toBe("unknown");
  c.method = {
    state: "applies",
    value: "nonfinancial",
    evidence: ["profile"],
    coverage: { start: "2025-01-01", end: "2025-12-31" },
  };
  expect(lead(c).state).toBe("not_applicable");
});
it("converts a verified post-publication bonus share issue and stops for capital-raising changes or restatements", () => {
  const c = company(),
    next = {
      ...structure,
      effectiveDate: "2026-06-01",
      announcedAt: "2026-05-01",
      totalShares: 200,
      aShares: 200,
      changeReason: "资本公积转增股本",
    };
  c.facts.find((f) => f.field === "quote.shareStructure")!.value = JSON.stringify(next);
  c.facts.find((f) => f.field === "ordinaryShares")!.value = 200;
  c.facts.find((f) => f.field === "price")!.value = 3.75;
  const history = add(c, "quote.shareHistory", JSON.stringify([next, structure]), "text");
  expect(lead(c).state).toBe("pass");
  expect(lead(c).conditions.find((x) => x.id === "FD.pb")?.value).toBe(0.75);
  next.changeReason = "债转股上市";
  c.facts.find((f) => f.field === "quote.shareStructure")!.value = JSON.stringify(next);
  history.value = JSON.stringify([next, structure]);
  expect(lead(c).state).toBe("unknown");
  next.changeReason = "资本公积转增股本";
  c.facts.find((f) => f.field === "quote.shareStructure")!.value = JSON.stringify(next);
  history.value = JSON.stringify([next, structure]);
  c.facts.find((f) => f.field === "casOrdinaryBasicEps" && f.year === 2025)!.publishedAt =
    "2026-07-01";
  expect(lead(c).state).toBe("unknown");
});
it("blocks an actual regulatory breach while leaving a stricter policy margin out of the lead gate", () => {
  const c = company();
  const actual = add(c, "regulatory.actual.totalCapital", 0.11, "ratio"),
    requirement = add(c, "regulatory.requirement.totalCapital", 0.1, "ratio");
  add(
    c,
    "regulatory.context",
    JSON.stringify({
      subject: c.companyId,
      scope: "legal_entity",
      regime: "synthetic",
      reportYear: 2025,
      position: "closing",
      comparisonBasis: "same",
      liquidityMetrics: [],
      metrics: {
        totalCapital: {
          definition: "total-capital/risk-weighted-assets",
          direction: "minimum",
          actualFactId: actual.id,
          requirementFactId: requirement.id,
          requirementKind: "regulatory",
        },
      },
    }),
    "text",
  );
  expect(lead(c).state).toBe("pass");
  actual.value = 0.09;
  expect(lead(c).state).toBe("fail");
});
function ranked(id: string, tier: 1 | 2 | 3, companyId = id): CompanyEvaluation {
  const r = evaluate(company());
  r.ticker = id;
  r.companyId = companyId;
  r.quality = "fail";
  r.research = tier < 3 ? "pass" : "fail";
  r.priority = tier === 1 ? "pass" : "fail";
  r.strategies = {};
  if (tier === 3)
    r.strategies.financial_discount = {
      id: "financial_discount",
      applicability: "pass",
      state: "pass",
      conditions: [
        {
          id: "FD.pb",
          layer: "financial",
          state: "pass",
          reason: "test",
          factIds: [],
          missing: [],
          value: 0.5,
        },
        {
          id: "FD.earningsYield",
          layer: "financial",
          state: "pass",
          reason: "test",
          factIds: [],
          missing: [],
          value: 0.2,
        },
      ],
    };
  return r;
}
it.each([0, 20, 28, 30, 35])(
  "protects %i strong candidates from weak leads and saves the complete qualification set",
  (count) => {
    const a = createEvaluationAccumulator(30, "all", 5);
    for (let i = 0; i < 40; i++) a.accept(ranked(`W${i}`, 3));
    for (let i = 0; i < count; i++) a.accept(ranked(`S${i}`, 2));
    const s = a.finish();
    expect(s.displayed.filter((id) => id.includes("W"))).toHaveLength(
      5,
    );
    expect(s.researchDisplayed).toHaveLength(Math.min(count, 30));
    expect(s.displayed.length).toBeLessThanOrEqual(35);
    expect(s.strategies!.financial_discount!.qualifiedCount).toBe(40);
    expect(s.candidateQueue).toHaveLength(count + 40);
  },
);
it("puts price-qualified opportunities first, deduplicates companies, and honors custom and zero weak limits", () => {
  for (const limit of [0, 2, 20]) {
    const a = createEvaluationAccumulator(30, "all", limit);
    a.accept(ranked("A", 2));
    a.accept(ranked("Z", 1));
    a.accept(ranked("DUP", 3, "Z"));
    for (let i = 0; i < 12; i++) a.accept(ranked(`W${i}`, 3));
    const s = a.finish();
    expect(s.displayed.slice(0, 2)).toEqual(["CN:Z", "CN:A"]);
    expect(s.displayed).toHaveLength(2 + Math.min(12, limit));
    expect(s.candidateQueue.find((r) => r.id === "CN:DUP")?.reason).toBe("duplicate_company");
  }
});
it("requires each of the last three reported annual profits to be positive", () => {
  const c = company();
  c.facts.find((f) => f.field === "parentProfit" && f.year === 2024)!.value = -1;
  expect(lead(c).state).toBe("fail");
  expect(lead(c).conditions.some((x) => x.id === "FD.quote")).toBe(false);
});
it("does not bypass a known BPS disagreement with ordinary equity and annual share count", () => {
  const c = company();
  add(c, "parentEquity", 2000);
  add(c, "nonordinaryEquity", 0);
  expect(lead(c).state).toBe("unknown");
  expect(lead(c).conditions.find((x) => x.id === "FD.shareBasis")?.missing).toContain(
    "financial_bps_equity_conflict",
  );
});

it.each([-100, 0, 200])(
  "rejects BPS above known parent equity %i even when other equity tools are missing",
  (equity) => {
    const c = company();
    const fact = add(c, "parentEquity", equity);
    const result = lead(c);
    expect(result.state).toBe("unknown");
    const basis = result.conditions.find((x) => x.id === "FD.shareBasis");
    expect(basis?.missing).toContain("financial_bps_equity_conflict");
    expect(basis?.factIds).toContain(fact.id);
  },
);

it.each([999.5, 1000, 2000])(
  "does not require missing equity tools when parent equity %f does not contradict rounded BPS",
  (equity) => {
    const c = company();
    add(c, "parentEquity", equity);
    expect(lead(c).state).toBe("pass");
  },
);

it('retains an alternate security identity with an explicit company-deduplication reason', () => {
  const a = createEvaluationAccumulator(30, 'all');
  a.accept(ranked('BEST', 1, 'same-company'));
  a.accept(ranked('OTHER', 2, 'same-company'));
  const s = a.finish();
  expect(s.displayed).toEqual(['CN:BEST']);
  expect(s.candidateQueue.find(r => r.id === 'CN:OTHER')?.reason).toBe('duplicate_company');
});
it('does not treat an unequal A/H distribution as a same-rights stock split', () => {
  const c = company();
  const before = { ...structure, aShares: 60, hShares: 40 };
  const next = { ...before, effectiveDate: '2026-06-01', announcedAt: '2026-05-01', totalShares: 160, aShares: 120, changeReason: '转增股本' };
  c.facts.find(f => f.field === 'quote.shareStructure')!.value = JSON.stringify(next);
  c.facts.find(f => f.field === 'ordinaryShares')!.value = 160;
  c.facts.find(f => f.field === 'price')!.value = 4;
  add(c, 'quote.shareHistory', JSON.stringify([next, before]), 'text');
  expect(lead(c).state).toBe('unknown');
  expect(lead(c).conditions.find(x => x.id === 'FD.shareBasis')?.missing).toContain('financial_nonproportional_share_change');
});
it('keeps known adverse insurance ratings out of the independent bargain route', () => {
  const c = company();c.method.value = 'life_insurance';
  c.facts.filter(f => f.field === 'statementFamily').forEach(f => { f.value = '保险'; });
  const accounting = add(c, 'insurance.accountingBasis', 'CAS25-2023', 'text');
  const rating = add(c, 'insurance.riskRating', 'C', 'text');
  const context = add(c, 'insurance.context', JSON.stringify({subject:c.companyId,scope:'legal_entity',kind:'life',reportYear:2025,accountingStandard:'CAS25-2023',accountingBasisFactId:accounting.id,comparisonBasis:'reported',operating:{},rating:{factId:rating.id,system:'solvency_risk_comprehensive',regime:'C-ROSS-II',quarter:'2025Q4'}}), 'text');
  context.period.start='2025-01-01';
  expect(lead(c).state).toBe('fail');
});

it.each([5, 30])('shares %i backup seats between NCAV and financial leads independently of the main list', (limit) => {
  // Exercise the new default as well as the explicit legacy/custom capacity.
  const acc = createEvaluationAccumulator(30, 'all', limit === 30 ? undefined : limit);
  for (let i=0;i<32;i++) acc.accept(ranked(`S${i}`, 2));
  for (let i=0;i<32;i++) acc.accept(ranked(`W${String(i).padStart(2, '0')}`, 3));
  for (let i=0;i<2;i++) {
    const r=ranked(`N${i}`, 3); r.strategies = {ncav:{id:'ncav', applicability:'pass', state:'pass', conditions:[], signal:{name:'ncav_to_market_cap',unit:'ratio',direction:'higher_is_better',value:2+i}}};
    acc.accept(r);
  }
  const out=acc.finish();
  expect(out.researchDisplayed).toHaveLength(30);
  const order=['CN:N1','CN:N0',...Array.from({length:32},(_,i)=>`CN:W${String(i).padStart(2,'0')}`)];
  expect(out.backupDisplayed).toEqual(order.slice(0, limit));
  expect(out.displayCount).toBe(30 + limit);
  expect(out.backupCandidates).toHaveLength(34);
  expect(out.candidateQueue.find(r=>r.id==='CN:N1')).toMatchObject({tier:3,backupStrategy:'ncav'});
  expect(out.candidateQueue.find(r=>r.id===order[limit])?.reason).toBe('backup_limit');
});

it('does not let an undisplayed qualified company borrow a backup seat through a second strategy', () => {
  const acc=createEvaluationAccumulator(1,'all',5);
  acc.accept(ranked('A',2));acc.accept(ranked('Z',2));
  acc.accept(ranked('OTHER_SHARE',3,'Z'));
  const out=acc.finish();
  expect(out.displayed).toEqual(['CN:A']);
  expect(out.backupCandidates).toEqual([]);
  expect(out.candidateQueue.find(r=>r.id==='CN:OTHER_SHARE')?.reason).toBe('duplicate_company');
});

it('mixes book and earnings repair by yield while keeping NCAV first and main overflow out', () => {
 const a=createEvaluationAccumulator(1,'all',3);
 const cheap=ranked('CHEAP',3), profitable=ranked('PROFIT',3), repair=ranked('REPAIR',3), asset=ranked('ASSET',3);
 cheap.strategies!.financial_discount!.conditions[0].value=.2;
 cheap.strategies!.financial_discount!.conditions[1].value=.08;
 profitable.strategies!.financial_discount!.conditions[0].value=.9;
 profitable.strategies!.financial_discount!.conditions[1].value=.12;
 repair.strategies={earnings_repair:{id:'earnings_repair',applicability:'pass',state:'pass',conditions:[],signal:{name:'seven_year_discounted_earnings_yield',unit:'ratio',direction:'higher_is_better',value:.1}}};
 asset.strategies={ncav:{id:'ncav',applicability:'pass',state:'pass',conditions:[],signal:{name:'ncav_to_market_cap',unit:'ratio',direction:'higher_is_better',value:2}}};
 for(const r of [cheap,repair,profitable,asset])a.accept(r);
 const s=a.finish();expect(s.backupCandidates).toEqual(['CN:ASSET','CN:PROFIT','CN:REPAIR','CN:CHEAP']);
 expect(s.backupDisplayed).toEqual(['CN:ASSET','CN:PROFIT','CN:REPAIR']);
 expect(s.strategies!.financial_discount!.qualified).toEqual(['CN:PROFIT','CN:CHEAP']);
 expect(s.candidateQueue.find(r=>r.id==='CN:REPAIR')?.backupStrategy).toBe('earnings_repair');
});
