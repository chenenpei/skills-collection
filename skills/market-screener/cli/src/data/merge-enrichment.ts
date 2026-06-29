import fs from "node:fs";
import path from "node:path";
import type { SecurityRecord } from "../funnel/kill-gates.js";
import { sanitizeCnQuoteMetrics } from "./cn/quotes.js";
import type { BankScrapeMetrics } from "./cn/bank-indicators/types.js";
import type { DataConfidence, MetricValue } from "../funnel/types.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "./metrics.js";

export const CN_QUOTE_HISTORY_SCHEMA = "eastmoney_f115_f23_v2" as const;

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
  quoteHistorySchema?: typeof CN_QUOTE_HISTORY_SCHEMA;
  bankScrape?: {
    fiscalYear: number;
    metrics: BankScrapeMetrics;
    scrapedAt: string;
    sourceUrls: string[];
  };
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
  const latest = [...rows].sort((a, b) => a.year - b.year).at(-1);
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
  const prior = history ?? [];
  const withoutCurrent = prior.filter((entry) => entry.quarter !== quarter);
  if (pe === undefined && pb === undefined && ps === undefined) {
    return withoutCurrent.length === prior.length ? history : withoutCurrent;
  }
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

  const midPe = metrics.mid_cycle_pe?.value;
  if (midPe !== undefined && midPe > 0 && history.length >= 2) {
    const histPe = history.map((e) => e.pe).filter((v): v is number => v !== undefined && v > 0);
    if (histPe.length >= 2) {
      const med = median(histPe);
      if (med > 0) {
        metrics.mid_cycle_pe_vs_10y_median = { value: midPe / med, dataConfidence: "medium" };
      }
    }
  }

  return {
    ...record,
    ...derivedFields,
    industryProxy: industryProxy ?? record.industryProxy,
    metrics,
  };
}

function stubReplayRecord(
  ticker: string,
  market: SecurityRecord["market"],
  industryProxy?: string
): SecurityRecord {
  return {
    ticker,
    market,
    companyName: ticker,
    currency: market === "CN" ? "CNY" : "USD",
    status: "active",
    marketCap: 50_000_000_000,
    listingAgeYears: 10,
    industryProxy,
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 6,
  };
}

function quoteMetricsFromHistory(
  payload: EnrichCachePayload,
  baseMetrics: SecurityRecord["metrics"],
  market: SecurityRecord["market"]
): SecurityRecord["metrics"] {
  if (market === "CN" && payload.quoteHistorySchema !== CN_QUOTE_HISTORY_SCHEMA) {
    return {};
  }

  const latest = payload.quoteHistory?.at(-1);
  if (!latest) return {};

  const raw: SecurityRecord["metrics"] = {};
  if (latest.pe !== undefined && latest.pe > 0) {
    raw.pe_ttm = { value: latest.pe, dataConfidence: "medium" };
  }
  if (latest.pb !== undefined && latest.pb > 0) {
    raw.pb = { value: latest.pb, dataConfidence: "medium" };
  }
  if (latest.ps !== undefined && latest.ps > 0) {
    raw.ps = { value: latest.ps, dataConfidence: "medium" };
  }

  if (market === "CN") {
    return sanitizeCnQuoteMetrics({ ...baseMetrics, ...raw }).metrics;
  }
  return raw;
}

export function enrichRecordFromCachePayload(
  record: SecurityRecord,
  payload: EnrichCachePayload,
  quarter: string
): SecurityRecord {
  const dividend: DividendWithConfidence | undefined =
    payload.dividendYield !== undefined
      ? {
          yield: payload.dividendYield,
          dataConfidence: payload.dividendYieldConfidence ?? "medium",
        }
      : undefined;

  return mergeEnrichment(
    {
      ...record,
      industryProxy: payload.industryProxy ?? record.industryProxy,
      metrics: { ...record.metrics, ...quoteMetricsFromHistory(payload, record.metrics, record.market) },
    },
    payload.annualRows ?? [],
    payload.industryProxy,
    dividend,
    { quarter, quoteHistory: payload.quoteHistory }
  );
}

export function loadEnrichedUniverseFromCache(opts: {
  cacheDir: string;
  quarter: string;
  market: SecurityRecord["market"];
}): SecurityRecord[] {
  const marketDir = path.join(opts.cacheDir, opts.quarter, opts.market);
  if (!fs.existsSync(marketDir)) return [];

  const records: SecurityRecord[] = [];
  for (const file of fs.readdirSync(marketDir)) {
    if (!file.endsWith(".json")) continue;
    const ticker = file.replace(/\.json$/, "");
    const payload = JSON.parse(
      fs.readFileSync(path.join(marketDir, file), "utf8")
    ) as EnrichCachePayload;
    records.push(
      enrichRecordFromCachePayload(
        stubReplayRecord(ticker, opts.market, payload.industryProxy),
        payload,
        opts.quarter
      )
    );
  }
  return records;
}
