import path from "node:path";
import {
  deferredWatchlistCapFromBundle,
  funnelSoftCapFromBundle,
  northStarForPool,
  seatAllocationFromBundle,
  templateLiveViability,
} from "../spec/conventions.js";
import type { SpecBundle, SectorTemplateSpec } from "../spec/types.js";
import { writeYamlArtifact } from "../io/artifacts.js";
import type { ProgressLogger } from "../lib/progress.js";
import {
  FunnelDiagnosticsCollector,
  routingDiagnosticsFromFunnel,
} from "./diagnostics.js";
import { applyKillGates, type KillGateResult } from "./kill-gates.js";
import type { SecurityRecord } from "../domain/types.js";
import { allocateTemplateSeats } from "./ranker.js";
import { routeSecurity, type RouteResult } from "./router.js";
import { evaluateTemplateTrack, type TemplateEvalResult } from "./template-evaluator.js";
import { getUniverseProfileFailureReason } from "./universe.js";
import type { Market } from "./types.js";
import type { EnrichRunStats } from "../data/types.js";

export type FunnelTrack = "quality" | "mispricing";

export interface TemplateTrackResult {
  template: string;
  subTemplate?: string;
  track: FunnelTrack;
  result: TemplateEvalResult;
}

export type SeatSource =
  | "floor"
  | "cap"
  | "flex"
  | "backfill_same_template"
  | "backfill_global"
  | "deferred";

export interface PassingCandidate {
  ticker: string;
  market: SecurityRecord["market"];
  company_name: string;
  currency: string;
  industry_proxy?: string;
  routed_templates: string[];
  routing_confidence: RouteResult["routingConfidence"];
  routing_method: RouteResult["routingMethod"];
  matched_rule?: string;
  winning_template: string;
  track_confluence: boolean;
  passed_track: FunnelTrack;
  pool_score: number;
  seat_source?: SeatSource;
  sub_template?: string;
  metric_snapshot: TemplateEvalResult["metricSnapshot"];
  data_confidence: KillGateResult["dataConfidence"];
  funnel_flags: string[];
  audit_mode: "deep";
  audit_hints: string[];
  compositeScore: number;
  supportingPassCount: number;
}

export function routeSecurityRecord(bundle: SpecBundle, record: SecurityRecord): RouteResult {
  return routeSecurity(bundle.routing.us, bundle.routing.cn, {
    market: record.market,
    gicsCode: record.gicsCode,
    industryProxy: record.industryProxy,
  });
}

export function listTemplateTrackResults(
  bundle: SpecBundle,
  record: SecurityRecord,
  route: RouteResult
): TemplateTrackResult[] {
  const results: TemplateTrackResult[] = [];

  for (const tplRef of route.templates) {
    if (templateLiveViability(bundle, tplRef.id, tplRef.subTemplate) === "quant_too_hard") {
      continue;
    }
    const tpl = bundle.templates[tplRef.id];
    if (!tpl) continue;

    for (const track of tpl.tracks as FunnelTrack[]) {
      results.push({
        template: tplRef.id,
        subTemplate: tplRef.subTemplate,
        track,
        result: evaluateTemplateTrack(
          tpl as SectorTemplateSpec & Record<string, unknown>,
          track,
          record,
          tplRef.subTemplate
        ),
      });
    }
  }

  return results;
}

interface TemplatePassTracks {
  quality?: TemplateTrackResult;
  mispricing?: TemplateTrackResult;
}

