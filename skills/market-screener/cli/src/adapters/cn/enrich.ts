import { readCache, writeCache } from "../../lib/cache.js";
import { mergeEnrichment } from "../merge-enrichment.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../engine/kill-gates.js";
import type { AnnualFinancialRow } from "../../metrics/derive.js";
import { fetchCnAnnualRows } from "./eastmoney-financials.js";
import { fetchCnIndustryProxy } from "./eastmoney-industry.js";

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
