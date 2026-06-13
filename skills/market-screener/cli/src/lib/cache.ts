import fs from "node:fs/promises";
import path from "node:path";

function cachePath(
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
    const raw = await fs.readFile(cachePath(cacheDir, quarter, market, ticker), "utf8");
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
  const file = cachePath(cacheDir, quarter, market, ticker);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}
