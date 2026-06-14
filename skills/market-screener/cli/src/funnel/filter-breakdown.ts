import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SpecBundle } from "../spec/types.js";
import { applyIndustryBenchmarks } from "../data/metrics.js";
import { loadEnrichedUniverseFromCache } from "../data/merge-enrichment.js";
import type { SecurityRecord } from "./kill-gates.js";
import { routeSecurityRecord } from "./run.js";
import {
  evaluateTemplateTrackDiagnostic,
  type TemplateTrackDiagnostic,
} from "./template-evaluator.js";
import type { Market } from "./types.js";
import { pct, sortedEntries } from "../lib/report-format.js";

export type ExitStage =
  | "prefilter_excluded"
  | "kill_excluded"
  | "sector_filtered"
  | "deferred"
  | "candidate";

export interface ClassifiedTicker {
  ticker: string;
  stage: ExitStage;
  reason: string;
  industryProxy: string | null;
  routedTemplate?: string;
}

export interface IndustryBucket {
  key: string;
  level: 1 | 2 | 3;
  total: number;
  byStage: Record<ExitStage, number>;
  byReason: Record<string, number>;
  candidateRate: number;
  killRate: number;
  sectorFilterRate: number;
}

export interface FilterBreakdownDoc {
  market: Market;
  quarter: string;
  universeCount: number;
  tickers: ClassifiedTicker[];
}

const PREFILTER_NO_INDUSTRY = "(预筛剔除 / 无 enrichment)";

export function parseIndustryLevels(
  proxy: string | null | undefined
): { l1: string; l2: string; l3: string } | null {
  if (!proxy?.trim()) return null;
  const parts = proxy.split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const l1 = parts[0];
  const l2 = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : l1;
  const l3 = parts.length >= 3 ? proxy.trim() : l2;
  return { l1, l2, l3 };
}

function industryKey(record: ClassifiedTicker, level: 1 | 2 | 3): string {
  if (record.stage === "prefilter_excluded") return PREFILTER_NO_INDUSTRY;
  const levels = parseIndustryLevels(record.industryProxy);
  if (!levels) return "(missing industry_proxy)";
  if (level === 1) return levels.l1;
  if (level === 2) return levels.l2;
  return levels.l3;
}

function readYamlIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return parseYaml(fs.readFileSync(filePath, "utf8")) as T;
}

function tickerFromFilename(name: string): string {
  return name.replace(/\.json$/, "");
}

