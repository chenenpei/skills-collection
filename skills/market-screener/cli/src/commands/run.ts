import path from "node:path";
import { createAdapter } from "../adapters/registry.js";
import { runFunnel } from "../engine/funnel-run.js";
import { parseMarkets } from "../lib/markets.js";
import { loadSpecBundle } from "../spec/loader.js";

export interface RunCommandOptions {
  markets: string;
  quarter: string;
  output: string;
  spec: string;
  adapter?: "fixture" | "live";
  fixturesDir?: string;
}

export async function runCommand(opts: RunCommandOptions): Promise<void> {
  const { marketScope, markets } = parseMarkets(opts.markets);
  const bundle = await loadSpecBundle(path.resolve(opts.spec));
  const adapter = createAdapter(opts.adapter ?? "fixture", opts.fixturesDir);
  const universe = await adapter.loadUniverse(markets);
  const outputDir = path.join(path.resolve(opts.output), opts.quarter);

  const result = await runFunnel({
    bundle,
    universe,
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
