import path from "node:path";
import { createAdapter } from "../data/registry.js";
import { runFunnel } from "../funnel/run.js";
import { parseMarkets } from "../lib/markets.js";
import { DEFAULT_CACHE_DIR } from "../lib/paths.js";
import { createProgressLogger } from "../lib/progress.js";
import { loadSpecBundle } from "../spec/loader.js";

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
  if (adapter.enrichRecords && adapterKind === "live") {
    const enriched = await adapter.enrichRecords(universe, enrichOpts);
    universe = enriched.universe;
    prefilterExcluded = enriched.prefilterExcluded;
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
