import { readCache, writeCache } from "../../lib/cache.js";
import type { EnrichOptions } from "../types.js";
import type { SecurityRecord } from "../../funnel/kill-gates.js";
import type { DataConfidence } from "../../funnel/types.js";
import {
  mergeEnrichment,
  updatedQuoteHistory,
  type DividendWithConfidence,
  type EnrichCachePayload,
} from "../merge-enrichment.js";
import { annualRowsNeedMetricRefresh, type AnnualFinancialRow } from "../metrics.js";
import {
  fetchCnAnnualRows,
  fetchCnDividendYield,
  fetchCnIndustryProxy,
  fetchCnSupplementalAnnualRows,
  mergeSupplementalIntoAnnualRows,
} from "./eastmoney.js";
import { isCnBankIndustry } from "./bank-indicators/is-bank-industry.js";
import { scrapeBankIndicators } from "./bank-indicators/index.js";
import type { BankScrapeMetrics } from "./bank-indicators/types.js";
import { applyBankScrapeToRecord } from "./bank-enrich.js";

export { mergeEnrichment as mergeCnEnrichment } from "../merge-enrichment.js";

function deriveFiscalYear(quarter: string): number {
  return quarter.startsWith("2026") ? 2024 : Number(quarter.slice(0, 4)) - 1;
}

async function refreshCnAnnualRows(
  ticker: string,
  existing: AnnualFinancialRow[]
): Promise<AnnualFinancialRow[]> {
  const [freshAnnual, supplemental] = await Promise.all([
    fetchCnAnnualRows(ticker).catch(() => [] as AnnualFinancialRow[]),
    fetchCnSupplementalAnnualRows(ticker).catch(() => new Map()),
  ]);
  const base = freshAnnual.length > 0 ? freshAnnual : existing;
  return mergeSupplementalIntoAnnualRows(base, supplemental);
}

async function resolveDividendYield(
  ticker: string,
  cached?: EnrichCachePayload
): Promise<DividendWithConfidence | undefined> {
  if (cached?.dividendYield !== undefined) {
    return {
      yield: cached.dividendYield,
      dataConfidence: cached.dividendYieldConfidence ?? "medium",
    };
  }
  try {
    return await fetchCnDividendYield(ticker);
  } catch {
    return undefined;
  }
}

async function applyBankScrapeIfNeeded(
  ticker: string,
  enriched: SecurityRecord,
  opts: EnrichOptions,
  industryProxy: string | undefined,
  cached?: EnrichCachePayload
): Promise<{ record: SecurityRecord; bankScrape?: EnrichCachePayload["bankScrape"] }> {
  if (!isCnBankIndustry(industryProxy)) {
    return { record: enriched };
  }

  const fiscalYear = deriveFiscalYear(opts.quarter);
  const cachedScrape = cached?.bankScrape;

  let scrape:
    | { metrics: BankScrapeMetrics; dataConfidence: DataConfidence; sourceUrls: string[] }
    | undefined;
  let bankScrape: EnrichCachePayload["bankScrape"];

  if (cachedScrape && !opts.skipCache) {
    scrape = {
      metrics: cachedScrape.metrics,
      dataConfidence: "medium",
      sourceUrls: cachedScrape.sourceUrls,
    };
    bankScrape = cachedScrape;
  } else if (opts.specDir) {
    const result = await scrapeBankIndicators(ticker, fiscalYear, opts.specDir).catch(() => undefined);
    if (result) {
      scrape = {
        metrics: result.metrics,
        dataConfidence: result.dataConfidence,
        sourceUrls: result.sourceUrls,
      };
      bankScrape = {
        fiscalYear: result.fiscalYear,
        metrics: result.metrics,
        scrapedAt: result.scrapedAt,
        sourceUrls: result.sourceUrls,
      };
    }
  }

  if (!scrape) return { record: enriched };

  return {
    record: applyBankScrapeToRecord(enriched, scrape),
    bankScrape,
  };
}

async function persistEnrichCache(
  opts: EnrichOptions,
  ticker: string,
  payload: EnrichCachePayload,
  enriched: SecurityRecord
): Promise<void> {
  if (opts.skipCache) return;
  await writeCache(opts.cacheDir, opts.quarter, "CN", ticker, {
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
      let annualRows = cached.annualRows;
      if (annualRowsNeedMetricRefresh(annualRows)) {
        annualRows = await refreshCnAnnualRows(record.ticker, annualRows);
      }
      const dividend = await resolveDividendYield(record.ticker, cached);
      const enriched = mergeEnrichment(
        record,
        annualRows,
        cached.industryProxy,
        dividend,
        { quarter: opts.quarter, quoteHistory: cached.quoteHistory }
      );
      const { record: finalRecord, bankScrape } = await applyBankScrapeIfNeeded(
        record.ticker,
        enriched,
        opts,
        cached.industryProxy,
        cached
      );
      const payload: EnrichCachePayload = {
        ...cached,
        annualRows,
        dividendYield: cached.dividendYield ?? dividend?.yield,
        dividendYieldConfidence: cached.dividendYieldConfidence ?? dividend?.dataConfidence,
        bankScrape: bankScrape ?? cached.bankScrape,
      };
      await persistEnrichCache(opts, record.ticker, payload, finalRecord);
      return finalRecord;
    }
  }

  const annualRows = await fetchCnAnnualRows(record.ticker);
  let industryProxy: string | undefined;
  let mergedRows = annualRows;
  let dividend: DividendWithConfidence | undefined;

  if (annualRows.length > 0) {
    const [proxy, supplemental, yieldVal] = await Promise.all([
      fetchCnIndustryProxy(record.ticker),
      fetchCnSupplementalAnnualRows(record.ticker).catch(() => new Map()),
      resolveDividendYield(record.ticker),
    ]);
    industryProxy = proxy;
    mergedRows = mergeSupplementalIntoAnnualRows(annualRows, supplemental);
    dividend = yieldVal;
  } else {
    [industryProxy, dividend] = await Promise.all([
      fetchCnIndustryProxy(record.ticker).catch(() => undefined),
      resolveDividendYield(record.ticker),
    ]);
  }

  const enriched = mergeEnrichment(record, mergedRows, industryProxy, dividend, {
    quarter: opts.quarter,
  });

  const { record: finalRecord, bankScrape } = await applyBankScrapeIfNeeded(
    record.ticker,
    enriched,
    opts,
    industryProxy
  );

  if (mergedRows.length > 0) {
    await persistEnrichCache(
      opts,
      record.ticker,
      {
        annualRows: mergedRows,
        industryProxy,
        dividendYield: dividend?.yield,
        dividendYieldConfidence: dividend?.dataConfidence,
        bankScrape,
      },
      finalRecord
    );
  }

  return finalRecord;
}
