import type { SpecBundle, SectorTemplateSpec } from "../spec/types.js";
import type { KillGateResult, SecurityRecord } from "./kill-gates.js";
import { routeSecurity, type RouteResult } from "./router.js";
import { evaluateTemplateTrack, type TemplateEvalResult } from "./template-evaluator.js";

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
  routed_templates: string[];
  routing_confidence: RouteResult["routingConfidence"];
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
          record
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
  route: RouteResult
): PassingCandidate | null {
  let best: PassingCandidate | null = null;

  for (const entry of listTemplateTrackResults(bundle, record, route)) {
    if (!entry.result.passed || !entry.result.passedTrack) continue;

    const score = entry.result.supportingPassCount;
    if (best && score <= best.compositeScore) continue;

    best = {
      ticker: record.ticker,
      market: record.market,
      company_name: record.companyName,
      currency: record.currency,
      routed_templates: route.templates.map((t) => t.id),
      routing_confidence: route.routingConfidence,
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
