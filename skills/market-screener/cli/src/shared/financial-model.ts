/**
 * 财务模型：证券、事实、条件结果，以及解析器和筛选器共同遵守的口径契约。
 * 来源身份、报告期间、币种和事实关联用于判断可比性；这里不设置选股阈值。
 */
import { z } from "zod";

export type Market = "CN" | "US";
export type DataConfidence = "high" | "medium" | "low";

export interface MetricValue {
  value?: number;
  period?: string;
  currency?: string;
  source?: string;
  basis?: string;
  dataConfidence: DataConfidence;
}

export interface SecurityRecord {
  ticker: string;
  market: Market;
  companyName: string;
  currency: string;
  status: string;
  marketCap: number;
  listingAgeYears: number;
  gicsCode?: string;
  industryProxy?: string;
  metrics: Record<string, MetricValue>;
  revenueYoyHistory: number[];
  ocfNegativeYears: number;
  netLossWidening: boolean;
  nonStandardAudit: boolean;
  latestFinancialMonthsOld: number;
  /** Set when live enrichment could not complete for this record. */
  enrichmentFailure?: "cik_unresolved" | "fetch_failed";
  /** Optional hints for Deep audit (routing, bank scrape, template eval). */
  auditHints?: string[];
}

// Evidence-based CN path; legacy SecurityRecord remains for unmigrated consumers.
export type ConditionState = "pass" | "fail" | "unknown" | "not_applicable" | "not_evaluated";
export type FinancialMethod =
  | "nonfinancial"
  | "bank"
  | "broker"
  | "financial_lease"
  | "pc_insurance"
  | "life_insurance"
  | "insurance_group"
  | "futures"
  | "trust"
  | "mixed";
export interface Applicability {
  state: "applies" | "not_applicable" | "unresolved";
  /** IDs of facts establishing this scope, not an agent's approval. */
  evidence: string[];
  /** Financial periods established by these references, separate from review expiry. */
  coverage?: { start: string; end: string };
  reason?: string;
}
export interface FinancialFact {
  id: string;
  field: string;
  entity: string;
  year: number;
  period: { start: string; end: string };
  publishedAt: string;
  /** Comparable accounting/ownership scope, explicit across restatements. */
  basis: string;
  unit: string;
  state: "observed" | "derived" | "missing" | "conflicting" | "not_applicable";
  value?: number | string | boolean;
  evidence: Array<{ sourceId: string; locator: string; raw: unknown }>;
  reason?: string;
  unitScale?: number;
  derivation?: { algorithm: string; inputs: string[] };
}
export interface SecurityIdentity {
  exchange: "SSE" | "SZSE" | "BSE";
  board: string;
  listedAt: string;
  /** BSE's official list counts transferred companies from their Selected Tier admission. */
  listedAtBasis?: "exchange_listing_or_selected_tier";
  state: "listed" | "not_yet_listed";
  industryLabels: string[];
  sourceId: string;
  locator: string;
  observedAt: string;
}
export interface CompanyFacts {
  ticker: string;
  companyId: string;
  companyName: string;
  market: Market;
  currency: string;
  asOf: string;
  latestFiscalYear: number;
  quoteDate?: string;
  lastCompletedTradingDay?: string;
  basis: string;
  method: Applicability & { value?: FinancialMethod };
  checks: Record<string, Applicability>;
  facts: FinancialFact[];
  identity?: SecurityIdentity;
  collection?: {
    state: "pending" | "complete" | "source_error" | "budget_exhausted" | "interrupted";
    requests: number;
    errors: string[];
    stoppedAfterFailure?: { policyVersion: string; conditionIds: string[] };
  };
}
/** Arithmetic trace, not another eligibility condition. */
export interface CalculationStep {
  id: string;
  year: number;
  formula: string;
  unit: string;
  value?: number;
  bounds?: { lower?: number; upper?: number };
  factIds: string[];
  missing: string[];
  assumptions?: Record<string, number | string>;
}
export interface ConditionResult {
  id: string;
  layer: "quality" | "priority" | "financial" | "ncav";
  state: ConditionState;
  reason: string;
  factIds: string[];
  missing: string[];
  proof?: "exact" | "bound" | "estimate";
  value?: number;
  bounds?: { lower?: number; upper?: number };
  formula?: string;
  threshold?: { operator: string; value: number };
  components?: ConditionResult[];
  calculations?: CalculationStep[];
}
export type StrategyId =
  | "quality_research"
  | "quality_value"
  | "financial_research"
  | "financial_value"
  | "financial_discount"
  | "ncav";
/** Independent opportunity results.  Legacy quality/research/priority fields remain intact. */
export interface StrategyResult {
  id: StrategyId;
  applicability: ConditionState;
  state: ConditionState;
  conditions: ConditionResult[];
  /** Named strategy-specific ratio; incomparable signals must not be combined into a score. */
  signal?: { name: string; unit: string; direction: "higher_is_better"; value?: number };
}
/** 近期累计报告的事实提示，完全独立于资格与排名。同比只对正基数定义。 */
export interface RecentFinancialChanges {
  state: "complete" | "missing" | "stale" | "conflicting";
  period?: { start: string; end: string };
  priorPeriod?: { start: string; end: string };
  publishedAt?: string;
  reason?: string;
  metrics: Array<{
    field: string;
    state: "complete" | "missing" | "conflicting";
    current?: number;
    prior?: number;
    change?: number;
    yoy?: number;
    yoyReason?: "nonpositive_prior";
    factIds: string[];
  }>;
  hints: string[];
}

