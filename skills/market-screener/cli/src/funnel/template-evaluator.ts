import type { SectorTemplateSpec } from "../spec/types.js";
import type { SecurityRecord } from "../domain/types.js";
import { evaluateThreshold, formatThresholdMiss, isMarketMissingOverrideSkip, shouldSkipMissingMetric } from "./threshold.js";
import type { MetricValue, ThresholdRule } from "./types.js";

export interface TemplateEvalResult {
  passed: boolean;
  passedTrack?: "quality" | "mispricing";
  metricSnapshot: Record<string, MetricValue>;
  supportingPassCount: number;
  supportingTotal: number;
  auditHints: string[];
  funnelFlags: string[];
}

export type RuleOutcomeKind = "pass" | "fail" | "skip";

export interface RuleOutcome {
  metric: string;
  kind: RuleOutcomeKind;
  skipReason?: "missing" | "conditional" | "market_override";
  detail?: string;
  value?: number;
}

export type TemplateFailureStage = "no_track" | "required" | "supporting_min";

export interface TemplateTrackDiagnostic {
  template: string;
  subTemplate?: string;
  track: "quality" | "mispricing";
  passed: boolean;
  failureStage?: TemplateFailureStage;
  requiredOutcomes: RuleOutcome[];
  supportingOutcomes: RuleOutcome[];
  supportingPassCount: number;
  supportingTotal: number;
  supportingMin: number;
  supportingSkipped: number;
}

function parsePassLogic(passIf: string): { supportingMin: number; supportingTotal: number } {
  const match = passIf.match(/min_(\d+)_of_(\d+)/);
  if (!match) return { supportingMin: 0, supportingTotal: 0 };
  return { supportingMin: Number(match[1]), supportingTotal: Number(match[2]) };
}

function toThresholdRule(rule: Record<string, unknown>): ThresholdRule {
  const threshold = { ...rule } as ThresholdRule & Record<string, unknown>;
  delete threshold.metric;
  delete threshold.if_unprofitable;
  delete threshold.if_fcf_negative;
  return threshold;
}

export function resolveTemplateForEvaluation(
  template: SectorTemplateSpec & Record<string, unknown>,
  subTemplateId?: string
): SectorTemplateSpec & Record<string, unknown> {
  if (!subTemplateId) return template;
  const subTemplates = template.sub_templates as Record<string, Record<string, unknown>> | undefined;
  const sub = subTemplates?.[subTemplateId];
  if (!sub) return template;
  const merged = { ...template, ...sub };
  delete merged.sub_templates;
  return merged;
}

type SupportingSkipReason = "missing" | "conditional";

function resolveMetricValue(
  record: SecurityRecord,
  metric: string,
  rule: Record<string, unknown>
): MetricValue | undefined {
  const direct = record.metrics[metric];
  if (direct?.value !== undefined) return direct;
  if (metric === "ps_vs_5y_median" && rule.missing === "use_ps_vs_peer") {
    return record.metrics.ps_vs_peer_median;
  }
  return direct;
}

function getSupportingSkipReason(
  rule: Record<string, unknown>,
  record: SecurityRecord,
  metric: MetricValue | undefined
): SupportingSkipReason | undefined {
  if (rule.if_unprofitable === "skip") {
    const netIncome = record.metrics.net_income?.value;
    if (netIncome !== undefined && netIncome < 0) return "conditional";
  }
  if (rule.if_fcf_negative === "skip") {
    const fcf = record.metrics.fcf_margin?.value ?? record.metrics.free_cash_flow?.value;
    if (fcf !== undefined && fcf < 0) return "conditional";
  }
  if (metric?.value === undefined && shouldSkipMissingMetric(toThresholdRule(rule), record.market)) {
    return "missing";
  }
  return undefined;
}

