import fs from "node:fs";
import path from "node:path";
import {
  formatFilterBreakdownReport,
  loadFilterBreakdown,
  loadTemplateTrackBreakdown,
  type FunnelTrack,
  type TemplateTrackBreakdownFilters,
} from "../funnel/filter-breakdown.js";
import type { ExitStage } from "../funnel/filter-breakdown.js";
import { parseMarkets } from "../lib/markets.js";
import { DEFAULT_CACHE_DIR } from "../lib/paths.js";
import { loadSpecBundle } from "../spec/loader.js";
import type { Market } from "../domain/types.js";

export interface FilterBreakdownCommandOptions {
  fromOutput?: string;
  output?: string;
  quarter?: string;
  markets?: string;
  cacheDir?: string;
  spec?: string;
  topL2?: number;
  topL3?: number;
  report?: string;
  stdout?: boolean;
  templateTracks?: boolean;
  stage?: string;
  template?: string;
  track?: string;
  industryL1?: string;
  industryL2?: string;
  industryL3?: string;
  trackTop?: number;
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

function parseStages(stage?: string): ExitStage[] | undefined {
  if (!stage?.trim()) return undefined;
  return stage.split(",").map((s) => s.trim()) as ExitStage[];
}

function parseTracks(track?: string): FunnelTrack[] | undefined {
  if (!track?.trim()) return undefined;
  const tracks = track.split(",").map((s) => s.trim()) as FunnelTrack[];
  for (const t of tracks) {
    if (t !== "quality" && t !== "mispricing") {
      throw new Error(`Invalid --track value: ${t}`);
    }
  }
  return tracks;
}

function buildTrackFilters(opts: FilterBreakdownCommandOptions): TemplateTrackBreakdownFilters {
  const filters: TemplateTrackBreakdownFilters = {};
  const stages = parseStages(opts.stage);
  if (stages?.length) filters.stages = stages;
  if (opts.template?.trim()) {
    filters.templates = opts.template.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const tracks = parseTracks(opts.track);
  if (tracks?.length) filters.tracks = tracks;
  if (opts.industryL1) filters.industryL1 = opts.industryL1;
  if (opts.industryL2) filters.industryL2 = opts.industryL2;
  if (opts.industryL3) filters.industryL3 = opts.industryL3;
  return filters;
}

export async function filterBreakdownCommand(
  opts: FilterBreakdownCommandOptions
): Promise<void> {
  const { inputDir, reportPath, market, quarter } = resolvePaths(opts);

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Funnel output directory not found: ${inputDir}`);
  }

  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const doc = loadFilterBreakdown({
    outputDir: inputDir,
    cacheDir,
    quarter,
    market,
  });

  let templateTrack;
  if (opts.templateTracks) {
    const specDir = path.resolve(opts.spec ?? path.join(import.meta.dirname, "../../../spec"));
    const bundle = await loadSpecBundle(specDir);
    templateTrack = loadTemplateTrackBreakdown({
      outputDir: inputDir,
      cacheDir,
      quarter,
      market,
      bundle,
      filters: buildTrackFilters(opts),
    });
  }

  const report = formatFilterBreakdownReport(doc, {
    topL2: opts.topL2 ?? 25,
    topL3: opts.topL3 ?? 25,
    templateTrack,
    trackTop: opts.trackTop ?? 25,
  });

  if (opts.stdout) {
    console.log(report);
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`Filter breakdown written → ${reportPath}`);
}
