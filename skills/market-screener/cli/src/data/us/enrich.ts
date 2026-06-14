import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import {
  mergeEnrichment,
  updatedQuoteHistory,
  type EnrichCachePayload,
} from "../merge-enrichment.js";
import { annualRowsNeedMetricRefresh, type AnnualFinancialRow } from "../metrics.js";
import { fetchUsAnnualRows, fetchUsIndustryProxy, resolveCik } from "./sec.js";
import { fetchUsDividendYield, fetchUsQuoteBulk } from "./quotes.js";

export { mergeEnrichment as mergeUsEnrichment } from "../merge-enrichment.js";

async function refreshUsAnnualRows(
  cik: string,
  existing: AnnualFinancialRow[]
): Promise<AnnualFinancialRow[]> {
  const fresh = await fetchUsAnnualRows(cik).catch(() => [] as AnnualFinancialRow[]);
  return fresh.length > 0 ? fresh : existing;
}

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

async function withQuoteBulk(record: SecurityRecord): Promise<SecurityRecord> {
  if (record.metrics.pe_ttm?.value !== undefined && record.metrics.pb?.value !== undefined) {
    return record;
  }
  const bulk = await fetchUsQuoteBulk(record.ticker);
  if (!bulk || Object.keys(bulk).length === 0) return record;
  return { ...record, metrics: { ...record.metrics, ...bulk } };
}

async function persistEnrichCache(
  opts: EnrichOptions,
  ticker: string,
  payload: EnrichCachePayload,
  enriched: SecurityRecord
): Promise<void> {
  if (opts.skipCache) return;
  await writeCache(opts.cacheDir, opts.quarter, "US", ticker, {
    ...payload,
    quoteHistory: updatedQuoteHistory(
      payload.quoteHistory,
      opts.quarter,
      enriched.metrics.pe_ttm?.value,
      enriched.metrics.pb?.value,
      enriched.metrics.ps?.value
    ),
  });
}

export async function enrichUsRecord(
  record: SecurityRecord,
  opts: EnrichOptions
): Promise<SecurityRecord> {
  if (record.market !== "US") return record;

  const recordWithQuote = await withQuoteBulk(record);

  if (!opts.skipCache) {
    const cached = await readCache<EnrichCachePayload>(
      opts.cacheDir,
      opts.quarter,
      "US",
      record.ticker
    );
    if (cached?.annualRows.length) {
      let annualRows = cached.annualRows;
      if (annualRowsNeedMetricRefresh(annualRows)) {
        const cik = await resolveCik(record.ticker);
        if (cik) {
          annualRows = await refreshUsAnnualRows(cik, annualRows);
        }
      }
      const dividendYield = await resolveDividendYield(record.ticker, cached.dividendYield);
      const enriched = mergeEnrichment(
        recordWithQuote,
        annualRows,
        cached.industryProxy,
        dividendYield,
        { quarter: opts.quarter, quoteHistory: cached.quoteHistory }
      );
      const payload: EnrichCachePayload = {
        ...cached,
        annualRows,
        dividendYield: cached.dividendYield ?? dividendYield,
      };
      await persistEnrichCache(opts, record.ticker, payload, enriched);
      return enriched;
    }
  }

  const cik = await resolveCik(record.ticker);
  if (!cik) return { ...recordWithQuote, enrichmentFailure: "cik_unresolved" };

  const [annualRows, industryProxy, dividendYield] = await Promise.all([
    fetchUsAnnualRows(cik),
    fetchUsIndustryProxy(cik),
    resolveDividendYield(record.ticker),
  ]);

  const enriched = mergeEnrichment(
    recordWithQuote,
    annualRows,
    industryProxy,
    dividendYield,
    { quarter: opts.quarter }
  );

  if (annualRows.length > 0) {
    await persistEnrichCache(
      opts,
      record.ticker,
      { annualRows, industryProxy, dividendYield },
      enriched
    );
  }

  return enriched;
}
