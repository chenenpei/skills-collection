import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { DataConfidence, MetricValue } from "../funnel/types.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "./metrics.js";

export interface QuoteHistoryEntry {
  quarter: string;
  pe?: number;
  pb?: number;
  ps?: number;
  asOf: string;
}

export interface EnrichCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
  dividendYield?: number;
  dividendYieldConfidence?: DataConfidence;
  quoteHistory?: QuoteHistoryEntry[];
}

export type DividendWithConfidence = { yield: number; dataConfidence: DataConfidence };

export type DividendEnrichment = number | DividendWithConfidence;

const QUOTE_HISTORY_CAP = 20;

function normalizeDividend(
  dividend: DividendEnrichment
): { value: number; dataConfidence: DataConfidence } {
  if (typeof dividend === "number") {
    return { value: dividend, dataConfidence: "medium" };
  }
  return { value: dividend.yield, dataConfidence: dividend.dataConfidence };
}

function latestFcfFromRows(rows: AnnualFinancialRow[]): number | undefined {
  const latest = rows[rows.length - 1];
  if (!latest) return undefined;
  const capex = latest.capex !== undefined ? Math.abs(latest.capex) : 0;
  return latest.operatingCashFlow - capex;
}

function quoteNumeric(record: SecurityRecord, key: string): number | undefined {
  const value = record.metrics[key]?.value;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function deriveVs5yMedian(
  current: number | undefined,
  history: QuoteHistoryEntry[],
  pick: (entry: QuoteHistoryEntry) => number | undefined
): MetricValue | undefined {
  const values = history.map(pick).filter((v): v is number => v !== undefined && v > 0);
  if (current === undefined || current <= 0 || values.length === 0) return undefined;
  const med = median(values);
  if (med <= 0) return undefined;
  return { value: current / med, dataConfidence: "medium" };
}

function appendQuoteHistory(
  history: QuoteHistoryEntry[] | undefined,
  entry: QuoteHistoryEntry
): QuoteHistoryEntry[] {
  const next = [...(history ?? []), entry];
  return next.length > QUOTE_HISTORY_CAP ? next.slice(-QUOTE_HISTORY_CAP) : next;
}

export function updatedQuoteHistory(
  history: QuoteHistoryEntry[] | undefined,
  quarter: string,
  pe?: number,
  pb?: number,
  ps?: number
): QuoteHistoryEntry[] | undefined {
  if (pe === undefined && pb === undefined && ps === undefined) return history;
  const withoutCurrent = (history ?? []).filter((entry) => entry.quarter !== quarter);
  return appendQuoteHistory(withoutCurrent, {
    quarter,
    pe,
    pb,
    ps,
    asOf: new Date().toISOString(),
  });
}

export function buildDeriveContext(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[]
): Parameters<typeof deriveFromAnnualRows>[1] {
  const trailingPe = quoteNumeric(record, "pe_ttm");
  const priceToBook = quoteNumeric(record, "pb");
  const price = quoteNumeric(record, "price");
  const high52Week = quoteNumeric(record, "high_52w");

  let priceVsHigh = quoteNumeric(record, "price_vs_52w_high");
  if (priceVsHigh === undefined && price !== undefined && high52Week !== undefined && high52Week > 0) {
    priceVsHigh = price / high52Week;
  }

  return {
    marketCap: record.marketCap,
    currency: record.currency,
    trailingPe,
    priceToBook,
    fcf: latestFcfFromRows(annualRows),
    price,
    high52Week: high52Week ?? (price !== undefined && priceVsHigh !== undefined && priceVsHigh > 0
      ? price / priceVsHigh
      : undefined),
  };
}

export function mergeEnrichment(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[],
  industryProxy?: string,
  dividend?: DividendEnrichment,
  opts?: { quarter?: string; quoteHistory?: QuoteHistoryEntry[] }
): SecurityRecord {
  if (annualRows.length === 0 && dividend === undefined) return record;

  const derived =
    annualRows.length > 0
      ? deriveFromAnnualRows(annualRows, buildDeriveContext(record, annualRows))
      : null;

  const { metrics: derivedMetrics = {}, ...derivedFields } = derived ?? {
    metrics: {},
    revenueYoyHistory: record.revenueYoyHistory,
    ocfNegativeYears: record.ocfNegativeYears,
    netLossWidening: record.netLossWidening,
    latestFinancialMonthsOld: record.latestFinancialMonthsOld,
  };

  const metrics = { ...record.metrics, ...derivedMetrics };
  if (dividend !== undefined) {
    metrics.dividend_yield = normalizeDividend(dividend);
  }

  const currentPe = metrics.pe_ttm?.value;
  const currentPb = metrics.pb?.value;
  const currentPs = metrics.ps?.value;
  const history = opts?.quoteHistory ?? [];
  const peVs5y = deriveVs5yMedian(currentPe, history, (e) => e.pe);
  const pbVs5y = deriveVs5yMedian(currentPb, history, (e) => e.pb);
  const psVs5y = deriveVs5yMedian(currentPs, history, (e) => e.ps);
  if (peVs5y) metrics.pe_vs_5y_median = peVs5y;
  if (pbVs5y) metrics.pb_vs_5y_median = pbVs5y;
  if (psVs5y) metrics.ps_vs_5y_median = psVs5y;

  return {
    ...record,
    ...derivedFields,
    industryProxy: industryProxy ?? record.industryProxy,
    metrics,
  };
}
