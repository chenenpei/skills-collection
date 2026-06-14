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
import type { Market } from "../../funnel/types.js";
import type { MarketDataAdapter } from "../types.js";

const SCREENER_URL = "https://query1.finance.yahoo.com/v1/finance/screener";
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
};

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
  });
}

export function createUsYahooAdapter(_opts: { cacheDir: string }): MarketDataAdapter {
  return {
    async loadUniverse(markets: Market[]): Promise<SecurityRecord[]> {
      if (!markets.includes("US")) return [];

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

        if (quotes.length === 0) break;
        offset += quotes.length;
      }

      return records;
    },
  };
}
