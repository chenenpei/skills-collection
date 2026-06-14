import fs from "node:fs";
import path from "node:path";
import {
  formatFilterBreakdownReport,
  loadFilterBreakdown,
} from "../funnel/filter-breakdown.js";
import { parseMarkets } from "../lib/markets.js";
import { DEFAULT_CACHE_DIR } from "../lib/paths.js";
import type { Market } from "../funnel/types.js";

export interface FilterBreakdownCommandOptions {
  /** Funnel market output dir, e.g. funnel-output/2026-Q1/CN */
  fromOutput?: string;
  /** Same root as `screener run --output`; combined with quarter + markets */
  output?: string;
  quarter?: string;
  markets?: string;
  cacheDir?: string;
  topL2?: number;
  topL3?: number;
  /** Write report to this file instead of the default next to funnel artifacts */
  report?: string;
  stdout?: boolean;
}

function resolvePaths(opts: FilterBreakdownCommandOptions): {
  inputDir: string;
  reportPath: string;
  market: Market;
  quarter: string;
} {
  if (opts.fromOutput) {
    const inputDir = path.resolve(opts.fromOutput);
    const market = path.basename(inputDir) as Market;
    if (market !== "CN" && market !== "US") {
      throw new Error(`Expected --from-output to end with CN or US, got: ${inputDir}`);
    }
    const quarter = opts.quarter ?? path.basename(path.dirname(inputDir));
    const reportPath = opts.report
      ? path.resolve(opts.report)
      : path.join(inputDir, "filter-breakdown.md");
    return { inputDir, reportPath, market, quarter };
  }

  if (!opts.output || !opts.quarter || !opts.markets) {
    throw new Error(
      "Provide either --from-output <funnel-output/quarter/MARKET> " +
        "or --output <root> --quarter YYYY-Qn --markets CN|US"
    );
  }

  const { markets } = parseMarkets(opts.markets);
  if (markets.length !== 1) {
    throw new Error("filter-breakdown supports one market per invocation (CN or US)");
  }
  const market = markets[0];
  const inputDir = path.join(path.resolve(opts.output), opts.quarter, market);
  const reportPath = opts.report
    ? path.resolve(opts.report)
    : path.join(inputDir, "filter-breakdown.md");

  return { inputDir, reportPath, market, quarter: opts.quarter };
}

export async function filterBreakdownCommand(
  opts: FilterBreakdownCommandOptions
): Promise<void> {
  const { inputDir, reportPath, market, quarter } = resolvePaths(opts);

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Funnel output directory not found: ${inputDir}`);
  }

  const doc = loadFilterBreakdown({
    outputDir: inputDir,
    cacheDir: opts.cacheDir ?? DEFAULT_CACHE_DIR,
    quarter,
    market,
  });

  const report = formatFilterBreakdownReport(doc, {
    topL2: opts.topL2 ?? 25,
    topL3: opts.topL3 ?? 25,
  });

  if (opts.stdout) {
    console.log(report);
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`Filter breakdown written → ${reportPath}`);
}
