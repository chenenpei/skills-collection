import type { SecurityRecord } from "../../funnel/kill-gates.js";

/** Shared adapter defaults for live providers that only supply quote-level fields. */
export function withAdapterDefaults(
  partial: Pick<
    SecurityRecord,
    "ticker" | "market" | "companyName" | "currency" | "status" | "marketCap" | "listingAgeYears"
  > &
    Partial<SecurityRecord>
): SecurityRecord {
  return {
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
    ...partial,
  };
}

import { httpFetch } from "../../lib/http-fetch.js";
import { withHostLimit } from "../../lib/host-limit.js";
import type { ProgressLogger } from "../../lib/progress.js";
import type { Market } from "../../funnel/types.js";
import type { MarketDataAdapter } from "../types.js";

const SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener";
const YAHOO_QUOTE_HOST = "query1.finance.yahoo.com";
const YAHOO_MAX_CONCURRENT = 4;
const PAGE_SIZE = 250;
const US_MARKET_CAP_FLOOR = 300_000_000;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  marketCap?: number;
  quoteType?: string;
  firstTradeDateMilliseconds?: number;
  trailingPE?: number;
  priceToBook?: number;
  regularMarketPrice?: number;
  fiftyTwoWeekHigh?: number;
};

function quoteMetric(value: number | undefined): SecurityRecord["metrics"][string] | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return { value, dataConfidence: "medium" };
}

function quoteMetricsFromYahoo(quote: YahooQuote): SecurityRecord["metrics"] {
  const metrics: SecurityRecord["metrics"] = {};
  const peTtm = quoteMetric(quote.trailingPE);
  const pb = quoteMetric(quote.priceToBook);
  const price = quoteMetric(quote.regularMarketPrice);
  const high52 = quoteMetric(quote.fiftyTwoWeekHigh);
  if (peTtm) metrics.pe_ttm = peTtm;
  if (pb) metrics.pb = pb;
  if (price) metrics.price = price;
  if (high52) metrics.high_52w = high52;
  if (price && high52 && high52.value > 0) {
    metrics.price_vs_52w_high = {
      value: price.value / high52.value,
      dataConfidence: "medium",
    };
  }
  return metrics;
}

function buildScreenerBody(offset: number): string {
  return JSON.stringify({
    size: PAGE_SIZE,
    offset,
    sortField: "marketcap",
    sortType: "DESC",
    quoteType: "EQUITY",
    query: {
      operator: "AND",
      operands: [
        { operator: "eq", operands: ["region", "us"] },
        { operator: "gt", operands: ["intradaymarketcap", US_MARKET_CAP_FLOOR] },
      ],
    },
  });
}

function listingAgeYears(firstTradeMs: number | undefined): number {
  if (firstTradeMs === undefined || firstTradeMs <= 0) return 0;
  return Math.max(0, (Date.now() - firstTradeMs) / MS_PER_YEAR);
}

function mapQuoteToSecurityRecord(quote: YahooQuote): SecurityRecord | null {
  const ticker = String(quote.symbol ?? "").trim();
  if (!ticker || quote.quoteType !== "EQUITY") return null;

  return withAdapterDefaults({
    ticker,
    market: "US",
    companyName: String(quote.longName ?? quote.shortName ?? ticker),
    currency: "USD",
    status: "active",
    marketCap: Number(quote.marketCap ?? 0),
    listingAgeYears: listingAgeYears(quote.firstTradeDateMilliseconds),
    metrics: quoteMetricsFromYahoo(quote),
  });
}

export function createUsYahooAdapter(_opts: { cacheDir: string }): MarketDataAdapter {
  return {
    async loadUniverse(
      markets: Market[],
      opts?: { progress?: ProgressLogger }
    ): Promise<SecurityRecord[]> {
      if (!markets.includes("US")) return [];

      const progress = opts?.progress;
      progress?.phase("Fetching US quote list from Yahoo screener…");

      const records: SecurityRecord[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;

      while (offset < total) {
        const res = await httpFetch(SCREENER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: buildScreenerBody(offset),
        });
        if (!res.ok) throw new Error(`Yahoo screener failed: ${res.status}`);

        const body = (await res.json()) as {
          finance?: { result?: Array<{ quotes?: YahooQuote[]; total?: number }> };
        };
        const page = body.finance?.result?.[0];
        const quotes = page?.quotes ?? [];
        total = page?.total ?? quotes.length;

        for (const quote of quotes) {
          const record = mapQuoteToSecurityRecord(quote);
          if (record) records.push(record);
        }

        progress?.tick(records.length, total, "US quotes");

        if (quotes.length === 0) break;
        offset += quotes.length;
      }

      return records;
    },
  };
}

export async function fetchUsQuoteBulk(ticker: string): Promise<SecurityRecord["metrics"] | undefined> {
  const path =
    `/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics`;
  const res = await withHostLimit(YAHOO_QUOTE_HOST, YAHOO_MAX_CONCURRENT, () =>
    httpFetch(`https://${YAHOO_QUOTE_HOST}${path}`, {
      headers: { "User-Agent": "market-screener-cli/0.1" },
    })
  );
  if (!res.ok) return undefined;

  const body = (await res.json()) as {
    quoteSummary?: {
      result?: Array<{
        summaryDetail?: {
          trailingPE?: { raw?: number };
          priceToBook?: { raw?: number };
          regularMarketPrice?: { raw?: number };
          fiftyTwoWeekHigh?: { raw?: number };
        };
        defaultKeyStatistics?: {
          trailingPE?: { raw?: number };
          priceToBook?: { raw?: number };
        };
      }>;
    };
  };
  const row = body.quoteSummary?.result?.[0];
  if (!row) return undefined;

  const detail = row.summaryDetail;
  const stats = row.defaultKeyStatistics;
  return quoteMetricsFromYahoo({
    trailingPE: detail?.trailingPE?.raw ?? stats?.trailingPE?.raw,
    priceToBook: detail?.priceToBook?.raw ?? stats?.priceToBook?.raw,
    regularMarketPrice: detail?.regularMarketPrice?.raw,
    fiftyTwoWeekHigh: detail?.fiftyTwoWeekHigh?.raw,
  });
}

export async function fetchUsDividendYield(ticker: string): Promise<number | undefined> {
  const path = `/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail`;
  const res = await withHostLimit(YAHOO_QUOTE_HOST, YAHOO_MAX_CONCURRENT, () =>
    httpFetch(`https://${YAHOO_QUOTE_HOST}${path}`, {
      headers: { "User-Agent": "market-screener-cli/0.1" },
    })
  );
  if (!res.ok) return undefined;

  const body = (await res.json()) as {
    quoteSummary?: {
      result?: Array<{
        summaryDetail?: {
          dividendYield?: { raw?: number };
          trailingAnnualDividendRate?: { raw?: number };
          regularMarketPrice?: { raw?: number };
        };
      }>;
    };
  };
  const detail = body.quoteSummary?.result?.[0]?.summaryDetail;
  if (!detail) return undefined;

  const direct = detail.dividendYield?.raw;
  if (direct !== undefined && Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const rate = detail.trailingAnnualDividendRate?.raw;
  const price = detail.regularMarketPrice?.raw;
  if (
    rate !== undefined &&
    price !== undefined &&
    Number.isFinite(rate) &&
    Number.isFinite(price) &&
    price > 0
  ) {
    return rate / price;
  }

  return undefined;
}