export function loadFilterBreakdown(opts: {
  outputDir: string;
  cacheDir: string;
  quarter: string;
  market: Market;
}): FilterBreakdownDoc {
  const { outputDir, cacheDir, quarter, market } = opts;
  const marketDir = path.resolve(outputDir);

  const meta =
    readYamlIfExists<{ run_metadata?: { universe_count?: number; quarter?: string } }>(
      path.join(marketDir, "candidates.yaml")
    )?.run_metadata ??
    readYamlIfExists<{ run_metadata?: { universe_count?: number; quarter?: string } }>(
      path.join(marketDir, "funnel-diagnostics.yaml")
    )?.run_metadata;

  const prefilterDoc = readYamlIfExists<{
    prefilter_excluded?: Array<{ ticker: string; kill_reason?: string }>;
  }>(path.join(marketDir, "prefilter-excluded.yaml"));

  const excludedDoc = readYamlIfExists<{
    excluded?: Array<{ ticker: string; kill_reason?: string }>;
  }>(path.join(marketDir, "excluded.yaml"));

  const candidatesDoc = readYamlIfExists<{
    candidates?: Array<{
      ticker: string;
      industry_proxy?: string;
      routed_templates?: string[];
    }>;
  }>(path.join(marketDir, "candidates.yaml"));

  const deferredDoc = readYamlIfExists<{
    deferred?: Array<{
      ticker: string;
      industry_proxy?: string;
      routed_templates?: string[];
    }>;
  }>(path.join(marketDir, "deferred.yaml"));

  const cacheMarketDir = path.join(cacheDir, quarter, market);
  const cacheTickers = new Set<string>();
  const cacheIndustry = new Map<string, string | null>();

  if (fs.existsSync(cacheMarketDir)) {
    for (const file of fs.readdirSync(cacheMarketDir)) {
      if (!file.endsWith(".json")) continue;
      const ticker = tickerFromFilename(file);
      cacheTickers.add(ticker);
      const payload = JSON.parse(
        fs.readFileSync(path.join(cacheMarketDir, file), "utf8")
      ) as { industryProxy?: string };
      cacheIndustry.set(ticker, payload.industryProxy?.trim() ?? null);
    }
  }

  const candidateMap = new Map(
    (candidatesDoc?.candidates ?? []).map((row) => [
      row.ticker,
      {
        industryProxy: row.industry_proxy ?? null,
        routedTemplate: row.routed_templates?.[0],
      },
    ])
  );
  const deferredMap = new Map(
    (deferredDoc?.deferred ?? []).map((row) => [
      row.ticker,
      {
        industryProxy: row.industry_proxy ?? null,
        routedTemplate: row.routed_templates?.[0],
      },
    ])
  );
  const killMap = new Map(
    (excludedDoc?.excluded ?? []).map((row) => [
      row.ticker,
      row.kill_reason ?? "unknown_kill",
    ])
  );

  const tickers: ClassifiedTicker[] = [];

  for (const row of prefilterDoc?.prefilter_excluded ?? []) {
    tickers.push({
      ticker: row.ticker,
      stage: "prefilter_excluded",
      reason: row.kill_reason ?? "kill_prefilter_excluded",
      industryProxy: null,
    });
  }

  for (const ticker of cacheTickers) {
    const industryProxy =
      candidateMap.get(ticker)?.industryProxy ??
      deferredMap.get(ticker)?.industryProxy ??
      cacheIndustry.get(ticker) ??
      null;

    if (killMap.has(ticker)) {
      tickers.push({
        ticker,
        stage: "kill_excluded",
        reason: killMap.get(ticker)!,
        industryProxy,
      });
      continue;
    }

    if (candidateMap.has(ticker)) {
      const meta = candidateMap.get(ticker)!;
      tickers.push({
        ticker,
        stage: "candidate",
        reason: "passed_funnel",
        industryProxy: meta.industryProxy ?? industryProxy,
        routedTemplate: meta.routedTemplate,
      });
      continue;
    }

    if (deferredMap.has(ticker)) {
      const meta = deferredMap.get(ticker)!;
      tickers.push({
        ticker,
        stage: "deferred",
        reason: "deferred_soft_cap",
        industryProxy: meta.industryProxy ?? industryProxy,
        routedTemplate: meta.routedTemplate,
      });
      continue;
    }

    tickers.push({
      ticker,
      stage: "sector_filtered",
      reason: "sector_template_filtered",
      industryProxy,
    });
  }

  return {
    market,
    quarter: meta?.quarter ?? quarter,
    universeCount: meta?.universe_count ?? tickers.length,
    tickers,
  };
}

