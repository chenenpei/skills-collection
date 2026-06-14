import fs from "node:fs/promises";
import path from "node:path";

export const ENRICH_STATS_SAMPLE_CAP = 20;

export function enrichCacheFilePath(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string
): string {
  return path.join(cacheDir, quarter, market, `${ticker}.json`);
}

export async function readCache<T>(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string
): Promise<T | null> {
  try {
    const raw = await fs.readFile(
      enrichCacheFilePath(cacheDir, quarter, market, ticker),
      "utf8"
    );
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string,
  payload: unknown
): Promise<void> {
  const file = enrichCacheFilePath(cacheDir, quarter, market, ticker);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}

type EnrichCachePayloadLike = { annualRows?: unknown[] };

export async function isEnrichCacheGap(
  cacheDir: string,
  quarter: string,
  market: string,
  ticker: string
): Promise<boolean> {
  const cached = await readCache<EnrichCachePayloadLike>(cacheDir, quarter, market, ticker);
  return (cached?.annualRows?.length ?? 0) === 0;
}

export async function findEnrichCacheGapTickers(
  tickers: string[],
  cacheDir: string,
  quarter: string,
  market: string
): Promise<string[]> {
  const dir = path.join(cacheDir, quarter, market);
  let cachedTickers: Set<string>;
  try {
    const files = await fs.readdir(dir);
    cachedTickers = new Set(
      files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length))
    );
  } catch {
    cachedTickers = new Set();
  }

  const missing: string[] = [];
  for (const ticker of tickers) {
    if (!cachedTickers.has(ticker)) {
      missing.push(ticker);
      continue;
    }
    if (await isEnrichCacheGap(cacheDir, quarter, market, ticker)) {
      missing.push(ticker);
    }
  }
  return missing;
}

export async function listEnrichCacheGaps(
  tickers: string[],
  cacheDir: string,
  quarter: string,
  market: string,
  sampleCap = ENRICH_STATS_SAMPLE_CAP
): Promise<{ count: number; samples: string[] }> {
  const gapTickers = await findEnrichCacheGapTickers(tickers, cacheDir, quarter, market);
  return { count: gapTickers.length, samples: gapTickers.slice(0, sampleCap) };
}
