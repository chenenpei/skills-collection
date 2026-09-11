/**
 * 美股模板报告：记录运行过程，汇总路由、缺失指标、排除原因与候选分布。
 * 可从保留的模板归档和缓存重建分析，兼容历史 CN 模板；不改变筛选资格。
 */
import type { EnrichRunStats } from "./screening.js";
import {
  type SpecBundle,
  funnelSoftCapFromBundle,
  templateLiveViability,
  manifestReviewThresholdsFromBundle,
  type SectorTemplateSpec,
  loadSpecBundle,
} from "../policy/loader.js";
import {
  pct,
  sortedEntries,
  parseMarkets,
  DEFAULT_CACHE_DIR,
  DEFAULT_POLICY_DIR,
} from "../shared/runtime.js";
import {
  bestPassingCandidate,
  type ExclusionResult,
  listTemplateTrackResults,
  type PassingCandidate,
  resolveTemplateForEvaluation,
  type RouteResult,
  routeSecurityRecord,
  getUniverseProfileFailureReason,
  evaluateTemplateTrackDiagnostic,
  type FunnelTrack,
  type TemplateTrackDiagnostic,
} from "./template-rules.js";
import { type SecurityRecord, type Market } from "../shared/financial-model.js";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { applyIndustryBenchmarks, loadEnrichedUniverseFromCache } from "./sources/fundamentals.js";

// 运行诊断：逐阶段记录数量、路由与缺失指标。

function buildRunMetadata(opts: {
  bundle: SpecBundle;
  quarter: string;
  marketScope: Market | "CN,US";
  universeCount: number;
  candidateCount: number;
  deferredCount: number;
}) {
  return {
    run_id: opts.quarter,
    executed_at: new Date().toISOString(),
    quarter: opts.quarter,
    market_scope: opts.marketScope,
    universe_count: opts.universeCount,
    candidate_count: opts.candidateCount,
    deferred_count: opts.deferredCount,
    funnel_soft_cap: funnelSoftCapFromBundle(opts.bundle),
    spec_version: opts.bundle.index.version,
    tightening_profile: opts.bundle.index.tightening_profile,
    data_source_profile: "quote-prefilter-and-financial-enrichment",
  };
}

export interface FunnelDiagnosticsDoc {
  run_metadata: ReturnType<typeof buildRunMetadata>;
  stages: {
    quote_universe: number;
    prefilter_excluded: number;
    enriched_in_run: number;
    kill_excluded: number;
    kill_survivors: number;
    sector_passed: number;
    sector_filtered: number;
    candidates: number;
    deferred: number;
    sector_pass_overflow: number;
  };
  deferred_watchlist_cap: number;
  prefilter_by_reason: Record<string, number>;
  kill_by_reason: Record<string, number>;
  sector_exit_by_reason: Record<string, number>;
  routing: {
    by_method: Record<string, number>;
    by_template: Record<string, number>;
    fallback_count: number;
    fallback_rate: number;
  };
  sector_by_template: Record<
    string,
    { routed: number; passed_any_track: number; pass_rate: number }
  >;
  by_pool_selected: Record<string, number>;
  unmapped_samples: Array<{ ticker: string; industry_proxy?: string }>;
  metric_coverage?: Record<
    string,
    {
      routed: number;
      required: Record<string, { present: number; rate: number }>;
    }
  >;
  manifest_review?: ManifestReviewItem[];
  enrichment?: {
    enrich_failed_count: number;
    enrich_failed_samples: string[];
    empty_annual_count: number;
    empty_annual_samples: string[];
    cache_missing_count: number;
    cache_missing_samples: string[];
  };
}

export interface ManifestReviewItem {
  template_key: string;
  declared_viability: string;
  suggestion: "consider_promote_to_full" | "consider_demote_or_fix_enrich";
  detail: string;
  metrics?: Record<string, number>;
}

