import fs from "node:fs/promises";
import path from "node:path";
import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { Market } from "../funnel/types.js";
import { DEFAULT_FIXTURES_DIR } from "../lib/paths.js";
import type { LoadUniverseOptions, MarketDataAdapter } from "./types.js";

async function loadFixtureFile(
  fixturesDir: string,
  market: Market
): Promise<SecurityRecord[]> {
  const filePath = path.join(fixturesDir, `universe-${market.toLowerCase()}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as SecurityRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export function createFixtureAdapter(fixturesDir = DEFAULT_FIXTURES_DIR): MarketDataAdapter {
  return {
    async loadUniverse(
      markets: Market[],
      _opts?: LoadUniverseOptions
    ): Promise<SecurityRecord[]> {
      const records: SecurityRecord[] = [];
      for (const market of markets) {
        records.push(...(await loadFixtureFile(fixturesDir, market)));
      }
      return records;
    },
  };
}
