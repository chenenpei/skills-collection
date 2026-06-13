import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../engine/kill-gates.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "../../metrics/derive.js";
import { fetchCnAnnualRows } from "./eastmoney-financials.js";
import { fetchCnIndustryProxy } from "./eastmoney-industry.js";

interface CnCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
}

export function mergeCnEnrichment(
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
    metrics: { ...derived.metrics, ...record.metrics },
  };
}

export async function enrichCnRecord(
  record: SecurityRecord,
  opts: EnrichOptions
): Promise<SecurityRecord> {
  if (record.market !== "CN") return record;

  if (!opts.skipCache) {
    const cached = await readCache<CnCachePayload>(
      opts.cacheDir,
      opts.quarter,
      "CN",
      record.ticker
    );
    if (cached) return mergeCnEnrichment(record, cached.annualRows, cached.industryProxy);
  }

  const [annualRows, industryProxy] = await Promise.all([
    fetchCnAnnualRows(record.ticker),
    fetchCnIndustryProxy(record.ticker),
  ]);

  await writeCache(opts.cacheDir, opts.quarter, "CN", record.ticker, {
    annualRows,
    industryProxy,
  } satisfies CnCachePayload);

  return mergeCnEnrichment(record, annualRows, industryProxy);
}