export class FunnelDiagnosticsCollector {
  readonly prefilterByReason: Record<string, number> = {};
  readonly prefilterExcludedRows: Array<{
    ticker: string;
    market: SecurityRecord["market"];
    kill_reason: string;
  }> = [];
  readonly killByReason: Record<string, number> = {};
  readonly byMethod: Record<string, number> = {};
  readonly byTemplate: Record<string, number> = {};
  readonly sectorByTemplate: Record<string, { routed: number; passed: number }> = {};
  readonly unmappedSamples: Array<{ ticker: string; industry_proxy?: string }> = [];
  readonly sectorExitByReason: Record<string, number> = {};
  private metricCoverage: Record<
    string,
    { routed: number; required: Record<string, { present: number }> }
  > = {};

  killExcluded = 0;
  sectorPassed = 0;
  fallbackCount = 0;

  recordSectorExit(reason: string): void {
    this.sectorExitByReason[reason] = (this.sectorExitByReason[reason] ?? 0) + 1;
  }

  private coverageKey(template: string, subTemplate?: string): string {
    return subTemplate ? `${template}.${subTemplate}` : template;
  }

  private recordMetricCoverage(
    bundle: SpecBundle,
    route: RouteResult,
    record: SecurityRecord,
  ): void {
    for (const tplRef of route.templates) {
      const key = this.coverageKey(tplRef.id, tplRef.subTemplate);
      const bucket = this.metricCoverage[key] ?? { routed: 0, required: {} };
      bucket.routed += 1;

      const tpl = bundle.templates[tplRef.id];
      if (tpl) {
        const evalTpl = resolveTemplateForEvaluation(
          tpl as SectorTemplateSpec & Record<string, unknown>,
          tplRef.subTemplate,
        );
        const metricsNeeded = new Set<string>();
        for (const track of ["quality", "mispricing"] as const) {
          const required = (
            evalTpl[`${track}_track`] as { required?: Record<string, unknown> } | undefined
          )?.required;
          if (!required) continue;
          for (const metric of Object.keys(required)) metricsNeeded.add(metric);
        }
        for (const metric of metricsNeeded) {
          const stat = bucket.required[metric] ?? { present: 0 };
          if (record.metrics[metric]?.value !== undefined) stat.present += 1;
          bucket.required[metric] = stat;
        }
      }
      this.metricCoverage[key] = bucket;
    }
  }

  recordPrefilterExcluded(bundle: SpecBundle, records: SecurityRecord[]): void {
    for (const record of records) {
      const killReason =
        getUniverseProfileFailureReason(bundle.exclusionRules, record) ?? "kill_prefilter_excluded";
      countReason(this.prefilterByReason, killReason);
      this.prefilterExcludedRows.push({
        ticker: record.ticker,
        market: record.market,
        kill_reason: killReason,
      });
    }
  }

  recordKillExcluded(killReason: string | undefined): void {
    this.killExcluded += 1;
    countReason(this.killByReason, killReason);
  }

  recordKillSurvivor(
    bundle: SpecBundle,
    record: SecurityRecord,
    kill: ExclusionResult,
  ): PassingCandidate | null {
    const route = routeSecurityRecord(bundle, record);
    this.byMethod[route.routingMethod] = (this.byMethod[route.routingMethod] ?? 0) + 1;

    if (route.routingMethod === "fallback") {
      this.fallbackCount += 1;
      this.recordSectorExit("routing_too_hard");
      if (this.unmappedSamples.length < 50) {
        this.unmappedSamples.push({ ticker: record.ticker, industry_proxy: record.industryProxy });
      }
      return null;
    }

    this.recordMetricCoverage(bundle, route, record);

    const allQuantTooHard =
      route.templates.length > 0 &&
      route.templates.every(
        (t) => templateLiveViability(bundle, t.id, t.subTemplate) === "quant_too_hard",
      );

    for (const template of route.templates) {
      this.byTemplate[template.id] = (this.byTemplate[template.id] ?? 0) + 1;
      if (!this.sectorByTemplate[template.id]) {
        this.sectorByTemplate[template.id] = { routed: 0, passed: 0 };
      }
      this.sectorByTemplate[template.id].routed += 1;
    }

    if (allQuantTooHard) {
      this.recordSectorExit("sector_quant_too_hard");
      return null;
    }

    const trackResults = listTemplateTrackResults(bundle, record, route);
    const passedTemplates = new Set<string>();
    for (const entry of trackResults) {
      if (!entry.result.passed) continue;
      passedTemplates.add(entry.template);
    }
    for (const template of passedTemplates) {
      const bucket = this.sectorByTemplate[template];
      if (bucket) bucket.passed += 1;
    }

    const best = bestPassingCandidate(bundle, record, kill, route, trackResults);
    if (best) this.sectorPassed += 1;
    return best;
  }