function buildPassingCandidate(
  record: SecurityRecord,
  kill: KillGateResult,
  route: RouteResult,
  entries: TemplateTrackResult[]
): PassingCandidate | null {
  const routedTemplates = route.templates.map((t) => t.id);
  const byTemplate = new Map<string, TemplatePassTracks>();

  for (const entry of entries) {
    if (!entry.result.passed || !entry.result.passedTrack) continue;
    const bucket = byTemplate.get(entry.template) ?? {};
    if (entry.track === "quality") bucket.quality = entry;
    else bucket.mispricing = entry;
    byTemplate.set(entry.template, bucket);
  }

  if (byTemplate.size === 0) return null;

  let winningTemplate = "";
  let winningTracks: TemplatePassTracks = {};
  let bestTemplateScore = -1;

  for (const [template, tracks] of byTemplate) {
    const scores: number[] = [];
    if (tracks.quality?.result.passed) {
      scores.push(tracks.quality.result.supportingPassCount);
    }
    if (tracks.mispricing?.result.passed) {
      scores.push(tracks.mispricing.result.supportingPassCount);
    }
    const templateScore = Math.max(...scores);
    if (templateScore > bestTemplateScore) {
      bestTemplateScore = templateScore;
      winningTemplate = template;
      winningTracks = tracks;
    } else if (templateScore === bestTemplateScore && template.localeCompare(winningTemplate) < 0) {
      winningTemplate = template;
      winningTracks = tracks;
    }
  }

  const qualityPassed = winningTracks.quality?.result.passed === true;
  const mispricingPassed = winningTracks.mispricing?.result.passed === true;
  const trackConfluence = qualityPassed && mispricingPassed;
  const passedTrack: FunnelTrack = trackConfluence
    ? "quality"
    : qualityPassed
      ? "quality"
      : "mispricing";

  const winningEntry =
    passedTrack === "quality" ? winningTracks.quality! : winningTracks.mispricing!;
  const poolScore = winningEntry.result.supportingPassCount;

  return {
    ticker: record.ticker,
    market: record.market,
    company_name: record.companyName,
    currency: record.currency,
    industry_proxy: record.industryProxy,
    routed_templates: routedTemplates,
    routing_confidence: route.routingConfidence,
    routing_method: route.routingMethod,
    matched_rule: route.matchedRule,
    winning_template: winningTemplate,
    track_confluence: trackConfluence,
    passed_track: passedTrack,
    pool_score: poolScore,
    sub_template: winningEntry.subTemplate,
    metric_snapshot: winningEntry.result.metricSnapshot,
    data_confidence: kill.dataConfidence,
    funnel_flags: [...kill.funnelFlags, ...winningEntry.result.funnelFlags],
    audit_mode: "deep",
    audit_hints: [...route.auditHints, ...winningEntry.result.auditHints],
    compositeScore: poolScore,
    supportingPassCount: poolScore,
  };
}

export function bestPassingCandidate(
  bundle: SpecBundle,
  record: SecurityRecord,
  kill: KillGateResult,
  route: RouteResult,
  trackResults?: TemplateTrackResult[]
): PassingCandidate | null {
  const entries = trackResults ?? listTemplateTrackResults(bundle, record, route);
  return buildPassingCandidate(record, kill, route, entries);
}

export interface FunnelRunOptions {
  bundle: SpecBundle;
  universe: SecurityRecord[];
  prefilterExcluded?: SecurityRecord[];
  quarter: string;
  marketScope: Market | "CN,US";
  outputDir: string;
  progress?: ProgressLogger;
  enrichStatsByMarket?: Partial<Record<Market, EnrichRunStats>>;
  cacheGapByMarket?: Partial<Record<Market, { count: number; samples: string[] }>>;
}

export interface FunnelRunResult {
  candidateCount: number;
  deferredCount: number;
  excludedCount: number;
}

