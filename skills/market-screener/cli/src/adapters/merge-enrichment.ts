import type { SecurityRecord } from "../engine/kill-gates.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "../metrics/derive.js";

export function mergeEnrichment(
  record: SecurityRecord,
  annualRows: AnnualFinancialRow[],
  industryProxy?: string
): SecurityRecord {
  if (annualRows.length === 0) return record;

  const derived = deriveFromAnnualRows(annualRows, {
    marketCap: record.marketCap,
    currency: record.currency,
  });

  return {
    ...record,
    industryProxy: industryProxy ?? record.industryProxy,
    ...derived,
    // Quote-only fields (e.g. trailing PE) stay; derived financials win on overlap.
    metrics: { ...record.metrics, ...derived.metrics },
  };
}
