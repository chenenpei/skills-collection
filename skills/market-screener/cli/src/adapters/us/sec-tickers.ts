import { httpFetch } from "../../lib/http-fetch.js";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const SEC_UA = "market-screener-cli/0.1 (contact: dev@local)";

type TickerEntry = { cik_str: number; ticker: string; title: string };

export function parseTickerMap(raw: Record<string, TickerEntry>): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of Object.values(raw)) {
    const cik = String(entry.cik_str).padStart(10, "0");
    map.set(entry.ticker.toUpperCase(), cik);
  }
  return map;
}

let cachedMap: Map<string, string> | null = null;

export async function loadTickerToCikMap(): Promise<Map<string, string>> {
  if (cachedMap) return cachedMap;
  const res = await httpFetch(SEC_TICKERS_URL, {
    headers: { "User-Agent": SEC_UA },
  });
  if (!res.ok) throw new Error(`SEC tickers failed: ${res.status}`);
  cachedMap = parseTickerMap((await res.json()) as Record<string, TickerEntry>);
  return cachedMap;
}

export async function resolveCik(ticker: string): Promise<string | undefined> {
  const map = await loadTickerToCikMap();
  return map.get(ticker.toUpperCase());
}