function evalRuleList(
  rules: Array<Record<string, unknown>>,
  record: SecurityRecord
): {
  passCount: number;
  total: number;
  snapshot: Record<string, MetricValue>;
  missingSkipCount: number;
  otherSkipCount: number;
  marketMissingSkippedMetrics: string[];
} {
  let passCount = 0;
  let total = 0;
  let missingSkipCount = 0;
  let otherSkipCount = 0;
  const marketMissingSkippedMetrics: string[] = [];
  const snapshot: Record<string, MetricValue> = {};

  for (const rule of rules) {
    const metric = rule.metric as string | undefined;
    if (!metric) continue;

    const mv = resolveMetricValue(record, metric, rule);
    const skipReason = getSupportingSkipReason(rule, record, mv);
    if (skipReason === "missing") {
      missingSkipCount += 1;
      if (isMarketMissingOverrideSkip(toThresholdRule(rule), record.market)) {
        marketMissingSkippedMetrics.push(metric);
      }
      continue;
    }
    if (skipReason === "conditional") {
      otherSkipCount += 1;
      continue;
    }

    total += 1;
    const result = evaluateThreshold(mv, toThresholdRule(rule), record.market);
    if (mv) snapshot[metric] = mv;
    if (result.passed) passCount += 1;
  }

  return { passCount, total, snapshot, missingSkipCount, otherSkipCount, marketMissingSkippedMetrics };
}

function evalRequiredRules(
  required: Record<string, ThresholdRule>,
  record: SecurityRecord
): { passed: boolean; outcomes: RuleOutcome[]; snapshot: Record<string, MetricValue> } {
  const outcomes: RuleOutcome[] = [];
  const snapshot: Record<string, MetricValue> = {};

  for (const [metric, rule] of Object.entries(required)) {
    const mv = resolveMetricValue(record, metric, rule as Record<string, unknown>);
    const res = evaluateThreshold(mv, rule, record.market);
    if (res.skipped) {
      outcomes.push({
        metric,
        kind: "skip",
        skipReason: shouldSkipMissingMetric(rule, record.market) ? "missing" : "conditional",
        detail: formatThresholdMiss(mv, rule, record.market),
      });
      continue;
    }
    if (!res.passed) {
      outcomes.push({
        metric,
        kind: "fail",
        value: mv?.value,
        detail: formatThresholdMiss(mv, rule, record.market),
      });
      return { passed: false, outcomes, snapshot };
    }
    outcomes.push({ metric, kind: "pass", value: mv?.value });
    if (mv) snapshot[metric] = mv;
  }

  return { passed: true, outcomes, snapshot };
}

function evalSupportingRules(
  rules: Array<Record<string, unknown>>,
  record: SecurityRecord
): {
  passCount: number;
  total: number;
  outcomes: RuleOutcome[];
  missingSkipCount: number;
  otherSkipCount: number;
} {
  let passCount = 0;
  let total = 0;
  let missingSkipCount = 0;
  let otherSkipCount = 0;
  const outcomes: RuleOutcome[] = [];

  for (const rule of rules) {
    const metric = rule.metric as string | undefined;
    if (!metric) continue;

    const mv = resolveMetricValue(record, metric, rule);
    const thresholdRule = toThresholdRule(rule);
    const skipReason = getSupportingSkipReason(rule, record, mv);
    if (skipReason === "missing") {
      missingSkipCount += 1;
      outcomes.push({
        metric,
        kind: "skip",
        skipReason: isMarketMissingOverrideSkip(thresholdRule, record.market)
          ? "market_override"
          : "missing",
        detail: formatThresholdMiss(mv, thresholdRule, record.market),
      });
      continue;
    }
    if (skipReason === "conditional") {
      otherSkipCount += 1;
      outcomes.push({
        metric,
        kind: "skip",
        skipReason: "conditional",
        detail: formatThresholdMiss(mv, thresholdRule, record.market),
      });
      continue;
    }

    total += 1;
    const result = evaluateThreshold(mv, thresholdRule, record.market);
    if (result.passed) {
      passCount += 1;
      outcomes.push({ metric, kind: "pass", value: mv?.value });
    } else {
      outcomes.push({
        metric,
        kind: "fail",
        value: mv?.value,
        detail: formatThresholdMiss(mv, thresholdRule, record.market),
      });
    }
  }

  return { passCount, total, outcomes, missingSkipCount, otherSkipCount };
}

