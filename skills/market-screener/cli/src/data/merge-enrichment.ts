import type { SecurityRecord } from "../funnel/kill-gates.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "./metrics.js";

export interface EnrichCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
  dividendYield?: number;
}

export function mergeEnrichment(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[],
  industryProxy?: string,
  dividendYield?: number
): SecurityRecord {
  if (annualRows.length === 0 && dividendYield === undefined) return record;

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
  if (dividendYield !== undefined) {
    metrics.dividend_yield = { value: dividendYield, dataConfidence: "medium" };
  }

  return {
    ...record,
    ...derivedFields,
    industryProxy: industryProxy ?? record.industryProxy,
    metrics,
  };
}