export interface CompanyEvaluation {
  ticker: string;
  companyId: string;
  market: Market;
  companyName: string;
  identity?: SecurityIdentity;
  method: CompanyFacts["method"];
  quality: ConditionState;
  /** P0/P1/P2 aggregate for the research list; price never decides it. */
  research: ConditionState;
  priority: ConditionState;
  conditions: ConditionResult[];
  strategies?: Partial<Record<StrategyId, StrategyResult>>;
  recentFinancials?: RecentFinancialChanges;
  /** Research ordering signals, not an intrinsic-value estimate or buy recommendation. */
  researchRanking?: {
    priceBand: "undervalued" | "normal" | "expensive" | "unknown";
    earningsYield?: number;
    returnMedian?: number;
    priceCondition: string;
    returnCondition?: string;
    normalYield: number;
    lowPriceYield: number;
  };
  policyVersion: string;
  /** Auxiliary disclosures, never aggregated into strategy qualification. */
  observations?: ConditionResult[];
  /** Code-owned derivations; source operands remain in the archived input. */
  derivedFacts?: FinancialFact[];
  collection?: CompanyFacts["collection"];
}

// 财务事实的口径契约：解析器与筛选器共同遵守。
const shareCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
/** Reported share classes, not an assertion that a quote is suitable for valuation. */
export const shareStructureSchema = z
  .object({
    effectiveDate: calendarDate,
    announcedAt: calendarDate,
    totalShares: shareCount.positive(),
    aShares: shareCount,
    bShares: shareCount.nullable(),
    restrictedBShares: shareCount.nullable(),
    hShares: shareCount.nullable(),
    restrictedHShares: shareCount.nullable(),
    otherShares: shareCount.nullable(),
    preferredShares: shareCount.nullable(),
    changeReason: z.string(),
  })
  .strict();
export const ordinaryReturnContextSchema = z
  .object({
    accountingStandard: z.literal("CAS"),
    shareholderScope: z.literal("ordinary"),
    reportYear: z.number().int(),
    weightedRoeFactId: z.string().min(1),
    adjustedWeightedRoeFactId: z.string().min(1),
  })
  .strict();
/** Accounting roles a sourced classification may bridge; this is not a formula language. */
export const financingRoleInputs: Record<string, readonly string[]> = {
  currentFinancingLiabilities: [
    "currentNoncurrentLiabilities",
    "currentBorrowings",
    "currentLeaseLiabilities",
    "currentBondsPayable",
    "currentLongPayables",
  ],
  financingNotesPayable: ["notesPayable"],
  noncurrentFinancingPayables: ["longPayables"],
  otherFinancingLiabilities: [
    "otherCurrentLiabilities",
    "otherNoncurrentLiabilities",
    "otherPayables",
  ],
  additionalFinancing: ["derecognizedBills"],
};
/** A source adapter must bind these metric meanings to the original regulatory table. */
export const regulatoryMetricDefinitions = {
  futuresRiskCoverage: "net-capital/futures-risk-capital-reserve",
  netCapital: "proprietary-net-capital",
  ownLiquidityRatio: "own-liquid-assets/own-liquid-liabilities-excluding-client-margins",
  ownDebtEquity: "own-liabilities-excluding-client-equity/proprietary-net-assets",
  ownSettlementReserve: "own-settlement-reserve-excluding-client-margins",
  trustRiskCoverage: "net-capital/all-trust-company-business-risk-capital",
  netCapitalEquity: "net-capital/proprietary-net-assets",
  loanNpl: "nonperforming-loans/gross-loans",
  loanProvisionCoverage: "loan-loss-provisions/nonperforming-loans",
  leaseNpl: "nonperforming-finance-lease-assets/gross-finance-lease-assets",
  leaseProvisionCoverage: "lease-loss-provisions/nonperforming-finance-lease-assets",
  cet1: "core-tier-1-capital/risk-weighted-assets",
  tier1: "tier-1-capital/risk-weighted-assets",
  totalCapital: "total-capital/risk-weighted-assets",
  riskCoverage: "net-capital/total-risk-capital-reserve",
  capitalLeverage: "core-net-capital/total-on-and-off-balance-assets",
  lcr: "high-quality-liquid-assets/net-cash-outflows-30d",
  nsfr: "available-stable-funding/required-stable-funding",
  liquidityRatio: "liquid-assets/liquid-liabilities",
  coreSolvency: "core-capital/minimum-capital",
  comprehensiveSolvency: "actual-capital/minimum-capital",
} as const;
const metricBinding = z
  .object({
    definition: z.string().min(1),
    direction: z.enum(["minimum", "maximum"]),
    actualFactId: z.string().min(1),
    requirementFactId: z.string().min(1).optional(),
    requirementKind: z.enum(["regulatory", "warning"]).optional(),
  })
  .strict();
