import type { EnrichRunStats } from "../data/types.js";
import type { SpecBundle } from "../spec/types.js";
import { buildRunMetadata } from "../io/artifacts.js";
import { pct, sortedEntries } from "../lib/report-format.js";
import {
  bestPassingCandidate,
  listTemplateTrackResults,
  routeSecurityRecord,
  type PassingCandidate,
} from "./run.js";
import { templateLiveViability, manifestReviewThresholdsFromBundle } from "../spec/conventions.js";
import type { KillGateResult, SecurityRecord } from "./kill-gates.js";
import { resolveTemplateForEvaluation } from "./template-evaluator.js";
import type { SectorTemplateSpec } from "../spec/types.js";
import type { RouteResult } from "./router.js";
import { getUniverseProfileFailureReason } from "./universe.js";
import type { Market } from "./types.js";

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

  private recordMetricCoverage(bundle: SpecBundle, route: RouteResult, record: SecurityRecord): void {
    for (const tplRef of route.templates) {
      const key = this.coverageKey(tplRef.id, tplRef.subTemplate);
      const bucket = this.metricCoverage[key] ?? { routed: 0, required: {} };
      bucket.routed += 1;

      const tpl = bundle.templates[tplRef.id];
      if (tpl) {
        const evalTpl = resolveTemplateForEvaluation(
          tpl as SectorTemplateSpec & Record<string, unknown>,
          tplRef.subTemplate
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
        getUniverseProfileFailureReason(bundle.killGates, record) ?? "kill_prefilter_excluded";
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
    kill: KillGateResult
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
        (t) => templateLiveViability(bundle, t.id, t.subTemplate) === "quant_too_hard"
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
        manifestReviewThresholdsFromBundle(opts.bundle)
      );
    }

    return doc;
  }
}

function countReason(
  bucket: Record<string, number>,
  reason: string | undefined,
  fallback = "unknown"
): void {
  const key = reason ?? fallback;
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function buildMetricCoverageOutput(
  raw: Record<string, { routed: number; required: Record<string, { present: number }> }>
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
          ])
        ),
      },
    ])
  );
}

export function buildManifestReview(
  bundle: SpecBundle,
  coverage: FunnelDiagnosticsDoc["metric_coverage"],
  thresholds: { promote_min_rate: number; demote_warn_rate: number; min_routed: number }
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
        metrics: Object.fromEntries(
          Object.entries(bucket.required).map(([m, s]) => [m, s.rate])
        ),
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
            .map(([m, s]) => [m, s.rate])
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
  base: number
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
    `| Prefilter excluded | ${s.prefilter_excluded} | ${pct(s.prefilter_excluded, s.quote_universe)} |`
  );
  lines.push(
    `| Enriched in run | ${s.enriched_in_run} | ${pct(s.enriched_in_run, s.quote_universe)} |`
  );
  lines.push(`| Kill gate excluded | ${s.kill_excluded} | ${pct(s.kill_excluded, s.quote_universe)} |`);
  lines.push(
    `| Kill gate survivors | ${s.kill_survivors} | ${pct(s.kill_survivors, s.quote_universe)} |`
  );
  lines.push(
    `| Sector template passed | ${s.sector_passed} | ${pct(s.sector_passed, s.quote_universe)} |`
  );
  lines.push(
    `| Sector template filtered | ${s.sector_filtered} | ${pct(s.sector_filtered, s.quote_universe)} |`
  );
  lines.push(`| Candidates | ${s.candidates} | ${pct(s.candidates, s.quote_universe)} |`);
  lines.push(`| Deferred | ${s.deferred} | ${pct(s.deferred, s.quote_universe)} |`);
  if (s.sector_pass_overflow > 0) {
    lines.push(
      `| Sector pass overflow (not in deferred.yaml) | ${s.sector_pass_overflow} | ${pct(s.sector_pass_overflow, s.quote_universe)} |`
    );
  }
  lines.push("");

  if (s.prefilter_excluded > 0) {
    printReasonTable(
      lines,
      "Prefilter exclusions (prefilter-excluded.yaml)",
      doc.prefilter_by_reason,
      s.quote_universe
    );
  }

  if (s.kill_excluded > 0) {
    printReasonTable(
      lines,
      "Kill gate exclusions (excluded.yaml)",
      doc.kill_by_reason,
      s.quote_universe
    );
  }

  lines.push("## Post kill gate — routing distribution");
  lines.push("");
  lines.push(
    `Fallback rate (of kill survivors): **${pct(doc.routing.fallback_count ?? 0, s.kill_survivors)}** (${doc.routing.fallback_rate.toFixed(3)})`
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
      (a, b) => b[1].routed - a[1].routed
    )) {
      lines.push(
        `| ${template} | ${stats.routed} | ${stats.passed_any_track} | ${pct(stats.passed_any_track, stats.routed)} |`
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
        `- ACTION: **${item.suggestion}** — \`${item.template_key}\` (${item.declared_viability}): ${item.detail}`
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
      lines.push(
        `- … and ${doc.unmapped_samples.length - 10} more in funnel-diagnostics.yaml`
      );
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
  }
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
  const sectorPassed =
    (meta as { sector_passed?: number }).sector_passed ?? candidates + deferred;
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