  finalize(opts: {
    bundle: SpecBundle;
    quarter: string;
    market: Market;
    universeCount: number;
    enrichedInRun: number;
    prefilterExcluded: number;
    candidateCount: number;
    deferredCount: number;
    sectorPassOverflow: number;
    deferredWatchlistCap: number;
    byPoolSelected?: Record<string, number>;
    enrichStats?: EnrichRunStats;
    cacheGap?: { count: number; samples: string[] };
  }): FunnelDiagnosticsDoc {
    const killSurvivors = opts.enrichedInRun - this.killExcluded;
    const sectorByTemplateOut: FunnelDiagnosticsDoc["sector_by_template"] = {};
    for (const [template, stats] of Object.entries(this.sectorByTemplate)) {
      sectorByTemplateOut[template] = {
        routed: stats.routed,
        passed_any_track: stats.passed,
        pass_rate: stats.routed > 0 ? stats.passed / stats.routed : 0,
      };
    }

    const run_metadata = {
      ...buildRunMetadata({
        bundle: opts.bundle,
        quarter: opts.quarter,
        marketScope: opts.market,
        universeCount: opts.universeCount,
        candidateCount: opts.candidateCount,
        deferredCount: opts.deferredCount,
      }),
      deferred_watchlist_cap: opts.deferredWatchlistCap,
    };

    const doc: FunnelDiagnosticsDoc = {
      run_metadata,
      deferred_watchlist_cap: opts.deferredWatchlistCap,
      stages: {
        quote_universe: opts.universeCount,
        prefilter_excluded: opts.prefilterExcluded,
        enriched_in_run: opts.enrichedInRun,
        kill_excluded: this.killExcluded,
        kill_survivors: killSurvivors,
        sector_passed: this.sectorPassed,
        sector_filtered: killSurvivors - this.sectorPassed,
        candidates: opts.candidateCount,
        deferred: opts.deferredCount,
        sector_pass_overflow: opts.sectorPassOverflow,
      },
      prefilter_by_reason: this.prefilterByReason,
      kill_by_reason: this.killByReason,
      sector_exit_by_reason: this.sectorExitByReason,
      routing: {
        by_method: this.byMethod,
        by_template: this.byTemplate,
        fallback_count: this.fallbackCount,
        fallback_rate: killSurvivors > 0 ? this.fallbackCount / killSurvivors : 0,
      },
      sector_by_template: sectorByTemplateOut,
      by_pool_selected: opts.byPoolSelected ?? {},
      unmapped_samples: this.unmappedSamples,
    };

    if (opts.enrichStats || opts.cacheGap) {
      doc.enrichment = {
        enrich_failed_count: opts.enrichStats?.enrichFailedCount ?? 0,
        enrich_failed_samples: opts.enrichStats?.enrichFailedSamples ?? [],
        empty_annual_count: opts.enrichStats?.emptyAnnualCount ?? 0,
        empty_annual_samples: opts.enrichStats?.emptyAnnualSamples ?? [],
        cache_missing_count: opts.cacheGap?.count ?? 0,
        cache_missing_samples: opts.cacheGap?.samples ?? [],
      };
    }

    const metricCoverage = buildMetricCoverageOutput(this.metricCoverage);
    if (Object.keys(metricCoverage).length > 0) {
      doc.metric_coverage = metricCoverage;
      doc.manifest_review = buildManifestReview(
        opts.bundle,
        metricCoverage,
        manifestReviewThresholdsFromBundle(opts.bundle),
      );
    }

    return doc;
  }
}