/** Not caller approval: this JSON is itself an observed, raw-source-linked FinancialFact. */
export const regulatoryContextSchema = z
  .object({
    subject: z.string().min(1),
    scope: z.enum(["legal_entity", "regulatory_consolidated"]),
    assetScope: z
      .enum(["proprietary_excluding_trust_assets", "own_funds_excluding_client_assets"])
      .optional(),
    regime: z.string().min(1),
    reportYear: z.number().int(),
    position: z.enum(["closing", "opening"]),
    comparisonBasis: z.string().min(1),
    liquidityMetrics: z.array(z.string().min(1)).refine((xs) => new Set(xs).size === xs.length),
    metrics: z.record(metricBinding),
  })
  .strict();
export type RegulatoryContext = z.infer<typeof regulatoryContextSchema>;
/** Source-extracted insurance basis and operand bindings; never a reviewed/pass flag. */
export const insuranceContextSchema = z
  .object({
    subject: z.string().min(1),
    scope: z.enum(["group", "legal_entity"]),
    kind: z.enum(["pc", "life", "group"]),
    reportYear: z.number().int(),
    accountingStandard: z.string().min(1),
    comparisonBasis: z.string().min(1),
    accountingBasisFactId: z.string().min(1).optional(),
    operating: z.record(
      z.object({ factId: z.string().min(1), definition: z.string().min(1) }).strict(),
    ),
    denominatorDefinition: z.string().min(1).optional(),
    regulatoryContextFactId: z.string().min(1).optional(),
    rating: z
      .object({
        factId: z.string().min(1),
        system: z.string().min(1),
        regime: z.string().min(1),
        quarter: z.string().regex(/^\d{4}Q[1-4]$/),
      })
      .strict()
      .optional(),
    stress: z
      .record(
        z.record(
          z
            .object({
              mode: z.enum(["scenario_ratio", "percentage_point_change"]),
              factId: z.string().min(1),
              baseFactId: z.string().min(1).optional(),
            })
            .strict(),
        ),
      )
      .optional(),
  })
  .strict();
export type InsuranceContext = z.infer<typeof insuranceContextSchema>;
export const insuranceOperatingDefinitions = {
  underwritingResult: "insurance-underwriting-result",
  combinedRatio: "insurance-combined-cost/defined-denominator",
  combinedRatioDenominator: "combined-ratio-defined-denominator",
  serviceResult: "insurance-service-result-after-reinsurance",
} as const;
/** Main-business revenue/cost tables are partial business evidence, not a complete segment or subsidiary inventory. */
export const businessBreakdownSchema = z
  .object({
    scope: z.literal("main_business"),
    dimension: z.enum(["industry", "product"]),
    rows: z
      .array(
        z
          .object({
            name: z.string().min(1),
            role: z.enum(["business", "elimination", "total"]),
            revenueFactId: z.string().optional(),
            costFactId: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type BusinessBreakdown = z.infer<typeof businessBreakdownSchema>;
const segmentAmounts = z
  .object({
    revenueFactId: z.string().optional(),
    assetsFactId: z.string().optional(),
    profitFactId: z.string().optional(),
  })
  .strict();
export const businessSegmentsSchema = z
  .object({
    scope: z.literal("reported_segments"),
    declaredCount: z.number().int().positive(),
    rows: z
      .array(
        segmentAmounts.extend({
          name: z.string().min(1),
          definition: z.string().min(1).optional(),
        }),
      )
      .min(1),
    totals: segmentAmounts,
  })
  .strict()
  .refine(
    (c) =>
      c.declaredCount === c.rows.length &&
      new Set(c.rows.map((r) => r.name)).size === c.rows.length,
  );

/** An input hint cannot shorten the window past an already disclosed complete year. */
export function latestDisclosedFiscalYear(
  company: CompanyFacts,
  facts: FinancialFact[] = company.facts,
): number {
  const years = facts
    .filter((f) => {
      const annual = f.period.start === `${f.year}-01-01` || f.period.start === `${f.year}-12-31`;
      const financial =
        f.field === "annualReportYear" || f.unit === company.currency || f.unit === "ratio";
      return (
        !f.field.startsWith("recent.") &&
        financial &&
        annual &&
        f.period.end === `${f.year}-12-31` &&
        f.entity === company.companyId &&
        f.basis === company.basis &&
        ["observed", "derived"].includes(f.state) &&
        typeof f.value === "number" &&
        Number.isFinite(f.value) &&
        f.evidence.length > 0 &&
        new Date(f.publishedAt) <= new Date(company.asOf) &&
        new Date(f.period.end) <= new Date(company.asOf)
      );
    })
    .map((f) => f.year);
  // Keep a declared newer, unfilled year as missing; never backfill with older years.
  return Math.max(company.latestFiscalYear, ...years);
}
