import path from "node:path";
import { createAdapter } from "../data/registry.js";
import { listEnrichCacheGaps } from "../lib/cache.js";
import { assertCnQuoteUniverseIntegrity, probeCnQuotes } from "../data/cn/quotes.js";
import { probeCnDatacenter } from "../data/cn/eastmoney.js";
import { runFunnel } from "../funnel/run.js";
import { parseMarkets } from "../lib/markets.js";
import { DEFAULT_CACHE_DIR } from "../lib/paths.js";
import { createProgressLogger } from "../lib/progress.js";
import { loadSpecBundle } from "../spec/loader.js";
import type { EnrichRunStats } from "../data/types.js";
import type { Market } from "../funnel/types.js";

/** Default per-ticker enrichment workers; each ticker may issue multiple HTTP calls. */
const DEFAULT_ENRICH_CONCURRENCY = 4;

export interface RunCommandOptions {
  markets: string;
  quarter: string;
  output: string;
  spec: string;
  adapter?: "fixture" | "live";
  fixturesDir?: string;
  enrichConcurrency?: number;
  skipCache?: boolean;
  skipPreflight?: boolean;
  allowDegraded?: boolean;
  quoteFallbackQuarter?: string;
  quoteFallbackFixturesDir?: string;
  inheritCacheFrom?: string;
}

export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const progress = createProgressLogger();
  const adapterKind = opts.adapter ?? "fixture";
  const { marketScope, markets } = parseMarkets(opts.markets);

  progress.phase(`Loading spec from ${path.resolve(opts.spec)}…`);
  const bundle = await loadSpecBundle(path.resolve(opts.spec));

  const adapter = createAdapter(adapterKind, opts.fixturesDir, {
    allowDegraded: opts.allowDegraded,
    quoteFallbackQuarter: opts.quoteFallbackQuarter,
    quoteFallbackFixturesDir: opts.quoteFallbackFixturesDir,
  });
  const enrichOpts = {
    quarter: opts.quarter,
    cacheDir: DEFAULT_CACHE_DIR,
    concurrency: opts.enrichConcurrency ?? DEFAULT_ENRICH_CONCURRENCY,
    skipCache: opts.skipCache ?? false,
    killGates: bundle.killGates,
    progress,
    specDir: path.resolve(opts.spec),
    inheritCacheFrom: opts.inheritCacheFrom,
  };

  if (adapterKind === "live" && markets.includes("CN") && !opts.skipPreflight) {
    progress.phase("Preflight: CN data sources…");
    await probeCnDatacenter();
    await probeCnQuotes();
  }

  progress.phase(`Adapter: ${adapterKind} — loading ${marketScope} universe…`);
  let universe = await adapter.loadUniverse(markets, { progress, quarter: opts.quarter });
  progress.phase(`Loaded ${universe.length} securities`);

  const cnRecords = universe.filter((r) => r.market === "CN");
  if (adapterKind === "live" && cnRecords.length > 0) {
    const report = assertCnQuoteUniverseIntegrity(cnRecords);
    progress.phase(
      `CN quote integrity OK (${report.universe_count} tickers, PE ${(report.pe_ttm_present_rate * 100).toFixed(1)}%, PB ${(report.pb_present_rate * 100).toFixed(1)}%)`
    );
  }

  let prefilterExcluded: typeof universe = [];
  let enrichStatsByMarket: Partial<Record<Market, EnrichRunStats>> | undefined;
  let cacheGapByMarket: Partial<Record<Market, { count: number; samples: string[] }>> | undefined;

  if (adapter.enrichRecords && adapterKind === "live") {
    const enriched = await adapter.enrichRecords(universe, enrichOpts);
    universe = enriched.universe;
    prefilterExcluded = enriched.prefilterExcluded;
    enrichStatsByMarket = enriched.enrichStatsByMarket;

    if (markets.includes("CN")) {
      const cnSurvivors = universe.filter((r) => r.market === "CN");
      const cacheGap = await listEnrichCacheGaps(
        cnSurvivors.map((r) => r.ticker),
        DEFAULT_CACHE_DIR,
        opts.quarter,
        "CN"
      );
      cacheGapByMarket = { CN: cacheGap };
      if (cnSurvivors.length > 0 && cacheGap.count / cnSurvivors.length > 0.03) {
        progress.warn(
          `CN enrichment cache missing for ${cacheGap.count}/${cnSurvivors.length} tickers ` +
            `(${((cacheGap.count / cnSurvivors.length) * 100).toFixed(1)}%) — ` +
            "run repair-enrich-cache.ts before sign-off"
        );
      }
    }
  }

  const outputDir = path.join(path.resolve(opts.output), opts.quarter);
  progress.phase(`Running funnel (${marketScope}, ${universe.length} enriched records)…`);

  const result = await runFunnel({
    bundle,
    universe,
    prefilterExcluded,
    quarter: opts.quarter,
    marketScope,
    outputDir,
    progress,
    enrichStatsByMarket,
    cacheGapByMarket,
  });

  if (result.candidateCount === 0 && result.deferredCount === 0) {
    progress.warn("Funnel produced no candidates — review excluded.yaml and funnel-diagnostics.yaml");
  }

  console.log(
    `Funnel run complete (${opts.quarter}, ${marketScope}): ` +
      `${result.candidateCount} candidates, ${result.deferredCount} deferred, ` +
      `${result.excludedCount} excluded → ${outputDir}`
  );
}
