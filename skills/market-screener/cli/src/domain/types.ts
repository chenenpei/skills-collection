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

export interface ThresholdRule {
  min?: number;
  max?: number;
  default?: number;
  market_overrides?: Partial<Record<Market, number>>;
  market_missing_overrides?: Partial<Record<Market, "skip">>;
  missing?: "skip" | "data_confidence_low" | "use_ps_vs_peer";
  field?: string;
}

export interface ThresholdResult {
  passed: boolean;
  skipped: boolean;
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
