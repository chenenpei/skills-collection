/**
 * Industry-grouped filter breakdown from funnel output + enrichment cache.
 *
 * Usage (same --output root as screener run):
 *   npm run dev -- filter-breakdown --output ./funnel-output/ --quarter 2026-Q1 --markets CN
 *
 * Or explicit market dir:
 *   npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN
 */
import { filterBreakdownCommand } from "../src/commands/filter-breakdown.js";
import { DEFAULT_CACHE_DIR } from "../src/lib/paths.js";

function parseArgs(argv: string[]): Parameters<typeof filterBreakdownCommand>[0] {
  const opts: Parameters<typeof filterBreakdownCommand>[0] = {
    cacheDir: DEFAULT_CACHE_DIR,
    topL2: 25,
    topL3: 25,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from-output") opts.fromOutput = argv[++i];
    else if (arg === "--output") opts.output = argv[++i];
    else if (arg === "--quarter") opts.quarter = argv[++i];
    else if (arg === "--markets") opts.markets = argv[++i];
    else if (arg === "--cache-dir") opts.cacheDir = argv[++i];
    else if (arg === "--report") opts.report = argv[++i];
    else if (arg === "--top-l2") opts.topL2 = Number(argv[++i] ?? 25);
    else if (arg === "--top-l3") opts.topL3 = Number(argv[++i] ?? 25);
    else if (arg === "--stdout") opts.stdout = true;
  }

  return opts;
}

filterBreakdownCommand(parseArgs(process.argv.slice(2))).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