// 复盘报告只汇总已记录事实，不重新执行模板或改写历史判定。
function countReason(
  bucket: Record<string, number>,
  reason: string | undefined,
  fallback = "unknown",
): void {
  const key = reason ?? fallback;
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function buildMetricCoverageOutput(
  raw: Record<string, { routed: number; required: Record<string, { present: number }> }>,
): NonNullable<FunnelDiagnosticsDoc["metric_coverage"]> {
  return Object.fromEntries(
    Object.entries(raw).map(([key, bucket]) => [
      key,
      {
        routed: bucket.routed,
        required: Object.fromEntries(
          Object.entries(bucket.required).map(([metric, stat]) => [
            metric,
            {
              present: stat.present,
              rate: bucket.routed > 0 ? stat.present / bucket.routed : 0,
            },
          ]),
        ),
      },
    ]),
  );
}

export function buildManifestReview(
  bundle: SpecBundle,
  coverage: FunnelDiagnosticsDoc["metric_coverage"],
  thresholds: { promote_min_rate: number; demote_warn_rate: number; min_routed: number },
): ManifestReviewItem[] {
  const items: ManifestReviewItem[] = [];
  for (const [key, bucket] of Object.entries(coverage ?? {})) {
    if (bucket.routed < thresholds.min_routed) continue;
    const dot = key.indexOf(".");
    const template = dot >= 0 ? key.slice(0, dot) : key;
    const sub = dot >= 0 ? key.slice(dot + 1) : undefined;
    const declared = templateLiveViability(bundle, template, sub);
    const rates = Object.values(bucket.required ?? {}).map((m) => m.rate);
    const minRate = rates.length ? Math.min(...rates) : 0;

    if (declared === "quant_too_hard" && minRate >= thresholds.promote_min_rate) {
      items.push({
        template_key: key,
        declared_viability: declared,
        suggestion: "consider_promote_to_full",
        detail: `All required metrics >= ${thresholds.promote_min_rate}; review ADR/spec to promote manifest and routing.`,
        metrics: Object.fromEntries(Object.entries(bucket.required).map(([m, s]) => [m, s.rate])),
      });
    } else if (
      (declared === "full" || declared === "proxy") &&
      minRate < thresholds.demote_warn_rate
    ) {
      items.push({
        template_key: key,
        declared_viability: declared,
        suggestion: "consider_demote_or_fix_enrich",
        detail: `Required metric rate below ${thresholds.demote_warn_rate}; fix enrich or consider quant_too_hard / proxy in manifest.`,
        metrics: Object.fromEntries(
          Object.entries(bucket.required)
            .filter(([, s]) => s.rate < thresholds.demote_warn_rate)
            .map(([m, s]) => [m, s.rate]),
        ),
      });
    }
  }
  return items;
}

/** Slim routing artifact kept for backward compatibility. */
export function routingDiagnosticsFromFunnel(doc: FunnelDiagnosticsDoc): {
  run_metadata: FunnelDiagnosticsDoc["run_metadata"];
  summary: FunnelDiagnosticsDoc["routing"] & { total_routed: number };
  unmapped_samples: FunnelDiagnosticsDoc["unmapped_samples"];
} {
  return {
    run_metadata: doc.run_metadata,
    summary: {
      total_routed: doc.stages.kill_survivors,
      ...doc.routing,
    },
    unmapped_samples: doc.unmapped_samples,
  };
}

function printReasonTable(
  lines: string[],
  title: string,
  counts: Record<string, number>,
  base: number,
): void {
  lines.push(`## ${title}`);
  lines.push("");
  lines.push("| Reason | Count | Share of universe |");
  lines.push("|--------|-------|-------------------|");
  for (const [reason, count] of sortedEntries(counts)) {
    lines.push(`| ${reason} | ${count} | ${pct(count, base)} |`);
  }
  lines.push("");
}

export function formatFunnelReplayReport(doc: FunnelDiagnosticsDoc, market: Market): string {
  const lines: string[] = [];
  const s = doc.stages;

  lines.push(`# Funnel replay — ${market}`);
  lines.push("");
  lines.push(`Quarter: ${doc.run_metadata.quarter} · Executed: ${doc.run_metadata.executed_at}`);
  lines.push("");

  lines.push("## Funnel stages");
  lines.push("");
  lines.push("| Stage | Count | Share of universe |");
  lines.push("|-------|-------|-------------------|");
  lines.push(`| Quote universe | ${s.quote_universe} | 100.0% |`);
  lines.push(
    `| Prefilter excluded | ${s.prefilter_excluded} | ${pct(s.prefilter_excluded, s.quote_universe)} |`,
  );
  lines.push(
    `| Enriched in run | ${s.enriched_in_run} | ${pct(s.enriched_in_run, s.quote_universe)} |`,
  );
  lines.push(
    `| Kill gate excluded | ${s.kill_excluded} | ${pct(s.kill_excluded, s.quote_universe)} |`,
  );
  lines.push(
    `| Kill gate survivors | ${s.kill_survivors} | ${pct(s.kill_survivors, s.quote_universe)} |`,
  );
  lines.push(
    `| Sector template passed | ${s.sector_passed} | ${pct(s.sector_passed, s.quote_universe)} |`,
  );
  lines.push(
    `| Sector template filtered | ${s.sector_filtered} | ${pct(s.sector_filtered, s.quote_universe)} |`,
  );
  lines.push(`| Candidates | ${s.candidates} | ${pct(s.candidates, s.quote_universe)} |`);
  lines.push(`| Deferred | ${s.deferred} | ${pct(s.deferred, s.quote_universe)} |`);
  if (s.sector_pass_overflow > 0) {
    lines.push(
      `| Sector pass overflow (not in deferred.yaml) | ${s.sector_pass_overflow} | ${pct(s.sector_pass_overflow, s.quote_universe)} |`,
    );
  }
  lines.push("");

  if (s.prefilter_excluded > 0) {
    printReasonTable(
      lines,
      "Prefilter exclusions (prefilter-excluded.yaml)",
      doc.prefilter_by_reason,
      s.quote_universe,
    );
  }

  if (s.kill_excluded > 0) {
    printReasonTable(
      lines,
      "Kill gate exclusions (excluded.yaml)",
      doc.kill_by_reason,
      s.quote_universe,
    );
  }

  lines.push("## Post kill gate — routing distribution");
  lines.push("");
  lines.push(
    `Fallback rate (of kill survivors): **${pct(doc.routing.fallback_count ?? 0, s.kill_survivors)}** (${doc.routing.fallback_rate.toFixed(3)})`,
  );
  lines.push("");
  lines.push("### By routing_method");
  lines.push("");
  lines.push("| Method | Count | Share of kill survivors |");
  lines.push("|--------|-------|-------------------------|");
  for (const [method, count] of sortedEntries(doc.routing.by_method)) {
    lines.push(`| ${method} | ${count} | ${pct(count, s.kill_survivors)} |`);
  }
  lines.push("");
  lines.push("### By routed template (ambiguous_union may double-count)");
  lines.push("");
  lines.push("| Template | Routed | Share of kill survivors |");
  lines.push("|----------|--------|-------------------------|");
  for (const [template, count] of sortedEntries(doc.routing.by_template)) {
    lines.push(`| ${template} | ${count} | ${pct(count, s.kill_survivors)} |`);
  }
  lines.push("");

  if (Object.keys(doc.sector_by_template).length > 0) {
    lines.push("## Post kill gate — sector template pass rates");
    lines.push("");
    lines.push("| Template | Evaluated | Any track passed | Pass rate |");
    lines.push("|----------|-----------|------------------|-----------|");
    for (const [template, stats] of Object.entries(doc.sector_by_template).sort(
      (a, b) => b[1].routed - a[1].routed,
    )) {
      lines.push(
        `| ${template} | ${stats.routed} | ${stats.passed_any_track} | ${pct(stats.passed_any_track, stats.routed)} |`,
      );
    }
    lines.push("");
  }

  if (Object.keys(doc.by_pool_selected).length > 0) {
    lines.push("## Template track seat pools — selected counts");
    lines.push("");
    lines.push("| Pool | Selected |");
    lines.push("|------|----------|");
    for (const [pool, count] of sortedEntries(doc.by_pool_selected)) {
      lines.push(`| ${pool} | ${count} |`);
    }
    lines.push("");
  }

  if (Object.keys(doc.sector_exit_by_reason ?? {}).length > 0) {
    lines.push("## Sector exits (non-kill)");
    lines.push("");
    lines.push("| Reason | Count |");
    lines.push("|--------|-------|");
    for (const [reason, count] of sortedEntries(doc.sector_exit_by_reason)) {
      lines.push(`| ${reason} | ${count} |`);
    }
    lines.push("");
  }

  if (doc.metric_coverage && Object.keys(doc.metric_coverage).length > 0) {
    lines.push("## Metric coverage (required metrics after enrich)");
    lines.push("");
    const topTemplates = Object.entries(doc.metric_coverage)
      .sort((a, b) => b[1].routed - a[1].routed)
      .slice(0, 5);
    for (const [templateKey, bucket] of topTemplates) {
      lines.push(`### ${templateKey} (routed: ${bucket.routed})`);
      lines.push("");
      lines.push("| Metric | Present | Rate |");
      lines.push("|--------|---------|------|");
      const sortedMetrics = Object.entries(bucket.required).sort((a, b) => a[1].rate - b[1].rate);
      for (const [metric, stat] of sortedMetrics) {
        lines.push(`| ${metric} | ${stat.present} | ${stat.rate.toFixed(3)} |`);
      }
      lines.push("");
    }
  }

  lines.push("## Manifest review (advisory)");
  lines.push("");
  if (!doc.manifest_review?.length) {
    lines.push("No manifest changes suggested this run.");
  } else {
    for (const item of doc.manifest_review) {
      lines.push(
        `- ACTION: **${item.suggestion}** — \`${item.template_key}\` (${item.declared_viability}): ${item.detail}`,
      );
    }
  }
  lines.push("");

  if (doc.unmapped_samples.length > 0) {
    lines.push("## Unmapped industry samples (fallback routing, up to 50)");
    lines.push("");
    for (const sample of doc.unmapped_samples.slice(0, 10)) {
      lines.push(`- ${sample.ticker}: ${sample.industry_proxy ?? "(missing)"}`);
    }
    if (doc.unmapped_samples.length > 10) {
      lines.push(`- … and ${doc.unmapped_samples.length - 10} more in funnel-diagnostics.yaml`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildFunnelDiagnosticsFromArtifacts(
  market: Market,
  artifacts: {
    run_metadata?: FunnelDiagnosticsDoc["run_metadata"];
    prefilter_excluded?: Array<{ kill_reason?: string }>;
    excluded?: Array<{ kill_reason?: string }>;
    funnel_diagnostics?: FunnelDiagnosticsDoc;
    routing_diagnostics?: {
      summary?: {
        total_routed?: number;
        by_method?: Record<string, number>;
        by_template?: Record<string, number>;
        fallback_rate?: number;
      };
      unmapped_samples?: FunnelDiagnosticsDoc["unmapped_samples"];
    };
    candidates?: unknown[];
    deferred?: unknown[];
  },
): FunnelDiagnosticsDoc | null {
  if (artifacts.funnel_diagnostics) return artifacts.funnel_diagnostics;

  const meta = artifacts.run_metadata;
  if (!meta) return null;

  const prefilterByReason: Record<string, number> = {};
  for (const row of artifacts.prefilter_excluded ?? []) {
    countReason(prefilterByReason, row.kill_reason, "kill_prefilter_excluded");
  }

  const killByReason: Record<string, number> = {};
  for (const row of artifacts.excluded ?? []) {
    countReason(killByReason, row.kill_reason, "unknown");
  }

  const prefilterExcluded = artifacts.prefilter_excluded?.length ?? 0;
  const killExcluded = artifacts.excluded?.length ?? 0;
  const routing = artifacts.routing_diagnostics?.summary;
  const totalRouted = routing?.total_routed ?? 0;
  const quoteUniverse = meta.universe_count ?? totalRouted + prefilterExcluded;
  const enrichedInRun = totalRouted + killExcluded;
  const candidates = artifacts.candidates?.length ?? meta.candidate_count ?? 0;
  const deferred = artifacts.deferred?.length ?? meta.deferred_count ?? 0;
  const sectorPassed = (meta as { sector_passed?: number }).sector_passed ?? candidates + deferred;
  const sectorPassOverflow =
    (meta as { sector_pass_overflow?: number }).sector_pass_overflow ??
    Math.max(0, sectorPassed - candidates - deferred);
  const routingWithFallbackCount = routing as
    | (typeof routing & { fallback_count?: number })
    | undefined;

  return {
    run_metadata: meta,
    deferred_watchlist_cap:
      (meta as { deferred_watchlist_cap?: number }).deferred_watchlist_cap ?? 20,
    stages: {
      quote_universe: quoteUniverse,
      prefilter_excluded: prefilterExcluded,
      enriched_in_run: enrichedInRun,
      kill_excluded: killExcluded,
      kill_survivors: totalRouted,
      sector_passed: sectorPassed,
      sector_filtered: Math.max(0, totalRouted - sectorPassed),
      candidates,
      deferred,
      sector_pass_overflow: sectorPassOverflow,
    },
    prefilter_by_reason: prefilterByReason,
    kill_by_reason: killByReason,
    sector_exit_by_reason: {},
    routing: {
      by_method: routing?.by_method ?? {},
      by_template: routing?.by_template ?? {},
      fallback_count:
        routingWithFallbackCount?.fallback_count ??
        Math.round((routing?.fallback_rate ?? 0) * totalRouted),
      fallback_rate: routing?.fallback_rate ?? 0,
    },
    sector_by_template: {},
    by_pool_selected: {},
    unmapped_samples: artifacts.routing_diagnostics?.unmapped_samples ?? [],
  };
}

// 归档报告：按行业及模板轨道解释已保存的筛选结果。

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
      "Provide either --from-output </tmp/us-run/quarter/US> " +
        "or --output <root> --quarter YYYY-Qn --markets CN|US",
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
    filters.templates = opts.template
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const tracks = parseTracks(opts.track);
  if (tracks?.length) filters.tracks = tracks;
  if (opts.industryL1) filters.industryL1 = opts.industryL1;
  if (opts.industryL2) filters.industryL2 = opts.industryL2;
  if (opts.industryL3) filters.industryL3 = opts.industryL3;
  return filters;
}

export async function filterBreakdownCommand(opts: FilterBreakdownCommandOptions): Promise<void> {
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
    const specDir = path.resolve(opts.spec ?? DEFAULT_POLICY_DIR);
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

// 先从保存的结果识别退出阶段，再按行业/原因聚合，避免报告重跑实时数据。
const PREFILTER_NO_INDUSTRY = "(预筛剔除 / 无 enrichment)";

export function parseIndustryLevels(
  proxy: string | null | undefined,
): { l1: string; l2: string; l3: string } | null {
  if (!proxy?.trim()) return null;
  const parts = proxy
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
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
      path.join(marketDir, "candidates.yaml"),
    )?.run_metadata ??
    readYamlIfExists<{ run_metadata?: { universe_count?: number; quarter?: string } }>(
      path.join(marketDir, "funnel-diagnostics.yaml"),
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
      const payload = JSON.parse(fs.readFileSync(path.join(cacheMarketDir, file), "utf8")) as {
        industryProxy?: string;
      };
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
    ]),
  );
  const deferredMap = new Map(
    (deferredDoc?.deferred ?? []).map((row) => [
      row.ticker,
      {
        industryProxy: row.industry_proxy ?? null,
        routedTemplate: row.routed_templates?.[0],
      },
    ]),
  );
  const killMap = new Map(
    (excludedDoc?.excluded ?? []).map((row) => [row.ticker, row.kill_reason ?? "unknown_kill"]),
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
  level: 1 | 2 | 3,
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
    bucket.sectorFilterRate = bucket.total > 0 ? bucket.byStage.sector_filtered / bucket.total : 0;
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
  limit?: number,
): void {
  const rows = limit ? buckets.slice(0, limit) : buckets;
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(
    "| Industry | Total | Cand | Def | Kill | Sector filt | Prefilt | Cand% | Kill% | Sector% | Top reason |",
  );
  lines.push(
    "|----------|-------|------|-----|------|-------------|---------|-------|-------|---------|------------|",
  );
  for (const b of rows) {
    lines.push(
      `| ${b.key} | ${b.total} | ${b.byStage.candidate} | ${b.byStage.deferred} | ` +
        `${b.byStage.kill_excluded} | ${b.byStage.sector_filtered} | ${b.byStage.prefilter_excluded} | ` +
        `${pct(b.byStage.candidate, b.total)} | ${pct(b.byStage.kill_excluded, b.total)} | ` +
        `${pct(b.byStage.sector_filtered, b.total)} | ${topReason(b.byReason)} |`,
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
  base: number,
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
  } = {},
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
  lines.push(
    `Universe (quote list): **${universeCount}** · Classified rows: **${tickers.length}**`,
  );
  if (tickers.length < universeCount) {
    lines.push(
      `WARN: **${universeCount - tickers.length}** tickers missing from enrichment cache — ` +
        "industry breakdown covers cache + prefilter only.",
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
    enriched.length,
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
    "- `prefilter_excluded` tickers have no enrichment cache; grouped under `(预筛剔除 / 无 enrichment)`.",
  );
  lines.push(
    "- `sector_template_filtered` means passed kill gates but failed all sector template tracks.",
  );
  lines.push(
    "- For required/supporting metric failures, re-run with `--template-tracks` on this command.",
  );
  lines.push(
    "- `deferred_soft_cap` means passed funnel but ranked below the per-market soft cap (" +
      `${softCap}).`,
  );

  if (opts.templateTrack) {
    lines.push("");
    lines.push(
      formatTemplateTrackBreakdownSection(opts.templateTrack, {
        top: opts.trackTop,
        focusTemplate: opts.templateTrack.filters.templates?.[0],
        focusTrack: opts.templateTrack.filters.tracks?.[0],
      }),
    );
  }

  lines.push("");

  return lines.join("\n");
}

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
  filters: TemplateTrackBreakdownFilters,
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
  trackFilter?: FunnelTrack[],
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
          tplRef.subTemplate,
        ),
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
  filters: TemplateTrackBreakdownFilters,
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

// 轨道报告保留 quality 与 mispricing 的首个失败原因，供定位规则收紧位置。
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
      }),
    ).map((r) => [r.ticker, r]),
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
  opts: { template?: string; track?: FunnelTrack; top?: number },
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
  const buckets = new Map<
    string,
    { template: string; track: FunnelTrack; passed: number; failed: number }
  >();

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

function aggregatePrimaryTrackFailures(
  doc: TemplateTrackBreakdownDoc,
  top = 25,
): Array<[string, number]> {
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
  top = 15,
) {
  const buckets = new Map<
    string,
    { total: number; passed: number; failed: number; failures: Record<string, number> }
  >();

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
  opts: { top?: number; focusTemplate?: string; focusTrack?: FunnelTrack } = {},
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
  if (doc.filters.templates?.length)
    filterParts.push(`templates: ${doc.filters.templates.join(", ")}`);
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
      `| ${row.template} | ${row.track} | ${row.evaluated} | ${row.passed} | ${row.failed} | ${pct(row.passed, row.evaluated)} |`,
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
    lines.push(`| ${row.key} | ${row.total} | ${row.passed} | ${row.failed} | ${row.topFailure} |`);
  }
  lines.push("");

  return lines.join("\n");
}
