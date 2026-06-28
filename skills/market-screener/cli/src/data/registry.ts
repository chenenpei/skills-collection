import { DEFAULT_CACHE_DIR, DEFAULT_FIXTURES_DIR } from "../lib/paths.js";
import {
  createCnEastMoneyAdapter,
  markCnQuoteUniverseDegraded,
  readCnQuoteUniverseSnapshot,
} from "./cn/quotes.js";
import { createFixtureAdapter } from "./fixture.js";
import { enrichLiveUniverse } from "./live.js";
import { createUsYahooAdapter } from "./us/quotes.js";
import type {
  DegradedLiveOptions,
  EnrichOptions,
  EnrichResult,
  LoadUniverseOptions,
  MarketDataAdapter,
} from "./types.js";
import type { Market } from "../funnel/types.js";
import type { SecurityRecord } from "../funnel/kill-gates.js";

export type AdapterKind = "fixture" | "live";

async function loadDegradedCnUniverse(
  cacheDir: string,
  opts: LoadUniverseOptions | undefined,
  degraded: DegradedLiveOptions
): Promise<SecurityRecord[]> {
  if (!degraded.allowDegraded) {
    throw new Error("CN quote source failed and degraded mode is disabled");
  }

  if (degraded.quoteFallbackQuarter) {
    const snapshot = await readCnQuoteUniverseSnapshot(cacheDir, degraded.quoteFallbackQuarter);
    if (snapshot.length > 0) {
      opts?.progress?.warn(
        `CN quote source unavailable; using degraded snapshot ${degraded.quoteFallbackQuarter}`
      );
      return markCnQuoteUniverseDegraded(
        snapshot,
        `quote_degraded:snapshot:${degraded.quoteFallbackQuarter}`
      );
    }
  }

  if (degraded.quoteFallbackFixturesDir) {
    const fixtures = await createFixtureAdapter(degraded.quoteFallbackFixturesDir).loadUniverse(
      ["CN"],
      opts
    );
    if (fixtures.length > 0) {
      opts?.progress?.warn("CN quote source unavailable; using degraded fixture universe");
      return markCnQuoteUniverseDegraded(fixtures, "quote_degraded:fixture");
    }
  }

  throw new Error("CN quote source failed and no degraded quote fallback was available");
}

export function createLiveAdapter(
  cacheDir = DEFAULT_CACHE_DIR,
  degraded: DegradedLiveOptions = {}
): MarketDataAdapter {
  const cnAdapter = createCnEastMoneyAdapter({ cacheDir });
  const usAdapter = createUsYahooAdapter({ cacheDir });

  return {
    async loadUniverse(
      markets: Market[],
      opts?: LoadUniverseOptions
    ): Promise<SecurityRecord[]> {
      const records: SecurityRecord[] = [];
      if (markets.includes("CN")) {
        try {
          records.push(...(await cnAdapter.loadUniverse(["CN"], opts)));
        } catch {
          records.push(...(await loadDegradedCnUniverse(cacheDir, opts, degraded)));
        }
      }
      if (markets.includes("US")) {
        records.push(...(await usAdapter.loadUniverse(["US"], opts)));
      }
      return records;
    },

    async enrichRecords(records: SecurityRecord[], opts: EnrichOptions): Promise<EnrichResult> {
      return enrichLiveUniverse(records, { ...opts, cacheDir });
    },
  };
}

export function createAdapter(
  kind: AdapterKind,
  fixturesDir = DEFAULT_FIXTURES_DIR,
  degraded: DegradedLiveOptions = {}
): MarketDataAdapter {
  return kind === "fixture" ? createFixtureAdapter(fixturesDir) : createLiveAdapter(DEFAULT_CACHE_DIR, degraded);
}
