import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../engine/kill-gates.js";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "../../metrics/derive.js";
import { fetchUsAnnualRows } from "./sec-companyfacts.js";
import { fetchUsIndustryProxy } from "./sec-submissions.js";
import { resolveCik } from "./sec-tickers.js";

interface UsCachePayload {
  annualRows: AnnualFinancialRow[];
  industryProxy?: string;
}

export function mergeUsEnrichment(
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
    if (cached) return mergeUsEnrichment(record, cached.annualRows, cached.industryProxy);
  }

  const cik = await resolveCik(record.ticker);
  if (!cik) return record;

  const [annualRows, industryProxy] = await Promise.all([
    fetchUsAnnualRows(cik),
    fetchUsIndustryProxy(cik),
  ]);

  await writeCache(opts.cacheDir, opts.quarter, "US", record.ticker, {
    annualRows,
    industryProxy,
  } satisfies UsCachePayload);

  return mergeUsEnrichment(record, annualRows, industryProxy);
}
