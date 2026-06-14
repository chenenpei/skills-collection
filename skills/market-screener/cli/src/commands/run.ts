import path from "node:path";
import { createAdapter } from "../data/registry.js";
import { listEnrichCacheGaps } from "../lib/cache.js";
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
}

export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const progress = createProgressLogger();
  const adapterKind = opts.adapter ?? "fixture";
  const { marketScope, markets } = parseMarkets(opts.markets);

  progress.phase(`Loading spec from ${path.resolve(opts.spec)}…`);
  const bundle = await loadSpecBundle(path.resolve(opts.spec));

  const adapter = createAdapter(adapterKind, opts.fixturesDir);
  const enrichOpts = {
    quarter: opts.quarter,
    cacheDir: DEFAULT_CACHE_DIR,
    concurrency: opts.enrichConcurrency ?? DEFAULT_ENRICH_CONCURRENCY,
    skipCache: opts.skipCache ?? false,
    killGates: bundle.killGates,
    progress,
  };

  progress.phase(`Adapter: ${adapterKind} — loading ${marketScope} universe…`);
  let universe = await adapter.loadUniverse(markets, { progress });
  progress.phase(`Loaded ${universe.length} securities`);

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