export function evaluateTemplateTrackDiagnostic(
  template: SectorTemplateSpec & Record<string, unknown>,
  track: "quality" | "mispricing",
  record: SecurityRecord,
  subTemplateId?: string
): TemplateTrackDiagnostic {
  const evalTemplate = resolveTemplateForEvaluation(template, subTemplateId);
  const trackDef = evalTemplate[`${track}_track`] as Record<string, unknown> | undefined;
  const base: TemplateTrackDiagnostic = {
    template: (evalTemplate.template as string) ?? "unknown",
    subTemplate: subTemplateId,
    track,
    passed: false,
    requiredOutcomes: [],
    supportingOutcomes: [],
    supportingPassCount: 0,
    supportingTotal: 0,
    supportingMin: 0,
    supportingSkipped: 0,
  };

  if (!trackDef) {
    return { ...base, failureStage: "no_track" };
  }

  const required = (trackDef.required as Record<string, ThresholdRule>) ?? {};
  const {
    passed: requiredPassed,
    outcomes: requiredOutcomes,
  } = evalRequiredRules(required, record);

  const supportingRules = (trackDef.supporting as Array<Record<string, unknown>>) ?? [];
  const {
    passCount,
    total,
    outcomes: supportingOutcomes,
    missingSkipCount,
    otherSkipCount,
  } = evalSupportingRules(supportingRules, record);

  const passIf = (trackDef.pass_if as string) ?? "";
  const { supportingMin } = parsePassLogic(passIf);
  const supportingPassed = resolveSupportingPass(
    passCount,
    total,
    supportingMin,
    missingSkipCount,
    otherSkipCount
  );

  const passed = requiredPassed && supportingPassed;
  let failureStage: TemplateFailureStage | undefined;
  if (!passed) {
    failureStage = !requiredPassed ? "required" : "supporting_min";
  }

  return {
    ...base,
    passed,
    failureStage,
    requiredOutcomes,
    supportingOutcomes,
    supportingPassCount: passCount,
    supportingTotal: total,
    supportingMin,
    supportingSkipped: missingSkipCount + otherSkipCount,
  };
}

/** Downgrade supportingMin only when fewer metrics are evaluable solely due to missing: skip. */
function resolveSupportingPass(
  passCount: number,
  total: number,
  supportingMin: number,
  missingSkipCount: number,
  otherSkipCount: number
): boolean {
  if (total === 0) return false;
  if (total >= supportingMin) {
    return passCount >= supportingMin;
  }

  const gap = supportingMin - total;
  const downgradeEligible =
    otherSkipCount === 0 && missingSkipCount > 0 && gap <= missingSkipCount;

  if (downgradeEligible) {
    return passCount >= total;
  }

  return false;
}

export function evaluateTemplateTrack(
  template: SectorTemplateSpec & Record<string, unknown>,
  track: "quality" | "mispricing",
  record: SecurityRecord,
  subTemplateId?: string
): TemplateEvalResult {
  const empty: TemplateEvalResult = {
    passed: false,
    metricSnapshot: {},
    supportingPassCount: 0,
    supportingTotal: 0,
    auditHints: [],
    funnelFlags: [],
  };

  const evalTemplate = resolveTemplateForEvaluation(template, subTemplateId);
  const trackDef = evalTemplate[`${track}_track`] as Record<string, unknown> | undefined;
  if (!trackDef) return empty;

  const snapshot: Record<string, MetricValue> = {};
  const required = (trackDef.required as Record<string, ThresholdRule>) ?? {};
  for (const [metric, rule] of Object.entries(required)) {
    const mv = resolveMetricValue(record, metric, rule as Record<string, unknown>);
    const res = evaluateThreshold(mv, rule, record.market);
    if (!res.passed && !res.skipped) return empty;
    if (mv) snapshot[metric] = mv;
  }

  const supportingRules = (trackDef.supporting as Array<Record<string, unknown>>) ?? [];
  const {
    passCount,
    total,
    snapshot: supportingSnapshot,
    missingSkipCount,
    otherSkipCount,
    marketMissingSkippedMetrics,
  } = evalRuleList(supportingRules, record);
  Object.assign(snapshot, supportingSnapshot);

  const passIf = (trackDef.pass_if as string) ?? "";
  const { supportingMin } = parsePassLogic(passIf);
  const passed = resolveSupportingPass(
    passCount,
    total,
    supportingMin,
    missingSkipCount,
    otherSkipCount
  );

  const auditHints = ((evalTemplate.audit_hints as string[]) ?? []).slice();
  const funnelFlags = [
    ...((evalTemplate.funnel_flags as string[]) ?? []),
    ...((trackDef.funnel_flags as string[]) ?? []),
  ];

  if (
    record.market === "CN" &&
    marketMissingSkippedMetrics.some((m) => m === "sbc_to_revenue" || m === "share_dilution_3y")
  ) {
    funnelFlags.push("verify_sbc_dilution_in_deep_cn");
  }

  return {
    passed,
    passedTrack: passed ? track : undefined,
    metricSnapshot: snapshot,
    supportingPassCount: passCount,
    supportingTotal: total,
    auditHints,
    funnelFlags,
  };
}
