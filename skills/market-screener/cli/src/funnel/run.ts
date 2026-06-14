import path from "node:path";
import { deferredWatchlistCapFromBundle, funnelSoftCapFromBundle } from "../spec/conventions.js";
import type { SpecBundle, SectorTemplateSpec } from "../spec/types.js";
import { writeYamlArtifact } from "../io/artifacts.js";
import type { ProgressLogger } from "../lib/progress.js";
import {
  FunnelDiagnosticsCollector,
  routingDiagnosticsFromFunnel,
} from "./diagnostics.js";
import { applyKillGates, type KillGateResult, type SecurityRecord } from "./kill-gates.js";
import { rankCandidates } from "./ranker.js";
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
  passed_track: FunnelTrack;
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
  return routeSecurity(bundle.routingMap, bundle.cnIndustryMap, {
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

export function bestPassingCandidate(
  bundle: SpecBundle,
  record: SecurityRecord,
  kill: KillGateResult,
  route: RouteResult,
  trackResults?: TemplateTrackResult[]
): PassingCandidate | null {
  const entries = trackResults ?? listTemplateTrackResults(bundle, record, route);
  const routedTemplates = route.templates.map((t) => t.id);
  let best: PassingCandidate | null = null;

  for (const entry of entries) {
    if (!entry.result.passed || !entry.result.passedTrack) continue;

    const score = entry.result.supportingPassCount;
    if (best && score <= best.compositeScore) continue;

    best = {
      ticker: record.ticker,
      market: record.market,
      company_name: record.companyName,
      currency: record.currency,
      industry_proxy: record.industryProxy,
      routed_templates: routedTemplates,
      routing_confidence: route.routingConfidence,
      routing_method: route.routingMethod,
      matched_rule: route.matchedRule,
      passed_track: entry.result.passedTrack,
      sub_template: entry.subTemplate,
      metric_snapshot: entry.result.metricSnapshot,
      data_confidence: kill.dataConfidence,
      funnel_flags: [...kill.funnelFlags, ...entry.result.funnelFlags],
      audit_mode: "deep",
      audit_hints: [...route.auditHints, ...entry.result.auditHints],
      compositeScore: score,
      supportingPassCount: score,
    };
  }

  return best;
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

    const pairs = passed.map((p) => {
      const { compositeScore, supportingPassCount, ...output } = p;
      return {
        rankable: {
          ticker: p.ticker,
          compositeScore,
          dataConfidence: p.data_confidence,
          supportingPassCount,
        },
        output,
      };
    });

    const ranked = rankCandidates(pairs.map((p) => p.rankable));
    const outputByTicker = new Map(pairs.map((p) => [p.rankable.ticker, p.output]));
    const rankedRecords = ranked.map((r, idx) => ({
      ...outputByTicker.get(r.ticker)!,
      rank: idx + 1,
    }));

    const primary = rankedRecords.slice(0, softCap);
    const overflow = rankedRecords.slice(softCap);
    const deferred = overflow.slice(0, deferredCap);
    const sectorPassOverflow = overflow.length - deferred.length;
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
          "check industry enrichment and cn-industry-map coverage"
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