export function aggregateByIndustry(
  tickers: ClassifiedTicker[],
  level: 1 | 2 | 3
): IndustryBucket[] {
  const buckets = new Map<string, IndustryBucket>();

  for (const record of tickers) {
    const key = industryKey(record, level);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        level,
        total: 0,
        byStage: {
          prefilter_excluded: 0,
          kill_excluded: 0,
          sector_filtered: 0,
          deferred: 0,
          candidate: 0,
        },
        byReason: {},
        candidateRate: 0,
        killRate: 0,
        sectorFilterRate: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.total += 1;
    bucket.byStage[record.stage] += 1;
    bucket.byReason[record.reason] = (bucket.byReason[record.reason] ?? 0) + 1;
  }

  for (const bucket of buckets.values()) {
    bucket.candidateRate = bucket.total > 0 ? bucket.byStage.candidate / bucket.total : 0;
    bucket.killRate = bucket.total > 0 ? bucket.byStage.kill_excluded / bucket.total : 0;
    bucket.sectorFilterRate =
      bucket.total > 0 ? bucket.byStage.sector_filtered / bucket.total : 0;
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

function topReason(byReason: Record<string, number>): string {
  const [reason, count] = sortedEntries(byReason)[0] ?? ["—", 0];
  return `${reason} (${count})`;
}

function printIndustryTable(
  lines: string[],
  title: string,
  buckets: IndustryBucket[],
  baseUniverse: number,
  limit?: number
): void {
  const rows = limit ? buckets.slice(0, limit) : buckets;
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(
    "| Industry | Total | Cand | Def | Kill | Sector filt | Prefilt | Cand% | Kill% | Sector% | Top reason |"
  );
  lines.push(
    "|----------|-------|------|-----|------|-------------|---------|-------|-------|---------|------------|"
  );
  for (const b of rows) {
    lines.push(
      `| ${b.key} | ${b.total} | ${b.byStage.candidate} | ${b.byStage.deferred} | ` +
        `${b.byStage.kill_excluded} | ${b.byStage.sector_filtered} | ${b.byStage.prefilter_excluded} | ` +
        `${pct(b.byStage.candidate, b.total)} | ${pct(b.byStage.kill_excluded, b.total)} | ` +
        `${pct(b.byStage.sector_filtered, b.total)} | ${topReason(b.byReason)} |`
    );
  }
  if (limit && buckets.length > limit) {
    lines.push("");
    lines.push(`_Showing top ${limit} of ${buckets.length} groups._`);
  }
  lines.push("");
}

function printReasonRanking(
  lines: string[],
  title: string,
  tickers: ClassifiedTicker[],
  base: number
): void {
  const counts: Record<string, number> = {};
  for (const t of tickers) {
    const label = `${t.stage}:${t.reason}`;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  lines.push(`## ${title}`);
  lines.push("");
  lines.push("| Exit | Count | Share |");
  lines.push("|------|-------|-------|");
  for (const [label, count] of sortedEntries(counts)) {
    lines.push(`| ${label} | ${count} | ${pct(count, base)} |`);
  }
  lines.push("");
}

export function formatFilterBreakdownReport(
  doc: FilterBreakdownDoc,
  opts: {
    topL2?: number;
    topL3?: number;
    softCap?: number;
    templateTrack?: TemplateTrackBreakdownDoc;
    trackTop?: number;
  } = {}
): string {
  const topL2 = opts.topL2 ?? 25;
  const topL3 = opts.topL3 ?? 25;
  const softCap = opts.softCap ?? 20;
  const lines: string[] = [];
  const { tickers, universeCount, market, quarter } = doc;

  const stageTotals: Record<ExitStage, number> = {
    prefilter_excluded: 0,
    kill_excluded: 0,
    sector_filtered: 0,
    deferred: 0,
    candidate: 0,
  };
  for (const t of tickers) stageTotals[t.stage] += 1;

  lines.push(`# Filter breakdown — ${market} (${quarter})`);
  lines.push("");
  lines.push(`Universe (quote list): **${universeCount}** · Classified rows: **${tickers.length}**`);
  if (tickers.length < universeCount) {
    lines.push(
      `WARN: **${universeCount - tickers.length}** tickers missing from enrichment cache — ` +
        "industry breakdown covers cache + prefilter only."
    );
  }
  lines.push("");
  lines.push("## Funnel exit summary");
  lines.push("");
  lines.push("| Stage | Count | Share of universe |");
  lines.push("|-------|-------|-------------------|");
  for (const [stage, count] of sortedEntries(stageTotals)) {
    lines.push(`| ${stage} | ${count} | ${pct(count, universeCount)} |`);
  }
  lines.push("");

  printReasonRanking(lines, "Global exit reason ranking", tickers, universeCount);

  const enriched = tickers.filter((t) => t.stage !== "prefilter_excluded");
  printReasonRanking(
    lines,
    "Enriched universe exit reasons (excludes prefilter)",
    enriched,
    enriched.length
  );

  const l1 = aggregateByIndustry(tickers, 1);
  const l2 = aggregateByIndustry(tickers, 2);
  const l3 = aggregateByIndustry(tickers, 3);

  printIndustryTable(lines, "By industry L1 (申万一级)", l1, universeCount);
  printIndustryTable(lines, `By industry L2 (申万二级, top ${topL2})`, l2, universeCount, topL2);
  printIndustryTable(lines, `By industry L3 (申万三级, top ${topL3})`, l3, universeCount, topL3);

  const topL1 = l1.filter((b) => b.key !== PREFILTER_NO_INDUSTRY).slice(0, 8);
  for (const bucket of topL1) {
    const group = tickers.filter((t) => industryKey(t, 1) === bucket.key);
    const reasonCounts: Record<string, number> = {};
    for (const t of group) {
      reasonCounts[t.reason] = (reasonCounts[t.reason] ?? 0) + 1;
    }
    lines.push(`## L1 detail: ${bucket.key} (${bucket.total} tickers)`);
    lines.push("");
    lines.push("| Reason | Count | Share of L1 |");
    lines.push("|--------|-------|-------------|");
    for (const [reason, count] of sortedEntries(reasonCounts)) {
      lines.push(`| ${reason} | ${count} | ${pct(count, bucket.total)} |`);
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- `prefilter_excluded` tickers have no enrichment cache; grouped under `(预筛剔除 / 无 enrichment)`."
  );
  lines.push(
    "- `sector_template_filtered` means passed kill gates but failed all sector template tracks."
  );
  lines.push(
    "- For required/supporting metric failures, re-run with `--template-tracks` on this command."
  );
  lines.push("- `deferred_soft_cap` means passed funnel but ranked below the per-market soft cap (" + `${softCap}).`);

  if (opts.templateTrack) {
    lines.push("");
    lines.push(
      formatTemplateTrackBreakdownSection(opts.templateTrack, {
        top: opts.trackTop,
        focusTemplate: opts.templateTrack.filters.templates?.[0],
        focusTrack: opts.templateTrack.filters.tracks?.[0],
      })
    );
  }

  lines.push("");

  return lines.join("\n");
}

export type FunnelTrack = "quality" | "mispricing";

export interface TemplateTrackBreakdownFilters {
  stages?: ExitStage[];
  templates?: string[];
  tracks?: FunnelTrack[];
  industryL1?: string;
  industryL2?: string;
  industryL3?: string;
}

export interface TickerTrackBreakdown {
  ticker: string;
  stage: ExitStage;
  industryProxy: string | null;
  routedTemplates: string[];
  passedTemplate?: string;
  passedTrack?: FunnelTrack;
  primaryFailure?: string;
  tracks: TemplateTrackDiagnostic[];
}

export interface TemplateTrackBreakdownDoc {
  market: Market;
  quarter: string;
  analyzedCount: number;
  filters: TemplateTrackBreakdownFilters;
  tickers: TickerTrackBreakdown[];
}

function trackKey(template: string, track: FunnelTrack): string {
  return `${template}.${track}`;
}

function matchesIndustryFilter(
  industryProxy: string | null | undefined,
  filters: TemplateTrackBreakdownFilters
): boolean {
  const levels = parseIndustryLevels(industryProxy);
  if (!levels) return !filters.industryL1 && !filters.industryL2 && !filters.industryL3;
  if (filters.industryL1 && levels.l1 !== filters.industryL1) return false;
  if (filters.industryL2 && levels.l2 !== filters.industryL2) return false;
  if (filters.industryL3 && levels.l3 !== filters.industryL3) return false;
  return true;
}

function listTrackDiagnostics(
  bundle: SpecBundle,
  record: SecurityRecord,
  routedTemplateIds: string[],
  trackFilter?: FunnelTrack[]
): TemplateTrackDiagnostic[] {
  const route = routeSecurityRecord(bundle, record);
  const templateIds = new Set(routedTemplateIds);
  const tracks: TemplateTrackDiagnostic[] = [];

  for (const tplRef of route.templates) {
    if (!templateIds.has(tplRef.id)) continue;
    const tpl = bundle.templates[tplRef.id];
    if (!tpl) continue;

    for (const track of tpl.tracks as FunnelTrack[]) {
      if (trackFilter?.length && !trackFilter.includes(track)) continue;
      tracks.push(
        evaluateTemplateTrackDiagnostic(
          tpl as Parameters<typeof evaluateTemplateTrackDiagnostic>[0],
          track,
          record,
          tplRef.subTemplate
        )
      );
    }
  }

  return tracks;
}

function primaryFailureLabel(diag: TemplateTrackDiagnostic): string | undefined {
  if (diag.passed) return undefined;
  if (diag.failureStage === "required") {
    const fail = diag.requiredOutcomes.find((o) => o.kind === "fail");
    return fail ? `required:${fail.metric}` : "required:unknown";
  }
  if (diag.failureStage === "supporting_min") {
    const failedSupporting = diag.supportingOutcomes.filter((o) => o.kind === "fail");
    if (failedSupporting.length > 0) {
      return `supporting:${failedSupporting[0]!.metric}`;
    }
    return `supporting:min_not_met (${diag.supportingPassCount}/${diag.supportingMin})`;
  }
  return diag.failureStage ? String(diag.failureStage) : undefined;
}

function pickPrimaryFailure(tracks: TemplateTrackDiagnostic[]): string | undefined {
  const failures = tracks.filter((t) => !t.passed);
  if (failures.length === 0) return undefined;

  const ranked = [...failures].sort((a, b) => {
    const stageRank = (d: TemplateTrackDiagnostic) =>
      d.failureStage === "required" ? 0 : d.failureStage === "supporting_min" ? 1 : 2;
    const sr = stageRank(a) - stageRank(b);
    if (sr !== 0) return sr;
    return b.supportingPassCount - a.supportingPassCount;
  });

  return primaryFailureLabel(ranked[0]!);
}

function diagnoseTickerTracks(
  bundle: SpecBundle,
  classified: ClassifiedTicker,
  record: SecurityRecord,
  filters: TemplateTrackBreakdownFilters
): TickerTrackBreakdown | null {
  const route = routeSecurityRecord(bundle, record);
  const routedTemplates = route.templates.map((t) => t.id);
  if (filters.templates?.length) {
    const hasTemplate = routedTemplates.some((id) => filters.templates!.includes(id));
    if (!hasTemplate) return null;
  }

  const tracks = listTrackDiagnostics(bundle, record, routedTemplates, filters.tracks);
  const passed = tracks.find((t) => t.passed);

  return {
    ticker: classified.ticker,
    stage: classified.stage,
    industryProxy: classified.industryProxy,
    routedTemplates,
    passedTemplate: passed?.template,
    passedTrack: passed?.track,
    primaryFailure: pickPrimaryFailure(tracks),
    tracks,
  };
}

export function loadTemplateTrackBreakdown(opts: {
  outputDir: string;
  cacheDir: string;
  quarter: string;
  market: Market;
  bundle: SpecBundle;
  filters?: TemplateTrackBreakdownFilters;
}): TemplateTrackBreakdownDoc {
  const filters = opts.filters ?? {};
  const defaultStages: ExitStage[] = ["sector_filtered", "deferred", "candidate"];
  const stages = filters.stages?.length ? filters.stages : defaultStages;

  const funnelDoc = loadFilterBreakdown({
    outputDir: opts.outputDir,
    cacheDir: opts.cacheDir,
    quarter: opts.quarter,
    market: opts.market,
  });

  const recordByTicker = new Map(
    applyIndustryBenchmarks(
      loadEnrichedUniverseFromCache({
        cacheDir: opts.cacheDir,
        quarter: opts.quarter,
        market: opts.market,
      })
    ).map((r) => [r.ticker, r])
  );

  const tickers: TickerTrackBreakdown[] = [];
  for (const classified of funnelDoc.tickers) {
    if (!stages.includes(classified.stage)) continue;
    if (!matchesIndustryFilter(classified.industryProxy, filters)) continue;

    const record = recordByTicker.get(classified.ticker);
    if (!record) continue;

    const diag = diagnoseTickerTracks(opts.bundle, classified, record, filters);
    if (diag) tickers.push(diag);
  }

  return {
    market: opts.market,
    quarter: funnelDoc.quarter,
    analyzedCount: tickers.length,
    filters,
    tickers,
  };
}

function aggregateTrackFailureReasons(
  doc: TemplateTrackBreakdownDoc,
  opts: { template?: string; track?: FunnelTrack; top?: number }
): Array<[string, number]> {
  const counts: Record<string, number> = {};

  for (const row of doc.tickers) {
    for (const diag of row.tracks) {
      if (opts.template && diag.template !== opts.template) continue;
      if (opts.track && diag.track !== opts.track) continue;
      if (diag.passed) continue;

      if (diag.failureStage === "required") {
        for (const outcome of diag.requiredOutcomes) {
          if (outcome.kind !== "fail") continue;
          const key = `${trackKey(diag.template, diag.track)} · required · ${outcome.metric}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
        continue;
      }

      if (diag.failureStage === "supporting_min") {
        const failed = diag.supportingOutcomes.filter((o) => o.kind === "fail");
        if (failed.length === 0) {
          counts[`${trackKey(diag.template, diag.track)} · supporting · min_not_met`] =
            (counts[`${trackKey(diag.template, diag.track)} · supporting · min_not_met`] ?? 0) + 1;
          continue;
        }
        for (const outcome of failed) {
          const key = `${trackKey(diag.template, diag.track)} · supporting · ${outcome.metric}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }
  }

  return sortedEntries(counts).slice(0, opts.top ?? 25);
}

function aggregateByTemplateTrack(doc: TemplateTrackBreakdownDoc) {
  const buckets = new Map<string, { template: string; track: FunnelTrack; passed: number; failed: number }>();

  for (const row of doc.tickers) {
    for (const diag of row.tracks) {
      const key = trackKey(diag.template, diag.track);
      const bucket = buckets.get(key) ?? {
        template: diag.template,
        track: diag.track,
        passed: 0,
        failed: 0,
      };
      if (diag.passed) bucket.passed += 1;
      else bucket.failed += 1;
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()]
    .map((b) => ({
      ...b,
      evaluated: b.passed + b.failed,
    }))
    .sort((a, b) => b.evaluated - a.evaluated);
}

function aggregatePrimaryTrackFailures(doc: TemplateTrackBreakdownDoc, top = 25): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const row of doc.tickers) {
    if (!row.primaryFailure || row.stage === "candidate") continue;
    counts[row.primaryFailure] = (counts[row.primaryFailure] ?? 0) + 1;
  }
  return sortedEntries(counts).slice(0, top);
}

function aggregateTrackByIndustry(
  doc: TemplateTrackBreakdownDoc,
  level: 1 | 2 | 3,
  template?: string,
  track?: FunnelTrack,
  top = 15
) {
  const buckets = new Map<string, { total: number; passed: number; failed: number; failures: Record<string, number> }>();

  for (const row of doc.tickers) {
    const levels = parseIndustryLevels(row.industryProxy);
    const key =
      levels == null
        ? "(missing industry_proxy)"
        : level === 1
          ? levels.l1
          : level === 2
            ? levels.l2
            : levels.l3;

    const relevant = row.tracks.filter((t) => {
      if (template && t.template !== template) return false;
      if (track && t.track !== track) return false;
      return true;
    });
    if (relevant.length === 0) continue;

    const bucket = buckets.get(key) ?? { total: 0, passed: 0, failed: 0, failures: {} };
    bucket.total += 1;
    if (relevant.some((t) => t.passed)) bucket.passed += 1;
    else {
      bucket.failed += 1;
      if (row.primaryFailure) {
        bucket.failures[row.primaryFailure] = (bucket.failures[row.primaryFailure] ?? 0) + 1;
      }
    }
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      total: b.total,
      passed: b.passed,
      failed: b.failed,
      topFailure: sortedEntries(b.failures)[0]?.[0] ?? "—",
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top);
}

export function formatTemplateTrackBreakdownSection(
  doc: TemplateTrackBreakdownDoc,
  opts: { top?: number; focusTemplate?: string; focusTrack?: FunnelTrack } = {}
): string {
  const top = opts.top ?? 25;
  const lines: string[] = [];
  const stageCounts: Record<ExitStage, number> = {
    prefilter_excluded: 0,
    kill_excluded: 0,
    sector_filtered: 0,
    deferred: 0,
    candidate: 0,
  };
  for (const row of doc.tickers) stageCounts[row.stage] += 1;

  lines.push("## Template track breakdown");
  lines.push("");
  lines.push(`Analyzed tickers: **${doc.analyzedCount}** (replayed from enrichment cache + spec)`);
  const filterParts: string[] = [];
  if (doc.filters.stages?.length) filterParts.push(`stages: ${doc.filters.stages.join(", ")}`);
  if (doc.filters.templates?.length) filterParts.push(`templates: ${doc.filters.templates.join(", ")}`);
  if (doc.filters.tracks?.length) filterParts.push(`tracks: ${doc.filters.tracks.join(", ")}`);
  if (doc.filters.industryL1) filterParts.push(`industry L1: ${doc.filters.industryL1}`);
  if (doc.filters.industryL2) filterParts.push(`industry L2: ${doc.filters.industryL2}`);
  if (doc.filters.industryL3) filterParts.push(`industry L3: ${doc.filters.industryL3}`);
  if (filterParts.length > 0) lines.push(`Filters: ${filterParts.join(" · ")}`);
  lines.push("");

  lines.push("### Analyzed population by funnel stage");
  lines.push("");
  lines.push("| Stage | Count |");
  lines.push("|-------|-------|");
  for (const [stage, count] of sortedEntries(stageCounts as unknown as Record<string, number>)) {
    if (count > 0) lines.push(`| ${stage} | ${count} |`);
  }
  lines.push("");

  lines.push("### Template × track pass rates");
  lines.push("");
  lines.push("| Template | Track | Evaluated | Passed | Failed | Pass rate |");
  lines.push("|----------|-------|-----------|--------|--------|-----------|");
  for (const row of aggregateByTemplateTrack(doc)) {
    lines.push(
      `| ${row.template} | ${row.track} | ${row.evaluated} | ${row.passed} | ${row.failed} | ${pct(row.passed, row.evaluated)} |`
    );
  }
  lines.push("");

  lines.push(`### Primary failure reasons (top ${top})`);
  lines.push("");
  lines.push("| Reason | Count | Share |");
  lines.push("|--------|-------|-------|");
  const primary = aggregatePrimaryTrackFailures(doc, top);
  const primaryTotal = primary.reduce((sum, [, c]) => sum + c, 0);
  for (const [reason, count] of primary) {
    lines.push(`| ${reason} | ${count} | ${pct(count, primaryTotal || doc.analyzedCount)} |`);
  }
  lines.push("");

  const focusTemplate = opts.focusTemplate ?? doc.filters.templates?.[0];
  const focusTrack = opts.focusTrack ?? doc.filters.tracks?.[0];

  lines.push(`### Rule-level failures (top ${top})`);
  lines.push("");
  lines.push("| Rule failure | Count |");
  lines.push("|--------------|-------|");
  for (const [reason, count] of aggregateTrackFailureReasons(doc, {
    template: focusTemplate,
    track: focusTrack,
    top,
  })) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push("");

  lines.push("### By industry L1");
  lines.push("");
  lines.push("| Industry | Tickers | Passed any track | Failed all | Top primary failure |");
  lines.push("|----------|---------|------------------|------------|---------------------|");
  for (const row of aggregateTrackByIndustry(doc, 1, focusTemplate, focusTrack, 15)) {
    lines.push(
      `| ${row.key} | ${row.total} | ${row.passed} | ${row.failed} | ${row.topFailure} |`
    );
  }
  lines.push("");

  return lines.join("\n");
}
