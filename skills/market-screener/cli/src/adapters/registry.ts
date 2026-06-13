import { DEFAULT_CACHE_DIR, DEFAULT_FIXTURES_DIR } from "../paths.js";
import { createCnEastMoneyAdapter } from "./cn-eastmoney.js";
import { createFixtureAdapter } from "./fixture.js";
import { createUsYahooAdapter } from "./us-yahoo.js";
import type { MarketDataAdapter } from "./types.js";
import type { Market } from "../engine/types.js";
import type { SecurityRecord } from "../engine/kill-gates.js";

export type AdapterKind = "fixture" | "live";

export function createLiveAdapter(cacheDir = DEFAULT_CACHE_DIR): MarketDataAdapter {
  const cnAdapter = createCnEastMoneyAdapter({ cacheDir });
  const usAdapter = createUsYahooAdapter({ cacheDir });

  return {
    async loadUniverse(markets: Market[]): Promise<SecurityRecord[]> {
      const records: SecurityRecord[] = [];
      if (markets.includes("CN")) {
        records.push(...(await cnAdapter.loadUniverse(["CN"])));
      }
      if (markets.includes("US")) {
        records.push(...(await usAdapter.loadUniverse(["US"])));
      }
      return records;
    },
  };
}

export function createAdapter(
  kind: AdapterKind,
  fixturesDir = DEFAULT_FIXTURES_DIR
): MarketDataAdapter {
  return kind === "fixture" ? createFixtureAdapter(fixturesDir) : createLiveAdapter();
}
