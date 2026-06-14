import type { SectorTemplateSpec } from "../spec/types.js";
import type { SecurityRecord } from "./kill-gates.js";
import { evaluateThreshold } from "./threshold.js";
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

type SupportingSkipReason = "missing" | "conditional";

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
  if (metric?.value === undefined && rule.missing === "skip") {
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
} {
  let passCount = 0;
  let total = 0;
  let missingSkipCount = 0;
  let otherSkipCount = 0;
  const snapshot: Record<string, MetricValue> = {};

  for (const rule of rules) {
    const metric = rule.metric as string | undefined;
    if (!metric) continue;

    const mv = record.metrics[metric];
    const skipReason = getSupportingSkipReason(rule, record, mv);
    if (skipReason === "missing") {
      missingSkipCount += 1;
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

  return { passCount, total, snapshot, missingSkipCount, otherSkipCount };
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
  record: SecurityRecord
): TemplateEvalResult {
  const empty: TemplateEvalResult = {
    passed: false,
    metricSnapshot: {},
    supportingPassCount: 0,
    supportingTotal: 0,
    auditHints: [],
    funnelFlags: [],
  };

  const trackDef = template[`${track}_track`] as Record<string, unknown> | undefined;
  if (!trackDef) return empty;

  const snapshot: Record<string, MetricValue> = {};
  const required = (trackDef.required as Record<string, ThresholdRule>) ?? {};
  for (const [metric, rule] of Object.entries(required)) {
    const mv = record.metrics[metric];
    const res = evaluateThreshold(mv, rule, record.market);
    if (!res.passed && !res.skipped) return empty;
    if (mv) snapshot[metric] = mv;
  }

  const supportingRules = (trackDef.supporting as Array<Record<string, unknown>>) ?? [];
  const { passCount, total, snapshot: supportingSnapshot, missingSkipCount, otherSkipCount } =
    evalRuleList(supportingRules, record);
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

  const auditHints = ((template.audit_hints as string[]) ?? []).slice();
  const funnelFlags = ((trackDef.funnel_flags as string[]) ?? []).slice();

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
