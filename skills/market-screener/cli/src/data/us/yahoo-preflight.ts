import { yahooFetch } from "../../lib/yahoo-session.js";

const YAHOO_PREFLIGHT_URL = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL";

function yahooPreflightError(reason: string): Error {
  return new Error(`Yahoo preflight failed: ${reason}`);
}

function isYahooSession429(message: string): boolean {
  return (
    message.includes("Yahoo session bootstrap failed: 429") ||
    message.includes("Yahoo crumb failed: 429")
  );
}

function actionable429Message(detail: string): string {
  return (
    "Yahoo returned 429; this host/IP may be blocked by Yahoo CDN. " +
    "Set HTTPS_PROXY to a non-cloud exit, use a synced US cache, or run CN-only. " +
    `Original error: ${detail}`
  );
}

export async function probeYahooFinance(): Promise<void> {
  try {
    const res = await yahooFetch(YAHOO_PREFLIGHT_URL);
    if (!res.ok) {
      if (res.status === 429) {
        throw yahooPreflightError(actionable429Message("quote probe returned HTTP 429"));
      }
      throw yahooPreflightError(`quote probe returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      quoteResponse?: {
        result?: Array<{
          symbol?: string;
          regularMarketPrice?: number;
          marketCap?: number;
        }>;
      };
    };
    const row =
      body.quoteResponse?.result?.find((quote) => quote.symbol === "AAPL") ??
      body.quoteResponse?.result?.[0];
    const price = row?.regularMarketPrice;
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      throw yahooPreflightError("quote probe returned no usable AAPL price");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Yahoo preflight failed:")) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isYahooSession429(message)) {
      throw yahooPreflightError(actionable429Message(message));
    }
    throw yahooPreflightError(message);
  }
}
