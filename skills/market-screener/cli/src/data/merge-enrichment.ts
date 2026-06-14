import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { DataConfidence } from "../funnel/types.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "./metrics.js";

export interface EnrichCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
  dividendYield?: number;
  dividendYieldConfidence?: DataConfidence;
}

export type DividendWithConfidence = { yield: number; dataConfidence: DataConfidence };

export type DividendEnrichment = number | DividendWithConfidence;

function normalizeDividend(
  dividend: DividendEnrichment
): { value: number; dataConfidence: DataConfidence } {
  if (typeof dividend === "number") {
    return { value: dividend, dataConfidence: "medium" };
  }
  return { value: dividend.yield, dataConfidence: dividend.dataConfidence };
}

export function mergeEnrichment(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[],
  industryProxy?: string,
  dividend?: DividendEnrichment
): SecurityRecord {
  if (annualRows.length === 0 && dividend === undefined) return record;

  const derived =
    annualRows.length > 0
      ? deriveFromAnnualRows(annualRows, {
          marketCap: record.marketCap,
          currency: record.currency,
        })
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

  return {
    ...record,
    ...derivedFields,
    industryProxy: industryProxy ?? record.industryProxy,
    metrics,
  };
}
