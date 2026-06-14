import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import {
  mergeEnrichment,
  type EnrichCachePayload,
} from "../merge-enrichment.js";
import {
  fetchCnAnnualRows,
  fetchCnDividendYield,
  fetchCnIndustryProxy,
  fetchCnSupplementalAnnualRows,
  mergeSupplementalIntoAnnualRows,
} from "./eastmoney.js";

export { mergeEnrichment as mergeCnEnrichment } from "../merge-enrichment.js";

async function resolveDividendYield(
  ticker: string,
  cached?: number
): Promise<number | undefined> {
  if (cached !== undefined) return cached;
  try {
    return await fetchCnDividendYield(ticker);
  } catch {
    return undefined;
  }
}

export async function enrichCnRecord(
  record: SecurityRecord,
  opts: EnrichOptions
): Promise<SecurityRecord> {
  if (record.market !== "CN") return record;

  if (!opts.skipCache) {
    const cached = await readCache<EnrichCachePayload>(
      opts.cacheDir,
      opts.quarter,
      "CN",
      record.ticker
    );
    if (cached?.annualRows.length) {
      const dividendYield = await resolveDividendYield(record.ticker, cached.dividendYield);
      if (dividendYield !== undefined && cached.dividendYield === undefined) {
        await writeCache(opts.cacheDir, opts.quarter, "CN", record.ticker, {
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

  const annualRows = await fetchCnAnnualRows(record.ticker);
  let industryProxy: string | undefined;
  let mergedRows = annualRows;
  let dividendYield: number | undefined;

  if (annualRows.length > 0) {
    const [proxy, supplemental, yieldVal] = await Promise.all([
      fetchCnIndustryProxy(record.ticker),
      fetchCnSupplementalAnnualRows(record.ticker).catch(() => new Map()),
      resolveDividendYield(record.ticker),
    ]);
    industryProxy = proxy;
    mergedRows = mergeSupplementalIntoAnnualRows(annualRows, supplemental);
    dividendYield = yieldVal;
  } else {
    [industryProxy, dividendYield] = await Promise.all([
      fetchCnIndustryProxy(record.ticker).catch(() => undefined),
      resolveDividendYield(record.ticker),
    ]);
  }

  if (!opts.skipCache && mergedRows.length > 0) {
    await writeCache(opts.cacheDir, opts.quarter, "CN", record.ticker, {
      annualRows: mergedRows,
      industryProxy,
      dividendYield,
    } satisfies EnrichCachePayload);
  }

  return mergeEnrichment(record, mergedRows, industryProxy, dividendYield);
}
