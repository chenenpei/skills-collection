import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "../metrics.js";
import { fetchCnAnnualRows, fetchCnIndustryProxy } from "./eastmoney.js";

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
    metrics: { ...record.metrics, ...derived.metrics },
  };
}

interface CnCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
}

export const mergeCnEnrichment = mergeEnrichment;

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
    if (cached?.annualRows.length) {
      return mergeEnrichment(record, cached.annualRows, cached.industryProxy);
    }
  }

  const [annualRows, industryProxy] = await Promise.all([
    fetchCnAnnualRows(record.ticker),
    fetchCnIndustryProxy(record.ticker),
  ]);

  if (!opts.skipCache && annualRows.length > 0) {
    await writeCache(opts.cacheDir, opts.quarter, "CN", record.ticker, {
      annualRows,
      industryProxy,
    } satisfies CnCachePayload);
  }

  return mergeEnrichment(record, annualRows, industryProxy);
}
