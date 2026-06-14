import path from "node:path";
import { createAdapter } from "../data/registry.js";
import { runFunnel } from "../funnel/run.js";
import { parseMarkets } from "../lib/markets.js";
import { DEFAULT_CACHE_DIR } from "../lib/paths.js";
import { loadSpecBundle } from "../spec/loader.js";

/** Default per-ticker enrichment workers; each ticker may issue 2 HTTP calls. */
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
  const { marketScope, markets } = parseMarkets(opts.markets);
  const bundle = await loadSpecBundle(path.resolve(opts.spec));
  const adapter = createAdapter(opts.adapter ?? "fixture", opts.fixturesDir);
  const enrichOpts = {
    quarter: opts.quarter,
    cacheDir: DEFAULT_CACHE_DIR,
    concurrency: opts.enrichConcurrency ?? DEFAULT_ENRICH_CONCURRENCY,
    skipCache: opts.skipCache ?? false,
    killGates: bundle.killGates,
  };

  let universe = await adapter.loadUniverse(markets);
  let prefilterExcluded: typeof universe = [];
  if (adapter.enrichRecords && (opts.adapter ?? "fixture") === "live") {
    const enriched = await adapter.enrichRecords(universe, enrichOpts);
    universe = enriched.universe;
    prefilterExcluded = enriched.prefilterExcluded;
  }
  const outputDir = path.join(path.resolve(opts.output), opts.quarter);

  const result = await runFunnel({
    bundle,
    universe,
    prefilterExcluded,
    quarter: opts.quarter,
    marketScope,
    outputDir,
  });

  console.log(
    `Funnel run complete (${opts.quarter}, ${marketScope}): ` +
      `${result.candidateCount} candidates, ${result.deferredCount} deferred, ` +
      `${result.excludedCount} excluded → ${outputDir}`
  );
}
