import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "../metrics.js";
import { fetchUsAnnualRows, fetchUsIndustryProxy, resolveCik } from "./sec.js";

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

interface UsCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
}

export const mergeUsEnrichment = mergeEnrichment;

export async function enrichUsRecord(
  record: SecurityRecord,
  opts: EnrichOptions
): Promise<SecurityRecord> {
  if (record.market !== "US") return record;

  if (!opts.skipCache) {
    const cached = await readCache<UsCachePayload>(
      opts.cacheDir,
      opts.quarter,
      "US",
      record.ticker
    );
    if (cached?.annualRows.length) {
      return mergeEnrichment(record, cached.annualRows, cached.industryProxy);
    }
  }

  const cik = await resolveCik(record.ticker);
  if (!cik) return { ...record, enrichmentFailure: "cik_unresolved" };

  const [annualRows, industryProxy] = await Promise.all([
    fetchUsAnnualRows(cik),
    fetchUsIndustryProxy(cik),
  ]);

  if (!opts.skipCache && annualRows.length > 0) {
    await writeCache(opts.cacheDir, opts.quarter, "US", record.ticker, {
      annualRows,
      industryProxy,
    } satisfies UsCachePayload);
  }

  return mergeEnrichment(record, annualRows, industryProxy);
}
