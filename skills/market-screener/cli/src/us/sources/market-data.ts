/**
 * Yahoo 的美国股票 universe、报价补充和会话访问层。
 * 输入为筛选器分页请求或单个 ticker；输出为基础 SecurityRecord 及可选估值/分红指标。
 * 它不做模板判断，保证实时 US 数据可交给统一模板筛选和历史归档流程。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type SecurityRecord, type Market } from "../../shared/financial-model.js";
import { resolveProxyUrl, withHostLimit, type ProgressLogger } from "../../shared/runtime.js";

import type { MarketDataAdapter } from "../screening.js";

/** Shared adapter defaults for live providers that only supply quote-level fields. */
export function withAdapterDefaults(
  partial: Pick<
    SecurityRecord,
    "ticker" | "market" | "companyName" | "currency" | "status" | "marketCap" | "listingAgeYears"
  > &
    Partial<SecurityRecord>,
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

type PresentMetricValue = SecurityRecord["metrics"][string] & { value: number };

function quoteMetric(value: number | undefined): PresentMetricValue | undefined {
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
    sortField: "intradaymarketcap",
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

// universe 仅收录可交易的 US EQUITY，避免 ETF 等工具进入公司基本面模板。
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

export function createUsYahooAdapter(fetcher: typeof yahooFetch = yahooFetch): MarketDataAdapter {
  return {
    async loadUniverse(
      markets: Market[],
      opts?: { progress?: ProgressLogger },
    ): Promise<SecurityRecord[]> {
      if (!markets.includes("US")) return [];

      const progress = opts?.progress;
      progress?.phase("Fetching US quote list from Yahoo screener…");

      const records: SecurityRecord[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;

      while (offset < total) {
        const res = await fetcher(SCREENER_URL, {
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

export async function fetchUsQuoteBulk(
  ticker: string,
): Promise<SecurityRecord["metrics"] | undefined> {
  return (await fetchUsQuoteSnapshot(ticker))?.metrics;
}

export interface UsQuoteSnapshot {
  metrics: SecurityRecord["metrics"];
  dividendYield?: number;
}

function dividendYieldFromDetail(
  detail:
    | {
        dividendYield?: { raw?: number };
        trailingAnnualDividendRate?: { raw?: number };
        regularMarketPrice?: { raw?: number };
      }
    | undefined,
): number | undefined {
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

/** One Yahoo summary response provides both valuation fields and dividend yield. */
export async function fetchUsQuoteSnapshot(
  ticker: string,
  includeMetrics = true,
): Promise<UsQuoteSnapshot | undefined> {
  const modules = includeMetrics ? "summaryDetail,defaultKeyStatistics" : "summaryDetail";
  const path = `/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;
  const res = await withHostLimit(YAHOO_QUOTE_HOST, YAHOO_MAX_CONCURRENT, () =>
    yahooFetch(`https://${YAHOO_QUOTE_HOST}${path}`),
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
          dividendYield?: { raw?: number };
          trailingAnnualDividendRate?: { raw?: number };
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
  return {
    metrics: includeMetrics
      ? quoteMetricsFromYahoo({
          trailingPE: detail?.trailingPE?.raw ?? stats?.trailingPE?.raw,
          priceToBook: detail?.priceToBook?.raw ?? stats?.priceToBook?.raw,
          regularMarketPrice: detail?.regularMarketPrice?.raw,
          fiftyTwoWeekHigh: detail?.fiftyTwoWeekHigh?.raw,
        })
      : {},
    dividendYield: dividendYieldFromDetail(detail),
  };
}

export async function fetchUsDividendYield(ticker: string): Promise<number | undefined> {
  const path = `/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail`;
  const res = await withHostLimit(YAHOO_QUOTE_HOST, YAHOO_MAX_CONCURRENT, () =>
    yahooFetch(`https://${YAHOO_QUOTE_HOST}${path}`),
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
  return dividendYieldFromDetail(body.quoteSummary?.result?.[0]?.summaryDetail);
}
// Yahoo 对 Node fetch 指纹限流，以下会话层通过 curl 与 cookie/crumb 保持可用性。
const execFileAsync = promisify(execFile);

const YAHOO_UA = "Mozilla/5.0";
const FC_YAHOO_URL = "https://fc.yahoo.com";
const CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const SESSION_TTL_MS = 30 * 60 * 1000;
const CRUMB_RETRY_ATTEMPTS = 4;
const CRUMB_RETRY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type YahooSession = {
  jarPath: string;
  crumb: string;
  fetchedAt: number;
};

let cachedSession: YahooSession | undefined;
let refreshPromise: Promise<YahooSession> | undefined;

function curlResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
  } as Response;
}

const WRITE_OUT_MARKER = "\n__CURL_HTTP_CODE__:";

async function curlRequest(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    cookieJar?: string;
    discardBody?: boolean;
  },
): Promise<{ status: number; body: string }> {
  const args = ["-sS"];
  const env = { ...process.env };
  const proxy = resolveProxyUrl();
  if (proxy) {
    env.HTTPS_PROXY = proxy;
    env.HTTP_PROXY = proxy;
    env.https_proxy = proxy;
    env.http_proxy = proxy;
  }
  if (opts.cookieJar) {
    args.push("-b", opts.cookieJar, "-c", opts.cookieJar);
  }
  if (opts.discardBody) {
    args.push("-o", "/dev/null", "-w", "%{http_code}");
  } else {
    args.push("-w", `${WRITE_OUT_MARKER}%{http_code}`);
  }
  args.push("-X", opts.method ?? "GET");
  for (const [key, value] of Object.entries(opts.headers ?? {})) {
    args.push("-H", `${key}: ${value}`);
  }
  if (opts.body !== undefined) {
    args.push("-d", opts.body);
  }
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 64 * 1024 * 1024,
    env,
  });

  if (opts.discardBody) {
    const status = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(status)) {
      throw new Error(`curl returned invalid status for ${url}`);
    }
    return { status, body: "" };
  }

  const markerAt = stdout.lastIndexOf(WRITE_OUT_MARKER);
  if (markerAt < 0) {
    throw new Error(`curl returned unexpected output for ${url}`);
  }
  const body = stdout.slice(0, markerAt);
  const status = Number.parseInt(stdout.slice(markerAt + WRITE_OUT_MARKER.length), 10);
  if (!Number.isFinite(status)) {
    throw new Error(`curl returned invalid status for ${url}`);
  }
  return { status, body };
}

async function fetchCrumbWithRetry(jarPath: string): Promise<{ status: number; body: string }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < CRUMB_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(CRUMB_RETRY_MS * attempt);
    const res = await curlRequest(CRUMB_URL, {
      cookieJar: jarPath,
      headers: { "User-Agent": YAHOO_UA },
    });
    if (res.status >= 200 && res.status < 300 && res.body.trim()) {
      return res;
    }
    lastStatus = res.status;
    if (res.status !== 429) break;
  }
  throw new Error(`Yahoo crumb failed: ${lastStatus}`);
}

async function refreshYahooSession(): Promise<YahooSession> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yahoo-session-"));
  const jarPath = path.join(dir, "cookies.jar");

  const fc = await curlRequest(FC_YAHOO_URL, {
    cookieJar: jarPath,
    headers: { "User-Agent": YAHOO_UA },
    discardBody: true,
  });
  if (fc.status !== 404 && fc.status !== 200) {
    throw new Error(`Yahoo session bootstrap failed: ${fc.status}`);
  }

  const crumbRes = await fetchCrumbWithRetry(jarPath);
  const crumb = crumbRes.body.trim();
  if (!crumb) {
    throw new Error("Yahoo crumb empty");
  }

  cachedSession = { jarPath, crumb, fetchedAt: Date.now() };
  return cachedSession;
}

async function getYahooSession(): Promise<YahooSession> {
  if (cachedSession && Date.now() - cachedSession.fetchedAt < SESSION_TTL_MS) {
    return cachedSession;
  }
  if (!refreshPromise) {
    refreshPromise = refreshYahooSession().finally(() => {
      refreshPromise = undefined;
    });
  }
  return refreshPromise;
}

/**
 * Yahoo Finance rejects Node fetch fingerprints (HTTP 429 on crumb).
 * Use curl so live US universe loading works behind macOS system proxies.
 */
export async function yahooFetch(input: string, init?: RequestInit): Promise<Response> {
  const { jarPath, crumb } = await getYahooSession();
  const url = new URL(input);
  url.searchParams.set("crumb", crumb);

  const headers: Record<string, string> = { "User-Agent": YAHOO_UA };
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((value, key) => {
      headers[key] = value;
    });
  }

  const body =
    typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : undefined;

  const res = await curlRequest(url.toString(), {
    method: init?.method ?? "GET",
    headers,
    body,
    cookieJar: jarPath,
  });
  return curlResponse(res.status, res.body);
}
