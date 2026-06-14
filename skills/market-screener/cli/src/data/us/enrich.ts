import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import {
  mergeEnrichment,
  type EnrichCachePayload,
} from "../merge-enrichment.js";
import { fetchUsAnnualRows, fetchUsIndustryProxy, resolveCik } from "./sec.js";
import { fetchUsDividendYield } from "./quotes.js";

export { mergeEnrichment as mergeUsEnrichment } from "../merge-enrichment.js";

async function resolveDividendYield(
  ticker: string,
  cached?: number
): Promise<number | undefined> {
  if (cached !== undefined) return cached;
  try {
    return await fetchUsDividendYield(ticker);
  } catch {
    return undefined;
  }
}

export async function enrichUsRecord(
  record: SecurityRecord,
  opts: EnrichOptions
): Promise<SecurityRecord> {
  if (record.market !== "US") return record;

  if (!opts.skipCache) {
    const cached = await readCache<EnrichCachePayload>(
      opts.cacheDir,
      opts.quarter,
      "US",
      record.ticker
    );
    if (cached?.annualRows.length) {
      const dividendYield = await resolveDividendYield(record.ticker, cached.dividendYield);
      if (dividendYield !== undefined && cached.dividendYield === undefined) {
        await writeCache(opts.cacheDir, opts.quarter, "US", record.ticker, {
          ...cached,
          dividendYield,
        });
      }
      return mergeEnrichment(
        record,
        cached.annualRows,
        cached.industryProxy,
        dividendYield
      );
    }
  }

  const cik = await resolveCik(record.ticker);
  if (!cik) return { ...record, enrichmentFailure: "cik_unresolved" };

  const [annualRows, industryProxy, dividendYield] = await Promise.all([
    fetchUsAnnualRows(cik),
    fetchUsIndustryProxy(cik),
    resolveDividendYield(record.ticker),
  ]);

  if (!opts.skipCache && annualRows.length > 0) {
    await writeCache(opts.cacheDir, opts.quarter, "US", record.ticker, {
      annualRows,
      industryProxy,
      dividendYield,
    } satisfies EnrichCachePayload);
  }

  return mergeEnrichment(record, annualRows, industryProxy, dividendYield);
}