export async function runFunnel(opts: FunnelRunOptions): Promise<FunnelRunResult> {
  const softCap = funnelSoftCapFromBundle(opts.bundle);
  const deferredCap = deferredWatchlistCapFromBundle(opts.bundle);
  const markets =
    opts.marketScope === "CN,US" ? (["CN", "US"] as Market[]) : [opts.marketScope as Market];

  let totalCandidates = 0;
  let totalDeferred = 0;
  let totalExcluded = 0;

  for (const market of markets) {
    opts.progress?.phase(`Funnel stage: ${market} (kill gates → sector templates → rank)…`);
    const marketUniverse = opts.universe.filter((u) => u.market === market);
    const marketPrefilterExcluded = (opts.prefilterExcluded ?? []).filter(
      (r) => r.market === market
    );
    const excluded: unknown[] = [];
    const passed: PassingCandidate[] = [];
    const diagnostics = new FunnelDiagnosticsCollector();
    diagnostics.recordPrefilterExcluded(opts.bundle, marketPrefilterExcluded);

    for (const record of marketUniverse) {
      const kill = applyKillGates(opts.bundle.killGates, record);
      if (kill.excluded) {
        diagnostics.recordKillExcluded(kill.killReason);
        excluded.push({
          ticker: record.ticker,
          market: record.market,
          kill_reason: kill.killReason,
          metric_snapshot: {},
          enrichment_failure: record.enrichmentFailure,
        });
        continue;
      }

      const best = diagnostics.recordKillSurvivor(opts.bundle, record, kill);
      if (best) passed.push(best);
    }

    const seatConfig = seatAllocationFromBundle(opts.bundle);
    const northStarLookup = {
      forPool: (poolKey: string) => northStarForPool(opts.bundle, poolKey),
    };
    const allocation = allocateTemplateSeats(
      passed,
      seatConfig,
      softCap,
      deferredCap,
      northStarLookup
    );

    const stripInternalFields = ({
      compositeScore: _compositeScore,
      supportingPassCount: _supportingPassCount,
      ...output
    }: PassingCandidate) => output;

    const primary = allocation.candidates.map(stripInternalFields);
    const deferred = allocation.deferred.map(stripInternalFields);
    const sectorPassOverflow = allocation.overflowCount;
    const universeCount = marketUniverse.length + marketPrefilterExcluded.length;
    const funnelDiagnostics = diagnostics.finalize({
      bundle: opts.bundle,
      quarter: opts.quarter,
      market,
      universeCount,
      enrichedInRun: marketUniverse.length,
      prefilterExcluded: marketPrefilterExcluded.length,
      candidateCount: primary.length,
      deferredCount: deferred.length,
      sectorPassOverflow,
      deferredWatchlistCap: deferredCap,
      byPoolSelected: allocation.byPoolSelected,
      enrichStats: opts.enrichStatsByMarket?.[market],
      cacheGap: opts.cacheGapByMarket?.[market],
    });

    const base = path.join(opts.outputDir, market);
    const writes: Promise<void>[] = [
      writeYamlArtifact(path.join(base, "candidates.yaml"), {
        run_metadata: funnelDiagnostics.run_metadata,
        candidates: primary,
      }),
      writeYamlArtifact(path.join(base, "deferred.yaml"), {
        run_metadata: funnelDiagnostics.run_metadata,
        deferred,
      }),
      writeYamlArtifact(path.join(base, "excluded.yaml"), {
        run_metadata: funnelDiagnostics.run_metadata,
        excluded,
      }),
      writeYamlArtifact(path.join(base, "funnel-diagnostics.yaml"), funnelDiagnostics),
      writeYamlArtifact(
        path.join(base, "routing-diagnostics.yaml"),
        routingDiagnosticsFromFunnel(funnelDiagnostics)
      ),
    ];
    if (diagnostics.prefilterExcludedRows.length > 0) {
      writes.push(
        writeYamlArtifact(path.join(base, "prefilter-excluded.yaml"), {
          run_metadata: funnelDiagnostics.run_metadata,
          prefilter_excluded: diagnostics.prefilterExcludedRows,
        })
      );
    }
    await Promise.all(writes);

    const fallbackRate = funnelDiagnostics.routing?.fallback_rate;
    if (fallbackRate !== undefined && fallbackRate >= 0.5) {
      opts.progress?.warn(
        `${market} routing fallback_rate=${(fallbackRate * 100).toFixed(1)}% — ` +
          "check industry enrichment and CN routing coverage"
      );
    }

    opts.progress?.phase(
      `${market} done: ${primary.length} candidates, ${deferred.length} deferred, ` +
        `${excluded.length} excluded`
    );

    totalCandidates += primary.length;
    totalDeferred += deferred.length;
    totalExcluded += excluded.length;
  }

  return {
    candidateCount: totalCandidates,
    deferredCount: totalDeferred,
    excludedCount: totalExcluded,
  };
}
