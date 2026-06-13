import type { SpecBundle } from "../spec/types.js";
import { buildRunMetadata } from "../io/artifacts.js";
import { pct, sortedEntries } from "../lib/report-format.js";
import {
  bestPassingCandidate,
  listTemplateTrackResults,
  routeSecurityRecord,
  type PassingCandidate,
} from "./run.js";
import type { KillGateResult, SecurityRecord } from "./kill-gates.js";
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
  };
  prefilter_by_reason: Record<string, number>;
  kill_by_reason: Record<string, number>;
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
  unmapped_samples: Array<{ ticker: string; industry_proxy?: string }>;
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

  killExcluded = 0;
  sectorPassed = 0;
  fallbackCount = 0;

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
      if (this.unmappedSamples.length < 50) {
        this.unmappedSamples.push({ ticker: record.ticker, industry_proxy: record.industryProxy });
      }
    }

    for (const template of route.templates) {
      this.byTemplate[template.id] = (this.byTemplate[template.id] ?? 0) + 1;
      if (!this.sectorByTemplate[template.id]) {
        this.sectorByTemplate[template.id] = { routed: 0, passed: 0 };
      }
      this.sectorByTemplate[template.id].routed += 1;
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

    const run_metadata = buildRunMetadata({
      bundle: opts.bundle,
      quarter: opts.quarter,
      marketScope: opts.market,
      universeCount: opts.universeCount,
      candidateCount: opts.candidateCount,
      deferredCount: opts.deferredCount,
    });

    return {
      run_metadata,
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
      },
      prefilter_by_reason: this.prefilterByReason,
      kill_by_reason: this.killByReason,
      routing: {
        by_method: this.byMethod,
        by_template: this.byTemplate,
        fallback_count: this.fallbackCount,
        fallback_rate: killSurvivors > 0 ? this.fallbackCount / killSurvivors : 0,
      },
      sector_by_template: sectorByTemplateOut,
      unmapped_samples: this.unmappedSamples,
    };
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

  return {
    run_metadata: meta,
    stages: {
      quote_universe: quoteUniverse,
      prefilter_excluded: prefilterExcluded,
      enriched_in_run: enrichedInRun,
      kill_excluded: killExcluded,
      kill_survivors: totalRouted,
      sector_passed: candidates + deferred,
      sector_filtered: Math.max(0, totalRouted - candidates - deferred),
      candidates,
      deferred,
    },
    prefilter_by_reason: prefilterByReason,
    kill_by_reason: killByReason,
    routing: {
      by_method: routing?.by_method ?? {},
      by_template: routing?.by_template ?? {},
      fallback_count:
        routing?.fallback_count ??
        Math.round((routing?.fallback_rate ?? 0) * totalRouted),
      fallback_rate: routing?.fallback_rate ?? 0,
    },
    sector_by_template: {},
    unmapped_samples: artifacts.routing_diagnostics?.unmapped_samples ?? [],
  };
}
