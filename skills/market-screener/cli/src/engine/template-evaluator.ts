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

function shouldSkipSupportingRule(
  rule: Record<string, unknown>,
  record: SecurityRecord,
  metric: MetricValue | undefined
): boolean {
  if (rule.if_unprofitable === "skip") {
    const netIncome = record.metrics.net_income?.value;
    if (netIncome !== undefined && netIncome < 0) return true;
  }
  if (rule.if_fcf_negative === "skip") {
    const fcf = record.metrics.fcf_margin?.value ?? record.metrics.free_cash_flow?.value;
    if (fcf !== undefined && fcf < 0) return true;
  }
  if (metric?.value === undefined && rule.missing === "skip") {
    return true;
  }
  return false;
}

function evalRuleList(
  rules: Array<Record<string, unknown>>,
  record: SecurityRecord
): { passCount: number; total: number; snapshot: Record<string, MetricValue> } {
  let passCount = 0;
  let total = 0;
  const snapshot: Record<string, MetricValue> = {};

  for (const rule of rules) {
    const metric = rule.metric as string | undefined;
    if (!metric) continue;

    const mv = record.metrics[metric];
    if (shouldSkipSupportingRule(rule, record, mv)) continue;

    total += 1;
    const result = evaluateThreshold(mv, toThresholdRule(rule), record.market);
    if (mv) snapshot[metric] = mv;
    if (result.passed) passCount += 1;
  }

  return { passCount, total, snapshot };
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
  const { passCount, total, snapshot: supportingSnapshot } = evalRuleList(
    supportingRules,
    record
  );
  Object.assign(snapshot, supportingSnapshot);

  const passIf = (trackDef.pass_if as string) ?? "";
  const { supportingMin } = parsePassLogic(passIf);
  const passed = passCount >= supportingMin;

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
